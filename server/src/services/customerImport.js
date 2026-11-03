import ExcelJS from 'exceljs';
import Customer from '../models/Customer.js';
import PriceList from '../models/PriceList.js';
import User from '../models/User.js';
import Warehouse from '../models/Warehouse.js';
import Country from '../models/Country.js';
import State from '../models/State.js';
import { CUSTOMER_TYPES, PAYMENT_TERMS } from '../config/constants.js';
import { customerCreateSchema } from '../validators/companyValidators.js';
import { AppError } from '../utils/errors.js';
import { checkCustomer, nextCustomerCode } from './customerService.js';
import { ensureLocations, findCountry } from './locationService.js';

/**
 * Bulk customer import from the downloadable Excel template.
 *
 * The template's "Customers" sheet has one column per field below. Import is
 * all-or-nothing: every row is validated with the same rules as the customer
 * form (plus in-file duplicate checks) and nothing is saved unless all pass.
 */

export const MAX_IMPORT_ROWS = 1000;

const titleCase = (v) => v.charAt(0) + v.slice(1).toLowerCase();
const termLabel = (t) => (t === 'IMMEDIATE' ? 'Immediate' : t === 'CUSTOM' ? 'Custom' : t.replace('NET_', 'Net '));

// key: payload path; list: name of the dropdown list on the "Lists" sheet.
const COLUMNS = [
  { key: 'name', header: 'Customer name', required: true, example: 'Sharma General Store', width: 28 },
  { key: 'type', header: 'Customer type', required: true, example: 'Retail', list: 'types', note: 'Retail, Wholesale, Distributor or Dealer' },
  { key: 'contactPerson', header: 'Contact person', example: 'Ramesh Sharma', width: 20 },
  { key: 'phone', header: 'Phone', required: true, example: '+91 98765 43210', width: 18, note: '7-15 digits' },
  { key: 'alternatePhone', header: 'Alternate phone', example: '', width: 18 },
  { key: 'email', header: 'Email', example: 'store@example.com', width: 24 },
  { key: 'gstin', header: 'Tax registration no.', example: '27AAAAA0000A1Z5', width: 20, note: 'GSTIN in India; optional' },
  { key: 'pan', header: 'PAN', example: 'AAAAA0000A', note: 'India only; filled from the GSTIN when blank' },
  { key: 'address.line1', header: 'Billing address line 1', example: '12, Market Yard Road', width: 26 },
  { key: 'address.line2', header: 'Billing address line 2', example: 'Shivaji Nagar', width: 22 },
  { key: 'address.country', header: 'Billing country', required: true, example: 'India', list: 'countries', width: 16 },
  { key: 'address.state', header: 'Billing state', required: true, example: 'Maharashtra', list: 'states', width: 18 },
  { key: 'address.city', header: 'Billing city', required: true, example: 'Pune', width: 16 },
  { key: 'address.pincode', header: 'Billing PIN / postal code', example: '411001', width: 14 },
  { key: 'shippingSameAsBilling', header: 'Shipping same as billing', example: 'Yes', list: 'yesNo', note: 'Yes (default) or No' },
  { key: 'shippingAddress.line1', header: 'Shipping address line 1', example: '', width: 24 },
  { key: 'shippingAddress.line2', header: 'Shipping address line 2', example: '', width: 22 },
  { key: 'shippingAddress.country', header: 'Shipping country', example: '', list: 'countries', width: 16 },
  { key: 'shippingAddress.state', header: 'Shipping state', example: '', list: 'states', width: 18 },
  { key: 'shippingAddress.city', header: 'Shipping city', example: '', width: 16 },
  { key: 'shippingAddress.pincode', header: 'Shipping PIN / postal code', example: '', width: 14 },
  { key: 'paymentTerms', header: 'Payment terms', example: 'Net 30', list: 'terms', note: 'Immediate, Net 7 ... Net 60 or Custom' },
  { key: 'creditDays', header: 'Credit days', example: '', type: 'int', note: 'Only for Custom terms (0-365)' },
  { key: 'creditLimit', header: 'Credit limit', example: '50000', type: 'number' },
  { key: 'openingBalance', header: 'Opening balance', example: '0', type: 'number', note: 'Amount the customer owes today' },
  { key: 'priceList', header: 'Price list', example: '', list: 'priceLists', note: 'Name of an existing price list' },
  { key: 'assignedTo', header: 'Salesman email', example: '', list: 'salesmen', width: 24 },
  { key: 'warehouse', header: 'Warehouse code', example: '', list: 'warehouses' },
  { key: 'tags', header: 'Tags', example: 'key account', note: 'Comma separated' },
  { key: 'notes', header: 'Notes', example: '', width: 24 },
  { key: 'isActive', header: 'Active', example: 'Yes', list: 'yesNo', note: 'Yes (default) or No' },
];

const loadRefs = async (companyCountry) => {
  await ensureLocations();
  const [priceLists, salesmen, warehouses, countries] = await Promise.all([
    PriceList.find({ isActive: { $ne: false } }).select('name code').lean(),
    User.find({ isActive: true }).select('name email role').lean(),
    Warehouse.find({ isActive: { $ne: false } }).select('name code').lean(),
    Country.find({ isActive: true }).select('name code').sort({ name: 1 }).lean(),
  ]);
  const home = await findCountry(companyCountry);
  const states = home ? await State.find({ country: home.code, isActive: true }).select('name').sort({ name: 1 }).lean() : [];
  return { priceLists, salesmen, warehouses, countries, states, home };
};

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const buildTemplate = async (company) => {
  const refs = await loadRefs(company?.address?.country);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ElevIQ SFA';

  const sheet = wb.addWorksheet('Customers', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS.map((c) => ({ header: c.required ? `${c.header} *` : c.header, key: c.key, width: c.width || 16 }));
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 30;
  COLUMNS.forEach((c, i) => {
    head.getCell(i + 1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: c.required ? 'FF1D4ED8' : 'FF475569' },
    };
    if (c.note) head.getCell(i + 1).note = c.note;
  });

  // Dropdown sources live on a hidden sheet so the lists can be long.
  const lists = {
    types: CUSTOMER_TYPES.map(titleCase),
    terms: PAYMENT_TERMS.map(termLabel),
    yesNo: ['Yes', 'No'],
    countries: refs.countries.map((c) => c.name),
    states: refs.states.map((s) => s.name),
    priceLists: refs.priceLists.map((p) => p.name),
    salesmen: refs.salesmen.map((u) => u.email),
    warehouses: refs.warehouses.map((w) => w.code),
  };
  const listSheet = wb.addWorksheet('Lists', { state: 'veryHidden' });
  const ranges = {};
  Object.entries(lists).forEach(([name, values], i) => {
    const col = listSheet.getColumn(i + 1);
    col.values = [name, ...values];
    const letter = col.letter;
    if (values.length) ranges[name] = `Lists!$${letter}$2:$${letter}$${values.length + 1}`;
  });

  const firstRow = 2;
  const lastRow = MAX_IMPORT_ROWS + 1;
  COLUMNS.forEach((c, i) => {
    const letter = sheet.getColumn(i + 1).letter;
    for (let r = firstRow; r <= lastRow; r += 1) {
      const cell = sheet.getCell(`${letter}${r}`);
      if (c.list && ranges[c.list]) {
        cell.dataValidation = {
          type: 'list',
          // Countries/states/salesmen may be typed too; only fixed enums are strict.
          allowBlank: true,
          showErrorMessage: ['types', 'terms', 'yesNo'].includes(c.list),
          formulae: [ranges[c.list]],
        };
      } else if (c.type === 'number' || c.type === 'int') {
        cell.dataValidation = {
          type: c.type === 'int' ? 'whole' : 'decimal',
          operator: 'greaterThanOrEqual',
          allowBlank: true,
          showErrorMessage: true,
          errorTitle: 'Invalid number',
          error: 'Enter a number of 0 or more',
          formulae: [0],
        };
      }
      if (['phone', 'alternatePhone', 'address.pincode', 'shippingAddress.pincode', 'gstin'].includes(c.key)) {
        cell.numFmt = '@'; // keep leading zeros / + signs as typed
      }
    }
  });

  const help = wb.addWorksheet('Instructions');
  help.columns = [
    { header: 'Column', key: 'h', width: 28 },
    { header: 'Required', key: 'r', width: 10 },
    { header: 'Example', key: 'e', width: 26 },
    { header: 'Notes', key: 'n', width: 60 },
  ];
  help.getRow(1).font = { bold: true };
  COLUMNS.forEach((c) => help.addRow({ h: c.header, r: c.required ? 'Yes' : '', e: c.example, n: c.note || '' }));
  help.addRow({});
  help.addRow({ h: 'How to import', n: 'Fill one customer per row on the "Customers" sheet (row 1 is the header).' });
  help.addRow({ n: 'Customer codes are generated automatically - do not add a code column.' });
  help.addRow({ n: `Up to ${MAX_IMPORT_ROWS} rows per file. Nothing is saved unless every row is valid.` });

  return wb.xlsx.writeBuffer();
};

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const cellText = (cell) => {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.text) return String(v.text).trim(); // hyperlink / rich text
    if (v.richText) return v.richText.map((t) => t.text).join('').trim();
    if (v.result !== undefined) return String(v.result).trim(); // formula
  }
  return String(v).trim();
};

const setPath = (obj, path, value) => {
  const [head, tail] = path.split('.');
  if (tail) obj[head] = { ...(obj[head] || {}), [tail]: value };
  else obj[head] = value;
};

const yesNo = (v, fallback) => {
  if (!v) return fallback;
  if (/^(y|yes|true|1)$/i.test(v)) return true;
  if (/^(n|no|false|0)$/i.test(v)) return false;
  return null;
};

/** Turn one sheet row into a customer payload + the errors found while reading it. */
const readRow = (row, columnIndex, refs) => {
  const payload = {};
  const errors = [];
  for (const c of COLUMNS) {
    const idx = columnIndex[c.key];
    const raw = idx ? cellText(row.getCell(idx)) : '';
    if (!raw) continue;
    let value = raw;

    if (c.key === 'type') {
      value = CUSTOMER_TYPES.find((t) => t === raw.toUpperCase());
      if (!value) errors.push({ field: c.key, message: `Customer type must be one of ${CUSTOMER_TYPES.map(titleCase).join(', ')}` });
    } else if (c.key === 'paymentTerms') {
      const norm = raw.toUpperCase().replace(/\s+/g, '_');
      value = PAYMENT_TERMS.find((t) => t === norm || termLabel(t).toUpperCase() === raw.toUpperCase());
      if (!value) errors.push({ field: c.key, message: `Unknown payment terms "${raw}"` });
    } else if (c.key === 'shippingSameAsBilling' || c.key === 'isActive') {
      value = yesNo(raw, true);
      if (value === null) errors.push({ field: c.key, message: `${c.header} must be Yes or No` });
    } else if (c.type === 'number' || c.type === 'int') {
      value = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(value) || value < 0 || (c.type === 'int' && !Number.isInteger(value))) {
        errors.push({ field: c.key, message: `${c.header} must be ${c.type === 'int' ? 'a whole number' : 'a number'} of 0 or more` });
        continue;
      }
    } else if (c.key === 'priceList') {
      const pl = refs.priceLists.find((p) => p.name.toLowerCase() === raw.toLowerCase() || (p.code || '').toLowerCase() === raw.toLowerCase());
      if (!pl) errors.push({ field: c.key, message: `Price list "${raw}" not found` });
      value = pl ? String(pl._id) : undefined;
    } else if (c.key === 'assignedTo') {
      const u = refs.salesmen.find((x) => x.email.toLowerCase() === raw.toLowerCase());
      if (!u) errors.push({ field: c.key, message: `No active user with email "${raw}"` });
      value = u ? String(u._id) : undefined;
    } else if (c.key === 'warehouse') {
      const w = refs.warehouses.find((x) => x.code.toLowerCase() === raw.toLowerCase() || x.name.toLowerCase() === raw.toLowerCase());
      if (!w) errors.push({ field: c.key, message: `Warehouse "${raw}" not found` });
      value = w ? String(w._id) : undefined;
    } else if (c.key === 'tags') {
      value = raw.split(',').map((t) => t.trim()).filter(Boolean);
    }
    if (value !== undefined) setPath(payload, c.key, value);
  }
  if (!payload.type && !errors.some((e) => e.field === 'type')) errors.push({ field: 'type', message: 'Customer type is required' });
  return { payload, errors };
};

/**
 * Validate (and, unless dryRun, save) every customer row of an uploaded workbook.
 * @returns {{ total, valid, errors: {row, field, column, message}[], imported }}
 */
export const importCustomers = async (buffer, { company, isIndia, dryRun = true, maxCustomers = 0 }) => {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new AppError('Could not read the file. Upload the .xlsx template.', { status: 422, code: 'INVALID_FILE' });
  }
  const sheet = wb.getWorksheet('Customers') || wb.worksheets[0];
  if (!sheet) throw new AppError('The workbook has no sheets', { status: 422, code: 'INVALID_FILE' });

  // Map header text (with or without the "*") to column numbers.
  const columnIndex = {};
  sheet.getRow(1).eachCell((cell, col) => {
    const header = cellText(cell).replace(/\s*\*$/, '').toLowerCase();
    const def = COLUMNS.find((c) => c.header.toLowerCase() === header);
    if (def) columnIndex[def.key] = col;
  });
  const missing = COLUMNS.filter((c) => c.required && !columnIndex[c.key]).map((c) => c.header);
  if (missing.length) {
    throw new AppError(`Missing column(s): ${missing.join(', ')}. Use the downloaded template.`, {
      status: 422,
      code: 'INVALID_TEMPLATE',
    });
  }

  const refs = await loadRefs(company?.address?.country);
  const header = (key) => COLUMNS.find((c) => c.key === key)?.header || key;
  const errors = [];
  const ready = [];
  const seenGstin = new Map();
  const seenNamePhone = new Map();
  let total = 0;

  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const hasData = COLUMNS.some((c) => columnIndex[c.key] && cellText(row.getCell(columnIndex[c.key])));
    if (!hasData) continue;
    total += 1;
    if (total > MAX_IMPORT_ROWS) {
      throw new AppError(`Too many rows: the limit is ${MAX_IMPORT_ROWS} per file.`, { status: 422, code: 'TOO_MANY_ROWS' });
    }

    const add = (field, message) =>
      errors.push({ row: r, field, column: header(field.replace(/^body\./, '')), message });
    const read = readRow(row, columnIndex, refs);
    read.errors.forEach((e) => add(e.field, e.message));

    const parsed = customerCreateSchema.safeParse(read.payload);
    if (!parsed.success) {
      parsed.error.issues.forEach((i) => add(i.path.join('.'), i.message));
      continue;
    }
    const { data, errors: ruleErrors } = await checkCustomer(parsed.data, { isIndia });
    ruleErrors.forEach((e) => add(e.field, e.message));

    // Duplicates inside the file itself.
    if (data.gstin) {
      if (seenGstin.has(data.gstin)) add('gstin', `Same tax registration number as row ${seenGstin.get(data.gstin)}`);
      else seenGstin.set(data.gstin, r);
    }
    const key = `${String(data.name).toLowerCase()}|${data.phone}`;
    if (seenNamePhone.has(key)) add('name', `Same name and phone as row ${seenNamePhone.get(key)}`);
    else seenNamePhone.set(key, r);

    if (!read.errors.length && !ruleErrors.length) ready.push(data);
  }

  if (!total) throw new AppError('The file has no customer rows.', { status: 422, code: 'EMPTY_FILE' });

  if (maxCustomers > 0) {
    const current = await Customer.countDocuments({});
    if (current + total > maxCustomers) {
      errors.push({
        row: null,
        field: '',
        column: '',
        message: `Your plan allows ${maxCustomers} customers; you have ${current} and the file adds ${total}.`,
      });
    }
  }

  const result = { total, valid: ready.length, errors, imported: 0 };
  if (dryRun || errors.length) return result;

  const docs = [];
  for (const data of ready) {
    docs.push({
      ...data,
      companyId: company._id,
      code: await nextCustomerCode(company._id),
      outstanding: data.openingBalance ?? 0,
    });
  }
  await Customer.insertMany(docs);
  result.imported = docs.length;
  return result;
};

export default { buildTemplate, importCustomers, MAX_IMPORT_ROWS };
