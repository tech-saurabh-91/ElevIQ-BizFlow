import Product from '../models/Product.js';
import Unit, { DEFAULT_UNITS } from '../models/Unit.js';
import ProductCategory from '../models/ProductCategory.js';
import Setting from '../models/Setting.js';
import { nextSeries } from '../utils/numberSeries.js';
import { escapeRegex } from '../utils/query.js';
import { BadRequestError } from '../utils/errors.js';

/**
 * Product catalogue rules: unit and category masters, product validation and
 * pack-unit arithmetic shared by orders, invoices, purchases and stock.
 */

const EPS = 1e-6;
const ci = (v) => new RegExp(`^${escapeRegex(String(v).trim())}$`, 'i');

// ---------------------------------------------------------------------------
// Masters bootstrap (per company, idempotent)
// ---------------------------------------------------------------------------

/**
 * First use of the catalogue in a company: create the default units, move
 * free-text categories into the category master and legacy alternate units
 * into pack units. Runs inside the tenant context.
 */
export const ensureCatalog = async () => {
  if (!(await Unit.exists({}))) {
    await Unit.insertMany(DEFAULT_UNITS.map(([code, name, allowDecimals]) => ({ code, name, allowDecimals })), {
      ordered: false,
    }).catch(() => {});
  }

  // Any unit already used by a product must exist in the master.
  const used = new Set();
  const products = await Product.find({}).select('unit packUnits altUnit conversion category subCategory categoryId').lean();
  products.forEach((p) => {
    if (p.unit) used.add(String(p.unit).toUpperCase());
    (p.packUnits || []).forEach((u) => used.add(u.unit));
  });
  const known = new Set((await Unit.find({}).select('code').lean()).map((u) => u.code));
  const missing = [...used].filter((c) => c && !known.has(c));
  if (missing.length) await Unit.insertMany(missing.map((code) => ({ code, name: code })), { ordered: false }).catch(() => {});

  // Legacy single alternate unit -> one pack unit.
  for (const p of products) {
    const upperUnit = String(p.unit || 'PCS').toUpperCase();
    const set = {};
    if (p.unit !== upperUnit) set.unit = upperUnit;
    if (!p.packUnits?.length && p.altUnit && Number(p.conversion) > 1 && p.altUnit.toUpperCase() !== upperUnit) {
      const alt = p.altUnit.toUpperCase();
      if (!known.has(alt)) await Unit.create({ code: alt, name: alt }).catch(() => {});
      set.packUnits = [{ unit: alt, factor: Number(p.conversion), barcode: '', price: 0 }];
    }
    if (Object.keys(set).length) await Product.updateOne({ _id: p._id }, { $set: set });
  }

  // Free-text categories -> General / <category> / <sub-category>.
  const unlinked = products.filter((p) => !p.categoryId && p.category);
  if (unlinked.length) {
    const general =
      (await ProductCategory.findOne({ level: 'CLASSIFICATION', name: ci('General') })) ||
      (await ProductCategory.create({ level: 'CLASSIFICATION', name: 'General' }));
    for (const p of unlinked) {
      const cat =
        (await ProductCategory.findOne({ level: 'CATEGORY', parent: general._id, name: ci(p.category) })) ||
        (await ProductCategory.create({ level: 'CATEGORY', parent: general._id, name: p.category.trim() }));
      let sub = null;
      if (p.subCategory) {
        sub =
          (await ProductCategory.findOne({ level: 'SUBCATEGORY', parent: cat._id, name: ci(p.subCategory) })) ||
          (await ProductCategory.create({ level: 'SUBCATEGORY', parent: cat._id, name: p.subCategory.trim() }));
      }
      await Product.updateOne(
        { _id: p._id },
        {
          $set: {
            classification: general.name,
            classificationId: general._id,
            category: cat.name,
            categoryId: cat._id,
            subCategory: sub?.name || '',
            subCategoryId: sub?._id || null,
          },
        }
      );
    }
  }
};

export const nextProductCode = async (companyId) => {
  const settings = await Setting.forCompany(companyId);
  const series = settings?.series?.product || {};
  return nextSeries(companyId, 'PRODUCT', { prefix: series.prefix || 'PRD', pad: Number(series.pad) || 5 });
};

// ---------------------------------------------------------------------------
// Pack units
// ---------------------------------------------------------------------------

/** Every unit a product can be traded in: base first, then its packs. */
export const unitOptions = (product) => [
  { unit: product.unit || 'PCS', factor: 1, price: 0, base: true },
  ...(product.packUnits || []).map((u) => ({ unit: u.unit, factor: Number(u.factor), price: Number(u.price || 0), base: false })),
];

/** Resolve the unit chosen on a document line (default: the base unit). */
export const lineUnit = (product, unitCode) => {
  const options = unitOptions(product);
  if (!unitCode) return options[0];
  const found = options.find((o) => o.unit === String(unitCode).toUpperCase());
  if (!found) {
    throw new BadRequestError(`"${unitCode}" is not a unit of ${product.name}`, 'INVALID_UNIT');
  }
  return found;
};

/** Base-unit quantity of a line (older lines without a factor are base units). */
export const baseQtyOf = (line) => {
  if (line?.baseQty !== undefined && line?.baseQty !== null) return Number(line.baseQty);
  return Number(line?.qty || 0) * Number(line?.unitFactor || 1);
};

/** "53 PCS" -> "5 PKT + 3 PCS" using the largest packs first. */
export const describeQty = (baseQty, product) => {
  let left = Number(baseQty || 0);
  const parts = [];
  [...(product.packUnits || [])]
    .sort((a, b) => b.factor - a.factor)
    .forEach((p) => {
      const n = Math.floor((left + EPS) / p.factor);
      if (n > 0) {
        parts.push(`${n} ${p.unit}`);
        left -= n * p.factor;
      }
    });
  if (left > EPS || !parts.length) parts.push(`${Math.round(left * 1000) / 1000} ${product.unit || 'PCS'}`);
  return parts.join(' + ');
};

// ---------------------------------------------------------------------------
// Product validation
// ---------------------------------------------------------------------------

const BARCODE = /^(\d{8}|\d{12,14})$/; // EAN-8, UPC-A, EAN-13, GTIN-14
const HSN_IN = /^(\d{4}|\d{6}|\d{8})$/;
export const GST_RATES_IN = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

const isWhole = (n) => Math.abs(n - Math.round(n)) < EPS;

/** Find (or, when not strict, create) the master entries named on a payload. */
const resolveGroupNames = async (data, { strict, add }) => {
  const out = { classificationId: null, categoryId: null, subCategoryId: null };
  let parent = null;
  if (data.classification) {
    parent = await ProductCategory.findOne({ level: 'CLASSIFICATION', name: ci(data.classification) }).lean();
    if (!parent) {
      if (strict) return add('classification', `Classification "${data.classification}" not found`), out;
      parent = (await ProductCategory.create({ level: 'CLASSIFICATION', name: data.classification.trim() })).toObject();
    }
    out.classificationId = parent._id;
  }
  const catName = data.category || 'General';
  let cat = await ProductCategory.findOne({ level: 'CATEGORY', name: ci(catName), ...(parent ? { parent: parent._id } : {}) }).lean();
  if (!cat) {
    if (strict) return add('category', `Category "${catName}" not found${parent ? ` under ${parent.name}` : ''}`), out;
    if (!parent) {
      parent =
        (await ProductCategory.findOne({ level: 'CLASSIFICATION', name: ci('General') }).lean()) ||
        (await ProductCategory.create({ level: 'CLASSIFICATION', name: 'General' })).toObject();
      out.classificationId = parent._id;
    }
    cat = (await ProductCategory.create({ level: 'CATEGORY', parent: parent._id, name: catName.trim() })).toObject();
  }
  out.categoryId = cat._id;
  if (data.subCategory) {
    let sub = await ProductCategory.findOne({ level: 'SUBCATEGORY', parent: cat._id, name: ci(data.subCategory) }).lean();
    if (!sub) {
      if (strict) return add('subCategory', `Sub-category "${data.subCategory}" not found under ${cat.name}`), out;
      sub = (await ProductCategory.create({ level: 'SUBCATEGORY', parent: cat._id, name: data.subCategory.trim() })).toObject();
    }
    out.subCategoryId = sub._id;
  }
  return out;
};

/**
 * Validate and normalise a product payload.
 * @returns {{ data, errors: {field, message}[] }}
 */
export const checkProduct = async (
  input,
  { isIndia = false, existingId = null, creating = false, strictNames = false } = {}
) => {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const data = { ...input };
  const notSelf = existingId ? { _id: { $ne: existingId } } : {};

  // ---- units ----------------------------------------------------------------
  const units = await Unit.find({}).lean();
  const unitByCode = new Map(units.map((u) => [u.code, u]));
  data.unit = String(data.unit || 'PCS').toUpperCase();
  const base = unitByCode.get(data.unit);
  if (!base) add('unit', `Unknown unit "${data.unit}"`);
  else if (base.isActive === false) add('unit', `Unit ${data.unit} is inactive`);

  data.packUnits = (data.packUnits || []).map((p) => ({
    unit: String(p.unit || '').toUpperCase(),
    factor: Number(p.factor),
    barcode: String(p.barcode || '').trim(),
    price: Number(p.price || 0),
  }));
  const seen = new Set([data.unit]);
  data.packUnits.forEach((p, i) => {
    const f = `packUnits.${i}`;
    if (!unitByCode.has(p.unit)) add(`${f}.unit`, `Unknown unit "${p.unit}"`);
    else if (seen.has(p.unit)) add(`${f}.unit`, p.unit === data.unit ? 'A pack cannot be the base unit' : `${p.unit} is listed twice`);
    seen.add(p.unit);
    if (!(p.factor > 1)) add(`${f}.factor`, `How many ${data.unit} are in one ${p.unit || 'pack'}? Must be more than 1`);
    else if (base && !base.allowDecimals && !isWhole(p.factor)) add(`${f}.factor`, `${data.unit} is counted in whole numbers`);
    if (p.barcode && !BARCODE.test(p.barcode)) add(`${f}.barcode`, 'Barcode must be 8, 12, 13 or 14 digits');
    if (p.price < 0) add(`${f}.price`, 'Price cannot be negative');
  });

  // ---- codes ----------------------------------------------------------------
  data.customCode = String(data.customCode || '').trim();
  if (data.customCode && (await Product.exists({ customCode: ci(data.customCode), ...notSelf }))) {
    add('customCode', 'Another product already uses this code');
  }
  data.barcode = String(data.barcode || '').trim();
  if (data.barcode && !BARCODE.test(data.barcode)) add('barcode', 'Barcode must be 8, 12, 13 or 14 digits');
  const barcodes = [data.barcode, ...data.packUnits.map((p) => p.barcode)].filter(Boolean);
  if (new Set(barcodes).size !== barcodes.length) add('barcode', 'The same barcode is used twice on this product');
  for (const code of barcodes) {
    const clash = await Product.findOne({ $or: [{ barcode: code }, { 'packUnits.barcode': code }], ...notSelf })
      .select('name')
      .lean();
    if (clash) {
      add(code === data.barcode ? 'barcode' : 'packUnits', `Barcode ${code} already belongs to ${clash.name}`);
      break;
    }
  }

  // ---- grouping -------------------------------------------------------------
  // The form sends master ids. Imports and older API clients send names:
  // those are matched case-insensitively (strictNames = unknown names are
  // errors; otherwise a missing category is created under "General").
  if (!data.categoryId && (data.category || !strictNames)) {
    const byName = await resolveGroupNames(data, { strict: strictNames, add });
    Object.assign(data, byName);
  }
  const pick = async (id, level) => (id ? ProductCategory.findOne({ _id: id, level }).lean() : null);
  const classification = await pick(data.classificationId, 'CLASSIFICATION');
  const category = await pick(data.categoryId, 'CATEGORY');
  const subCategory = await pick(data.subCategoryId, 'SUBCATEGORY');
  if (data.classificationId && !classification) add('classificationId', 'Classification not found');
  if (!data.categoryId) {
    if (!errors.some((e) => e.field === 'category')) add('categoryId', 'Category is required');
  } else if (!category) add('categoryId', 'Category not found');
  else if (classification && String(category.parent) !== String(classification._id)) {
    add('categoryId', `${category.name} is not under ${classification.name}`);
  }
  if (data.subCategoryId && !subCategory) add('subCategoryId', 'Sub-category not found');
  else if (subCategory && category && String(subCategory.parent) !== String(category._id)) {
    add('subCategoryId', `${subCategory.name} is not under ${category.name}`);
  }
  if (category) {
    const parent = classification || (await ProductCategory.findById(category.parent).lean());
    data.classificationId = parent?._id || null;
    data.classification = parent?.name || '';
    data.category = category.name;
  }
  data.subCategoryId = subCategory?._id || null;
  data.subCategory = subCategory?.name || '';

  // ---- tax --------------------------------------------------------------------
  data.hsnCode = String(data.hsnCode || '').trim();
  if (isIndia) {
    if (data.hsnCode && !HSN_IN.test(data.hsnCode)) add('hsnCode', 'HSN/SAC must be 4, 6 or 8 digits');
    if (data.gstRate !== undefined && !GST_RATES_IN.includes(Number(data.gstRate))) {
      add('gstRate', `GST rate must be one of ${GST_RATES_IN.join(', ')}%`);
    }
  }

  // ---- prices -----------------------------------------------------------------
  const mrp = Number(data.mrp || 0);
  const selling = Number(data.sellingPrice || 0);
  const dealer = Number(data.dealerPrice || 0);
  if (mrp > 0 && selling > mrp + EPS) add('sellingPrice', 'Selling price cannot be more than the MRP');
  if (mrp > 0 && dealer > mrp + EPS) add('dealerPrice', 'Dealer price cannot be more than the MRP');
  data.packUnits.forEach((p, i) => {
    if (mrp > 0 && p.price > mrp * p.factor + EPS) add(`packUnits.${i}.price`, `More than the MRP of ${p.factor} ${data.unit}`);
  });

  // ---- stock levels -----------------------------------------------------------
  const whole = base && !base.allowDecimals;
  if (data.lowStockLevel !== undefined && whole && !isWhole(Number(data.lowStockLevel))) {
    add('lowStockLevel', `${data.unit} is counted in whole numbers`);
  }
  if (creating && data.openingStock !== undefined) {
    const opening = Number(data.openingStock || 0);
    if (opening < 0) add('openingStock', 'Opening stock cannot be negative');
    else if (whole && !isWhole(opening)) add('openingStock', `${data.unit} is counted in whole numbers`);
  }

  return { data, errors };
};

export default { ensureCatalog, nextProductCode, unitOptions, lineUnit, baseQtyOf, describeQty, checkProduct };
