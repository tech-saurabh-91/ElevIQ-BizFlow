import ExcelJS from 'exceljs';
import Product from '../models/Product.js';
import Unit from '../models/Unit.js';
import ProductCategory from '../models/ProductCategory.js';
import Warehouse from '../models/Warehouse.js';
import { productCreateSchema } from '../validators/companyValidators.js';
import { AppError } from '../utils/errors.js';
import { checkProduct, ensureCatalog, nextProductCode, GST_RATES_IN } from './catalogService.js';

/**
 * Bulk product import from the downloadable Excel template. Same contract as
 * the customer import: validated row by row with the product form's rules,
 * nothing saved unless every row passes. Categories and units must already
 * exist in their masters (names are matched, never created).
 */

export const MAX_IMPORT_ROWS = 1000;
const PACKS = 2;

const COLUMNS = [
  { key: 'name', header: 'Product name', required: true, example: 'Parle-G Biscuit 100g', width: 28 },
  { key: 'customCode', header: 'Your product code', example: 'PG-100', note: 'Optional; unique' },
  { key: 'barcode', header: 'Barcode', example: '8901719101038', note: '8, 12, 13 or 14 digits', text: true },
  { key: 'classification', header: 'Classification', example: 'Food', list: 'classifications' },
  { key: 'category', header: 'Category', required: true, example: 'Biscuits', list: 'categories' },
  { key: 'subCategory', header: 'Sub-category', example: 'Glucose biscuits', list: 'subCategories' },
  { key: 'brand', header: 'Brand', example: 'Parle' },
  { key: 'unit', header: 'Base unit', required: true, example: 'PCS', list: 'units', note: 'Smallest unit stock is counted in' },
  ...Array.from({ length: PACKS }, (_, i) => [
    { key: `pack${i}.unit`, header: `Pack ${i + 1} unit`, example: i ? '' : 'PKT', list: 'units' },
    { key: `pack${i}.factor`, header: `Pack ${i + 1} contains`, example: i ? '' : '10', type: 'number', note: 'Base units in one pack' },
    { key: `pack${i}.price`, header: `Pack ${i + 1} price`, example: '', type: 'number', note: 'Blank = selling price x contains' },
    { key: `pack${i}.barcode`, header: `Pack ${i + 1} barcode`, example: '', text: true },
  ]).flat(),
  { key: 'hsnCode', header: 'HSN/SAC code', example: '1905', text: true },
  { key: 'gstRate', header: 'Tax rate %', example: '18', type: 'number', list: 'rates' },
  { key: 'mrp', header: 'MRP', example: '10', type: 'number' },
  { key: 'sellingPrice', header: 'Selling price', example: '9', type: 'number' },
  { key: 'dealerPrice', header: 'Dealer price', example: '8.5', type: 'number' },
  { key: 'purchasePrice', header: 'Purchase price', example: '8', type: 'number' },
  { key: 'openingStock', header: 'Opening stock', example: '500', type: 'number', note: 'In the base unit' },
  { key: 'openingWarehouse', header: 'Opening warehouse code', example: '', list: 'warehouses' },
  { key: 'lowStockLevel', header: 'Low stock level', example: '50', type: 'number' },
  { key: 'description', header: 'Description', example: '', width: 24 },
  { key: 'tags', header: 'Tags', example: '', note: 'Comma separated' },
  { key: 'isActive', header: 'Active', example: 'Yes', list: 'yesNo' },
];

const cellText = (cell) => {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.text) return String(v.text).trim();
    if (v.richText) return v.richText.map((t) => t.text).join('').trim();
    if (v.result !== undefined) return String(v.result).trim();
  }
  return String(v).trim();
};

const loadRefs = async (isIndia) => {
  await ensureCatalog();
  const [units, groups, warehouses] = await Promise.all([
    Unit.find({ isActive: { $ne: false } }).sort({ code: 1 }).lean(),
    ProductCategory.find({ isActive: { $ne: false } }).sort({ name: 1 }).lean(),
    Warehouse.find({ isActive: { $ne: false } }).select('name code').lean(),
  ]);
  const names = (level) => [...new Set(groups.filter((g) => g.level === level).map((g) => g.name))];
  return {
    units,
    warehouses,
    lists: {
      units: units.map((u) => u.code),
      classifications: names('CLASSIFICATION'),
      categories: names('CATEGORY'),
      subCategories: names('SUBCATEGORY'),
      warehouses: warehouses.map((w) => w.code),
      rates: isIndia ? GST_RATES_IN.map(String) : [],
      yesNo: ['Yes', 'No'],
    },
  };
};

export const buildTemplate = async ({ isIndia }) => {
  const refs = await loadRefs(isIndia);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ElevIQ SFA';
  const sheet = wb.addWorksheet('Products', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width || 16 }));
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 30;
  COLUMNS.forEach((c, i) => {
    head.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FF1D4ED8' : 'FF475569' } };
    if (c.note) head.getCell(i + 1).note = c.note;
  });

  const listSheet = wb.addWorksheet('Lists', { state: 'veryHidden' });
  const ranges = {};
  Object.entries(refs.lists).forEach(([name, values], i) => {
    const col = listSheet.getColumn(i + 1);
    col.values = [name, ...values];
    if (values.length) ranges[name] = `Lists!$${col.letter}$2:$${col.letter}$${values.length + 1}`;
  });

  COLUMNS.forEach((c, i) => {
    const letter = sheet.getColumn(i + 1).letter;
    for (let r = 2; r <= MAX_IMPORT_ROWS + 1; r += 1) {
      const cell = sheet.getCell(`${letter}${r}`);
      if (c.list && ranges[c.list]) {
        cell.dataValidation = { type: 'list', allowBlank: true, showErrorMessage: true, formulae: [ranges[c.list]] };
      } else if (c.type === 'number') {
        cell.dataValidation = {
          type: 'decimal',
          operator: 'greaterThanOrEqual',
          allowBlank: true,
          showErrorMessage: true,
          error: 'Enter a number of 0 or more',
          formulae: [0],
        };
      }
      if (c.text) cell.numFmt = '@';
    }
  });

  const help = wb.addWorksheet('Instructions');
  help.columns = [
    { header: 'Column', key: 'h', width: 26 },
    { header: 'Required', key: 'r', width: 10 },
    { header: 'Example', key: 'e', width: 24 },
    { header: 'Notes', key: 'n', width: 60 },
  ];
  help.getRow(1).font = { bold: true };
  COLUMNS.forEach((c) => help.addRow({ h: c.header, r: c.required ? 'Yes' : '', e: c.example, n: c.note || '' }));
  help.addRow({});
  help.addRow({ h: 'How to import', n: 'One product per row on the "Products" sheet. Product codes are generated automatically.' });
  help.addRow({ n: 'Classification, category, sub-category and units must already exist in Categories & Units.' });
  help.addRow({ n: `Up to ${MAX_IMPORT_ROWS} rows per file. Nothing is saved unless every row is valid.` });
  return wb.xlsx.writeBuffer();
};

const readRow = (row, columnIndex, refs) => {
  const payload = {};
  const errors = [];
  const packs = Array.from({ length: PACKS }, () => ({}));
  for (const c of COLUMNS) {
    const idx = columnIndex[c.key];
    const raw = idx ? cellText(row.getCell(idx)) : '';
    if (!raw) continue;
    let value = raw;
    if (c.type === 'number') {
      value = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(value) || value < 0) {
        errors.push({ field: c.key, message: `${c.header} must be a number of 0 or more` });
        continue;
      }
    } else if (c.key === 'isActive') {
      if (/^(y|yes|true|1)$/i.test(raw)) value = true;
      else if (/^(n|no|false|0)$/i.test(raw)) value = false;
      else {
        errors.push({ field: c.key, message: 'Active must be Yes or No' });
        continue;
      }
    } else if (c.key === 'openingWarehouse') {
      const w = refs.warehouses.find((x) => x.code.toLowerCase() === raw.toLowerCase() || x.name.toLowerCase() === raw.toLowerCase());
      if (!w) errors.push({ field: c.key, message: `Warehouse "${raw}" not found` });
      value = w ? String(w._id) : undefined;
    } else if (c.key === 'tags') {
      value = raw.split(',').map((t) => t.trim()).filter(Boolean);
    } else if (c.key === 'unit' || c.key.endsWith('.unit')) {
      value = raw.toUpperCase();
    }
    const pack = /^pack(\d)\.(\w+)$/.exec(c.key);
    if (pack) packs[Number(pack[1])][pack[2]] = value;
    else if (value !== undefined) payload[c.key] = value;
  }
  const filled = packs.filter((p) => p.unit || p.factor);
  filled.forEach((p, i) => {
    if (!p.unit) errors.push({ field: `packUnits.${i}.unit`, message: `Pack ${i + 1}: unit is missing` });
    if (!p.factor) errors.push({ field: `packUnits.${i}.factor`, message: `Pack ${i + 1}: how many base units it contains` });
  });
  if (filled.length) payload.packUnits = filled.filter((p) => p.unit && p.factor);
  return { payload, errors };
};

/** Validate (and unless dryRun, import) every product row of an uploaded workbook. */
export const importProducts = async (buffer, { company, isIndia, dryRun = true, userId = null }) => {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new AppError('Could not read the file. Upload the .xlsx template.', { status: 422, code: 'INVALID_FILE' });
  }
  const sheet = wb.getWorksheet('Products') || wb.worksheets[0];
  if (!sheet) throw new AppError('The workbook has no sheets', { status: 422, code: 'INVALID_FILE' });

  const columnIndex = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const header = cellText(cell).replace(/\s*\*$/, '').toLowerCase();
    const def = COLUMNS.find((c) => c.header.toLowerCase() === header);
    if (def) columnIndex[def.key] = col;
  });
  const missing = COLUMNS.filter((c) => c.required && !columnIndex[c.key]).map((c) => c.header);
  if (missing.length) {
    throw new AppError(`Missing column(s): ${missing.join(', ')}. Use the downloaded template.`, { status: 422, code: 'INVALID_TEMPLATE' });
  }

  const refs = await loadRefs(isIndia);
  const headerOf = (field) => {
    const pack = /^packUnits\.(\d)\.(\w+)$/.exec(field);
    if (pack) {
      const label = { unit: 'unit', factor: 'contains', price: 'price', barcode: 'barcode' }[pack[2]] || pack[2];
      return `Pack ${Number(pack[1]) + 1} ${label}`;
    }
    const key = { categoryId: 'category', subCategoryId: 'subCategory', classificationId: 'classification' }[field] || field;
    return COLUMNS.find((c) => c.key === key)?.header || field;
  };
  const errors = [];
  const ready = [];
  const seen = { name: new Map(), customCode: new Map(), barcode: new Map() };
  let total = 0;

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    if (!COLUMNS.some((c) => columnIndex[c.key] && cellText(row.getCell(columnIndex[c.key])))) continue;
    total += 1;
    if (total > MAX_IMPORT_ROWS) {
      throw new AppError(`Too many rows: the limit is ${MAX_IMPORT_ROWS} per file.`, { status: 422, code: 'TOO_MANY_ROWS' });
    }
    const add = (field, message) => errors.push({ row: r, field, column: headerOf(field), message });

    const read = readRow(row, columnIndex, refs);
    read.errors.forEach((e) => add(e.field, e.message));
    const parsed = productCreateSchema.safeParse(read.payload);
    if (!parsed.success) {
      parsed.error.issues.forEach((i) => add(i.path.join('.'), i.message));
      continue;
    }
    const { data, errors: rules } = await checkProduct(parsed.data, { isIndia, creating: true, strictNames: true });
    rules.forEach((e) => add(e.field, e.message));
    if (Number(data.openingStock || 0) > 0 && !data.openingWarehouse && refs.warehouses.length) {
      add('openingWarehouse', 'Give the warehouse that holds the opening stock');
    }

    // Duplicates inside the file.
    [
      ['name', String(data.name).toLowerCase(), 'Same product name as row'],
      ['customCode', String(data.customCode || '').toLowerCase(), 'Same product code as row'],
      ['barcode', data.barcode, 'Same barcode as row'],
    ].forEach(([field, value, text]) => {
      if (!value) return;
      if (seen[field].has(value)) add(field, `${text} ${seen[field].get(value)}`);
      else seen[field].set(value, r);
    });

    if (!read.errors.length && !rules.length) ready.push(data);
  }
  if (!total) throw new AppError('The file has no product rows.', { status: 422, code: 'EMPTY_FILE' });

  const result = { total, valid: ready.length, errors, imported: 0 };
  if (dryRun || errors.length) return result;

  const { recordMovement } = await import('./inventoryService.js');
  for (const data of ready) {
    const doc = await Product.create({ ...data, companyId: company._id, sku: await nextProductCode(company._id), stock: 0 });
    if (Number(data.openingStock || 0) > 0) {
      await recordMovement({
        product: doc._id,
        warehouse: data.openingWarehouse || null,
        qty: Number(data.openingStock),
        type: 'OPENING',
        refType: 'IMPORT',
        refNo: doc.sku,
        reason: 'Opening stock (import)',
        unitCost: Number(data.purchasePrice || 0),
        movedBy: userId,
      });
    }
    result.imported += 1;
  }
  return result;
};

export default { buildTemplate, importProducts, MAX_IMPORT_ROWS };
