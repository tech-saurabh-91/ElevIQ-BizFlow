import Product from '../../models/Product.js';
import { AppError } from '../../utils/errors.js';
import { buildCrudController } from './_crud.js';
import { markSetup } from './_helpers.js';
import { checkProduct, ensureCatalog, nextProductCode } from '../../services/catalogService.js';
import { recordMovement, resolveDefaultWarehouse, loadWarehouse } from '../../services/inventoryService.js';
import { findCountry } from '../../services/locationService.js';
import Setting from '../../models/Setting.js';
import Warehouse from '../../models/Warehouse.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, MOVEMENT_TYPES } from '../../config/constants.js';
import { buildTemplate, importProducts } from '../../services/productImport.js';

// Maintained by the system: the code from the numbering series and stock
// from the inventory ledger.
const SYSTEM_FIELDS = ['sku', 'stock', 'unitType', 'altUnit', 'conversion'];

const isIndiaCompany = async (req) => (await findCountry(req.company?.address?.country))?.code === 'IN';

const failIfErrors = (errors) => {
  if (!errors.length) return;
  throw new AppError(errors[0].message, {
    status: 422,
    code: 'VALIDATION_ERROR',
    errors: errors.map((e) => ({ field: `body.${e.field}`, message: e.message })),
  });
};

const crud = buildCrudController({
  Model: Product,
  entityType: 'Product',
  labelField: 'name',
  searchFields: ['name', 'sku', 'customCode', 'barcode', 'packUnits.barcode', 'category', 'brand', 'hsnCode'],
  filtersSpec: {
    category: { type: 'string' },
    categoryId: { type: 'objectId' },
    classificationId: { type: 'objectId' },
    brand: { type: 'string' },
    isActive: { type: 'bool' },
  },
  sortAllowed: ['createdAt', 'name', 'sku', 'sellingPrice', 'stock', 'mrp'],
  label: 'Product',
  // Re-read after create so the response carries the stock just booked.
  populate: [{ path: 'openingWarehouse', select: 'name code' }],
  listFilter: (req) => {
    const filter = {};
    if (req.query.lowStock === 'true') {
      filter.$expr = { $lte: ['$stock', '$lowStockLevel'] };
    }
    return filter;
  },
  beforeCreate: async (payload, req) => {
    await ensureCatalog();
    SYSTEM_FIELDS.forEach((k) => delete payload[k]);
    const { data, errors } = await checkProduct(payload, { isIndia: await isIndiaCompany(req), creating: true });

    // Opening stock is booked into a warehouse through the stock ledger.
    if (Number(data.openingStock || 0) > 0) {
      const settings = await Setting.forCompany(req.companyId);
      const warehouse = data.openingWarehouse
        ? await loadWarehouse(data.openingWarehouse).catch(() => null)
        : await resolveDefaultWarehouse(settings);
      if (warehouse && !['MAIN', 'SUB'].includes(warehouse.type || 'MAIN')) {
        errors.push({ field: 'openingWarehouse', message: 'Opening stock goes into a main or sub warehouse, not a van' });
      } else if (warehouse) data.openingWarehouse = warehouse._id;
      // No warehouses at all yet: stock is held at company level.
      else if (await Warehouse.exists({})) {
        errors.push({ field: 'openingWarehouse', message: 'Choose the warehouse that holds the opening stock' });
      } else data.openingWarehouse = null;
    }
    failIfErrors(errors);

    data.sku = await nextProductCode(req.companyId);
    data.stock = 0;
    return data;
  },
  beforeUpdate: async (payload, req) => {
    SYSTEM_FIELDS.forEach((k) => delete payload[k]);
    delete payload.openingStock;
    delete payload.openingWarehouse;
    const existing = await Product.findById(req.params.id);
    if (!existing) return payload; // loadDoc reports the 404

    const current = existing.toObject();
    // Changing the base unit would re-interpret the stock already counted in it.
    if (payload.unit && payload.unit.toUpperCase() !== current.unit && Number(current.stock || 0) !== 0) {
      failIfErrors([{ field: 'unit', message: `Base unit cannot change while ${current.stock} ${current.unit} are in stock` }]);
    }
    const merged = { ...current, ...payload };
    if (payload.categoryId === undefined && payload.category === undefined) {
      merged.categoryId = current.categoryId;
    }
    const { data, errors } = await checkProduct(merged, { isIndia: await isIndiaCompany(req), existingId: existing._id });
    failIfErrors(errors);
    [
      'unit',
      'packUnits',
      'customCode',
      'barcode',
      'hsnCode',
      'classification',
      'classificationId',
      'category',
      'categoryId',
      'subCategory',
      'subCategoryId',
    ].forEach((k) => {
      payload[k] = data[k];
    });
    return payload;
  },
  afterCreate: async (doc, req) => {
    const opening = Number(doc.openingStock || 0);
    if (opening > 0) {
      await recordMovement({
        product: doc._id,
        warehouse: doc.openingWarehouse,
        qty: opening,
        type: MOVEMENT_TYPES.OPENING,
        refType: 'MANUAL',
        refNo: doc.sku,
        reason: 'Opening stock',
        unitCost: Number(doc.purchasePrice || 0),
        movedBy: req.user?.id || null,
      });
    }
    await markSetup('products');
  },
});

export const { list, get, create, update, remove } = crud;

/** GET /products/import/template - Excel template for bulk import. */
export const importTemplate = asyncHandler(async (req, res) => {
  const buffer = await buildTemplate({ isIndia: await isIndiaCompany(req) });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.xlsx"');
  res.send(Buffer.from(buffer));
});

/** POST /products/import?dryRun=true|false - validate (and import) an uploaded template. */
export const importFile = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    throw new AppError('Choose the filled-in template (.xlsx) to upload', { status: 422, code: 'FILE_REQUIRED' });
  }
  const result = await importProducts(req.file.buffer, {
    company: req.company,
    isIndia: await isIndiaCompany(req),
    dryRun: req.query.dryRun !== 'false',
    userId: req.user?.id || null,
  });
  if (result.imported) {
    await markSetup('products');
    audit(req, {
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'Product',
      entityLabel: 'Bulk import',
      description: `Imported ${result.imported} products from ${req.file.originalname || 'a file'}`,
    });
  }
  let message = `All ${result.valid} rows are valid`;
  if (result.imported) message = `${result.imported} products imported`;
  else if (result.errors.length) message = `${result.errors.length} problem(s) found, nothing was imported`;
  return success(res, { message, data: result });
});

// ---------------------------------------------------------------------------
// Price review: products whose cost moved since their price was last looked
// at, or that sell below cost.
// ---------------------------------------------------------------------------
const costOf = (p) => Number(p.avgCost || 0) || Number(p.purchasePrice || 0);
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Cost x (1 + markup), never above the MRP; 0 when there is nothing to go on. */
export const suggestedPrice = (p, markupPercent) => {
  const cost = costOf(p);
  if (!cost || !(markupPercent > 0)) return 0;
  const price = round2(cost * (1 + markupPercent / 100));
  return Number(p.mrp) > 0 ? Math.min(price, Number(p.mrp)) : price;
};

export const priceReview = asyncHandler(async (req, res) => {
  const settings = await Setting.forCompany(req.companyId);
  const markup = Number(settings?.inventory?.defaultMarkupPercent || 0);
  const all = req.query.all === 'true';
  const filter = { isActive: { $ne: false } };
  if (!all) {
    filter.$or = [
      { costChangedAt: { $ne: null }, $expr: { $or: [{ $eq: ['$priceReviewedAt', null] }, { $gt: ['$costChangedAt', '$priceReviewedAt'] }] } },
      { $expr: { $and: [{ $gt: ['$sellingPrice', 0] }, { $gt: ['$avgCost', 0] }, { $lt: ['$sellingPrice', '$avgCost'] }] } },
    ];
  }
  const rows = await Product.find(filter)
    .select('name sku unit mrp sellingPrice dealerPrice purchasePrice avgCost costChangedAt priceReviewedAt category stock')
    .sort({ costChangedAt: -1, name: 1 })
    .limit(500)
    .lean();
  const data = rows.map((p) => {
    const cost = costOf(p);
    const selling = Number(p.sellingPrice || 0);
    return {
      id: String(p._id),
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      category: p.category || '',
      stock: Number(p.stock || 0),
      mrp: Number(p.mrp || 0),
      sellingPrice: selling,
      purchasePrice: Number(p.purchasePrice || 0),
      avgCost: Number(p.avgCost || 0),
      marginPercent: selling > 0 && cost > 0 ? round2(((selling - cost) / selling) * 100) : null,
      suggestedPrice: suggestedPrice(p, markup),
      belowCost: selling > 0 && cost > 0 && selling < cost,
      costChanged: Boolean(p.costChangedAt && (!p.priceReviewedAt || p.costChangedAt > p.priceReviewedAt)),
      costChangedAt: p.costChangedAt,
    };
  });
  return success(res, { data, meta: { markupPercent: markup, total: data.length } });
});

/** POST /products/price-review { items: [{ id, sellingPrice? }] } - save prices, mark reviewed. */
export const savePriceReview = asyncHandler(async (req, res) => {
  const items = req.body.items || [];
  const now = new Date();
  const docs = await Product.find({ _id: { $in: items.map((i) => i.id) } });
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const errors = [];
  for (const item of items) {
    const doc = byId.get(String(item.id));
    if (!doc) continue;
    if (item.sellingPrice !== undefined) {
      const price = round2(item.sellingPrice);
      if (Number(doc.mrp) > 0 && price > Number(doc.mrp)) {
        errors.push({ field: `items.${item.id}.sellingPrice`, message: `${doc.name}: more than the MRP ${doc.mrp}` });
        continue;
      }
      doc.sellingPrice = price;
    }
    doc.priceReviewedAt = now;
  }
  failIfErrors(errors);
  await Promise.all(docs.map((d) => d.save()));
  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Product',
    entityLabel: 'Price review',
    description: `Selling prices reviewed for ${docs.length} product(s)`,
  });
  return success(res, { message: `${docs.length} product price(s) reviewed`, data: { reviewed: docs.length } });
});

export default crud;
