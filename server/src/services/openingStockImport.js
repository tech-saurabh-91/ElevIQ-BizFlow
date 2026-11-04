import ExcelJS from 'exceljs';
import Product from '../models/Product.js';
import Unit from '../models/Unit.js';
import Warehouse from '../models/Warehouse.js';
import StockMovement from '../models/StockMovement.js';
import { AppError, BadRequestError } from '../utils/errors.js';
import { MOVEMENT_TYPES } from '../config/constants.js';
import { recordMovement } from './inventoryService.js';

/**
 * Opening stock for a warehouse from Excel (e.g. a newly created godown).
 *
 * The template lists every active product so the user only types quantities;
 * blank rows are skipped. A product gets opening stock in a warehouse only
 * once - later corrections are stock adjustments. All-or-nothing, like the
 * other imports.
 */

const HEADERS = ['Product code', 'Product name', 'Base unit', 'Opening qty', 'Unit cost'];

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

/** Opening stock only goes into an active main or sub warehouse. */
export const loadStockWarehouse = async (id) => {
  if (!id) throw new BadRequestError('Choose the warehouse', 'VALIDATION_ERROR');
  const wh = await Warehouse.findOne({ _id: id }).lean();
  if (!wh) throw new BadRequestError('Warehouse not found', 'INVALID_REFERENCE');
  if (!['MAIN', 'SUB'].includes(wh.type || 'MAIN')) {
    throw new BadRequestError('Opening stock goes into a main or sub warehouse; load vans by transfer', 'VALIDATION_ERROR');
  }
  if (wh.isActive === false) throw new BadRequestError('This warehouse is inactive', 'WAREHOUSE_INACTIVE');
  return wh;
};

export const buildTemplate = async (warehouse) => {
  const products = await Product.find({ isActive: { $ne: false } }).select('sku customCode name unit purchasePrice').sort({ name: 1 }).lean();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ElevIQ SFA';
  const sheet = wb.addWorksheet('Opening stock', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Product code *', key: 'code', width: 16 },
    { header: 'Product name', key: 'name', width: 36 },
    { header: 'Base unit', key: 'unit', width: 10 },
    { header: 'Opening qty *', key: 'qty', width: 14 },
    { header: 'Unit cost', key: 'cost', width: 12 },
  ];
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c, i) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: [1, 4].includes(i) ? 'FF1D4ED8' : 'FF475569' } };
  });
  head.getCell(4).note = `Quantity in the base unit, held in ${warehouse.name} today. Leave blank to skip.`;
  products.forEach((p) => sheet.addRow({ code: p.sku, name: p.name, unit: p.unit, qty: null, cost: p.purchasePrice || null }));
  for (let r = 2; r <= products.length + 1; r += 1) {
    ['D', 'E'].forEach((col) => {
      sheet.getCell(`${col}${r}`).dataValidation = {
        type: 'decimal',
        operator: 'greaterThanOrEqual',
        allowBlank: true,
        showErrorMessage: true,
        error: 'Enter a number of 0 or more',
        formulae: [0],
      };
    });
  }
  return wb.xlsx.writeBuffer();
};

export const importOpeningStock = async (buffer, { warehouse, dryRun = true, userId = null, settings = null }) => {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new AppError('Could not read the file. Upload the .xlsx template.', { status: 422, code: 'INVALID_FILE' });
  }
  const sheet = wb.getWorksheet('Opening stock') || wb.worksheets[0];
  const header = (sheet?.getRow(1).values || []).slice(1).map((h) => cellText({ value: h }).replace(/\s*\*$/, ''));
  if (!sheet || HEADERS.some((h, i) => header[i] !== h)) {
    throw new AppError('Use the downloaded opening stock template.', { status: 422, code: 'INVALID_TEMPLATE' });
  }

  const products = await Product.find({}).select('sku customCode name unit purchasePrice').lean();
  const byCode = new Map();
  products.forEach((p) => {
    byCode.set(String(p.sku).toUpperCase(), p);
    if (p.customCode) byCode.set(String(p.customCode).toUpperCase(), p);
  });
  const units = new Map((await Unit.find({}).lean()).map((u) => [u.code, u]));

  const errors = [];
  const ready = [];
  const seen = new Map();
  let total = 0;
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const code = cellText(row.getCell(1)).toUpperCase();
    const qtyText = cellText(row.getCell(4)).replace(/,/g, '');
    if (!qtyText) continue; // product listed but nothing held
    total += 1;
    const add = (column, message) => errors.push({ row: r, column, message });
    const product = byCode.get(code);
    if (!product) {
      add('Product code', code ? `Unknown product code ${code}` : 'Product code is required');
      continue;
    }
    const qty = Number(qtyText);
    const costText = cellText(row.getCell(5)).replace(/,/g, '');
    const cost = costText ? Number(costText) : Number(product.purchasePrice || 0);
    if (!Number.isFinite(qty) || qty <= 0) add('Opening qty', 'Enter a quantity more than 0');
    else if (!units.get(product.unit)?.allowDecimals && !Number.isInteger(qty)) add('Opening qty', `${product.unit} is counted in whole numbers`);
    if (!Number.isFinite(cost) || cost < 0) add('Unit cost', 'Enter a cost of 0 or more');
    const key = String(product._id);
    if (seen.has(key)) add('Product code', `Same product as row ${seen.get(key)}`);
    else seen.set(key, r);
    if (!errors.some((e) => e.row === r)) ready.push({ product, qty, cost, row: r });
  }
  if (!total) throw new AppError('Enter at least one opening quantity.', { status: 422, code: 'EMPTY_FILE' });

  // Opening stock is a one-time entry per product per warehouse.
  const already = await StockMovement.distinct('product', { warehouse: warehouse._id, product: { $in: ready.map((r) => r.product._id) } });
  const used = new Set(already.map(String));
  ready.forEach((r) => {
    if (used.has(String(r.product._id))) {
      errors.push({ row: r.row, column: 'Product code', message: `${r.product.name} already has stock history in ${warehouse.name}; use an adjustment` });
    }
  });

  const result = { total, valid: ready.length - ready.filter((r) => used.has(String(r.product._id))).length, errors, imported: 0 };
  if (dryRun || errors.length) return result;

  for (const r of ready) {
    await recordMovement({
      product: r.product._id,
      warehouse: warehouse._id,
      qty: r.qty,
      type: MOVEMENT_TYPES.OPENING,
      refType: 'IMPORT',
      refNo: `OPENING-${warehouse.code}`,
      reason: 'Opening stock (import)',
      unitCost: r.cost,
      movedBy: userId,
      settings,
    });
    result.imported += 1;
  }
  return result;
};

export default { buildTemplate, importOpeningStock, loadStockWarehouse };
