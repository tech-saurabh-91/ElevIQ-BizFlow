import mongoose from 'mongoose';
import Company from '../../models/Company.js';
import YearBalance from '../../models/YearBalance.js';
import FinancialYear from '../../models/FinancialYear.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { success, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../middlewares/audit.js';
import { escapeRegex } from '../../utils/query.js';
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import * as years from '../../services/yearCloseService.js';
import { newYearOverview, copyTargets, extendValidity } from '../../services/newYearService.js';
import { notifyPermission } from '../../services/notifyService.js';
import { hasPermission } from '../../middlewares/rbac.js';
import { ConflictError, NotFoundError } from '../../utils/errors.js';

const companyOf = (req) => Company.findById(req.companyId).lean();

/** GET /financial-years - every year with its status. */
export const list = asyncHandler(async (req, res) => {
  const data = await years.listYears(await companyOf(req));
  return success(res, { data });
});

/** GET /financial-years/:tag/checklist - loose ends to finish before closing. */
export const checklist = asyncHandler(async (req, res) => {
  const data = await years.checklist(await companyOf(req), req.params.tag);
  return success(res, { data });
});

/** POST /financial-years/:tag/close */
export const close = asyncHandler(async (req, res) => {
  const force = req.body?.force === true;
  const result = await years.closeYear({ companyId: req.companyId, tag: req.params.tag, user: req.user, notes: req.body?.notes || '', force });
  audit(req, {
    action: AUDIT_ACTIONS.YEAR_CLOSE,
    entityType: 'FinancialYear',
    entityId: result.doc._id,
    entityLabel: result.year.label,
    after: result.doc.totals,
    description: `${result.year.label} closed - documents up to ${result.year.endDay} are locked${result.openItems.length ? ` (closed with ${result.openItems.length} item(s) open: ${req.body?.notes || ''})` : ''}`,
  });
  notifyPermission(req.companyId, 'books.view', {
    type: 'SYSTEM',
    title: `${result.year.label} is closed`,
    body: `${req.user.name} closed ${result.year.label}. Documents dated up to ${dayjs(result.year.endDay).format('DD/MM/YYYY')} are now locked. Download the closing pack from Year Closing.`,
    link: '/app/year-closing',
    exclude: req.user.id,
  });
  return success(res, { message: `${result.year.label} is closed`, data: { year: result.year, totals: result.doc.totals, openItems: result.openItems } });
});

/** POST /financial-years/:tag/reopen  { reason } */
export const reopen = asyncHandler(async (req, res) => {
  const result = await years.reopenYear({ companyId: req.companyId, tag: req.params.tag, user: req.user, reason: req.body.reason });
  const doc = await FinancialYear.findOne({ tag: req.params.tag }).select('_id').lean();
  audit(req, {
    action: AUDIT_ACTIONS.YEAR_REOPEN,
    entityType: 'FinancialYear',
    entityId: doc?._id || null,
    entityLabel: result.year.label,
    description: `${result.year.label} reopened: ${req.body.reason}`,
  });
  notifyPermission(req.companyId, 'books.view', {
    type: 'SYSTEM',
    title: `${result.year.label} was reopened`,
    body: `${req.user.name} reopened ${result.year.label}: ${req.body.reason}. Close it again once the corrections are done.`,
    link: '/app/year-closing',
    priority: 'HIGH',
    exclude: req.user.id,
  });
  return success(res, { message: `${result.year.label} is open again`, data: { year: result.year } });
});

/** GET /financial-years/:tag/balances?kind=CUSTOMER|SUPPLIER|STOCK&search= - closing balances of a closed year. */
export const balances = asyncHandler(async (req, res) => {
  const { kind = 'CUSTOMER', search = '' } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const filter = { tag: req.params.tag, kind };
  if (search) {
    const rx = new RegExp(escapeRegex(String(search).trim()), 'i');
    filter.$or = [{ name: rx }, { code: rx }, { warehouseName: rx }];
  }
  const [rows, total, sum] = await Promise.all([
    YearBalance.find(filter).sort({ name: 1, warehouseName: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    YearBalance.countDocuments(filter),
    YearBalance.aggregate([{ $match: { companyId: new mongoose.Types.ObjectId(String(req.companyId)), isDeleted: { $ne: true }, ...filter } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
  ]);
  return paginated(res, {
    data: rows.map((r) => ({ id: String(r._id), name: r.name, code: r.code, warehouseName: r.warehouseName, qty: r.qty, rate: r.rate, amount: r.amount })),
    page,
    limit,
    total,
    extra: { totalAmount: sum[0]?.amount || 0 },
  });
});

/** GET /financial-years/status - year-end banner: days left, an ended year still open. */
export const status = asyncHandler(async (req, res) => {
  const data = await years.yearEndState(await companyOf(req));
  return success(res, { data: { ...data, canBackdate: hasPermission(req, 'books.backdate'), canClose: hasPermission(req, 'books.close') } });
});

const TOTAL_LABELS = [
  ['sales', 'Sales (invoices)'],
  ['salesTaxable', 'Sales before tax'],
  ['outputTax', 'Tax on sales'],
  ['creditNotes', 'Credit notes'],
  ['costOfSales', 'Cost of goods sold'],
  ['grossProfit', 'Gross profit'],
  ['collections', 'Money collected'],
  ['purchases', 'Purchases (supplier bills)'],
  ['inputTax', 'Tax on purchases'],
  ['purchaseReturns', 'Purchase returns'],
  ['supplierPayments', 'Paid to suppliers'],
  ['receivables', 'Customers owe us (closing)'],
  ['payables', 'We owe suppliers (closing)'],
  ['stockValue', 'Stock value (closing)'],
  ['invoices', 'Invoices issued'],
  ['bills', 'Supplier bills'],
];
const COUNT_KEYS = new Set(['invoices', 'bills']);

/**
 * GET /financial-years/:tag/export - the closing pack (Excel): year totals and
 * every closing balance. A closed year gives what was saved when it closed; an
 * ended year not closed yet gives today's figures, marked as a draft.
 */
export const exportPack = asyncHandler(async (req, res) => {
  const company = await companyOf(req);
  const { years: list } = await years.listYears(company);
  const year = list.find((y) => y.tag === req.params.tag);
  if (!year) throw new NotFoundError('Unknown financial year', 'NOT_FOUND');
  if (!year.ended) throw new ConflictError(`${year.label} has not ended yet`, 'YEAR_NOT_ENDED');

  const closed = year.status === 'CLOSED';
  let totals;
  let rows;
  if (closed) {
    totals = (await FinancialYear.findOne({ tag: year.tag }).lean())?.totals || {};
    rows = await YearBalance.find({ tag: year.tag }).sort({ kind: 1, name: 1 }).lean();
  } else {
    ({ totals, rows } = await years.buildSnapshot(company, year));
  }
  const showCost = hasPermission(req, 'products.cost.view');
  const money = '#,##0.00;[Red]-#,##0.00';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ElevIQ';
  const summary = wb.addWorksheet('Summary');
  summary.addRow([company.businessName || company.name || '']).font = { bold: true, size: 14 };
  summary.addRow([`Closing pack - ${year.label} (${dayjs(year.startDay).format('DD/MM/YYYY')} to ${dayjs(year.endDay).format('DD/MM/YYYY')})`]).font = { bold: true };
  summary.addRow([
    closed
      ? `Closed by ${year.closedByName || '-'} on ${year.closedAt ? dayjs(year.closedAt).format('DD/MM/YYYY') : '-'}`
      : `DRAFT - ${year.label} is not closed yet, so these figures can still change. Printed ${dayjs().format('DD/MM/YYYY')}.`,
  ]).font = { italic: true, color: { argb: closed ? 'FF475569' : 'FFB45309' } };
  summary.addRow([]);
  TOTAL_LABELS.filter(([k]) => showCost || !['costOfSales', 'grossProfit', 'stockValue'].includes(k)).forEach(([k, label]) => {
    const row = summary.addRow([label, Number(totals[k] || 0)]);
    if (!COUNT_KEYS.has(k)) row.getCell(2).numFmt = money;
  });
  summary.getColumn(1).width = 34;
  summary.getColumn(2).width = 18;

  const sheet = (name, columns, list) => {
    const ws = wb.addWorksheet(name);
    const head = ws.addRow(columns.map((c) => c.label));
    head.font = { bold: true };
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
    });
    list.forEach((r) => ws.addRow(columns.map((c) => r[c.key] ?? '')));
    const total = ws.addRow(columns.map((c, i) => (i === 0 ? `Total (${list.length})` : c.sum ? list.reduce((t, r) => t + Number(r[c.key] || 0), 0) : '')));
    total.font = { bold: true };
    columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = c.width || 16;
      if (c.money) ws.getColumn(i + 1).numFmt = money;
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const of = (kind) => rows.filter((r) => r.kind === kind);
  sheet('Customers', [{ key: 'code', label: 'Code', width: 12 }, { key: 'name', label: 'Customer', width: 36 }, { key: 'amount', label: 'Closing balance (owes us)', money: true, sum: true, width: 24 }], of('CUSTOMER'));
  sheet('Suppliers', [{ key: 'code', label: 'Code', width: 12 }, { key: 'name', label: 'Supplier', width: 36 }, { key: 'amount', label: 'Closing balance (we owe)', money: true, sum: true, width: 24 }], of('SUPPLIER'));
  sheet(
    'Stock',
    [
      { key: 'code', label: 'SKU', width: 14 },
      { key: 'name', label: 'Product', width: 36 },
      { key: 'warehouseName', label: 'Warehouse', width: 22 },
      { key: 'qty', label: 'Closing qty', sum: true },
      ...(showCost ? [{ key: 'rate', label: 'Rate', money: true }, { key: 'amount', label: 'Value', money: true, sum: true }] : []),
    ],
    of('STOCK')
  );

  const buffer = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="closing-pack-${year.tag}${closed ? '' : '-draft'}.xlsx"`);
  return res.send(Buffer.from(buffer));
});

/** GET /financial-years/new-year - targets to copy, validity to extend, next numbers. */
export const newYear = asyncHandler(async (req, res) => {
  const data = await newYearOverview(await companyOf(req), (p) => hasPermission(req, p));
  return success(res, { data });
});

/** POST /financial-years/new-year/targets  { percent } - copy last year's targets into this year. */
export const newYearTargets = asyncHandler(async (req, res) => {
  const result = await copyTargets(await companyOf(req), { percent: req.body.percent || 0 });
  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'Target',
    entityLabel: 'New year targets',
    description: `${result.created} target(s) copied from last year${req.body.percent ? ` (${req.body.percent > 0 ? '+' : ''}${req.body.percent}%)` : ''}; ${result.skipped.exists} already set, ${result.skipped.inactive} for inactive salesmen or routes`,
  });
  return success(res, { message: `${result.created} target${result.created === 1 ? '' : 's'} copied`, data: result });
});

/** POST /financial-years/new-year/extend  { items: [{ kind, id }], validTo? } */
export const newYearExtend = asyncHandler(async (req, res) => {
  const result = await extendValidity(await companyOf(req), req.body, (p) => hasPermission(req, p));
  if (result.extended.length) {
    audit(req, {
      action: AUDIT_ACTIONS.UPDATE,
      entityType: 'Setting',
      entityLabel: 'Validity extended',
      description: `Valid to ${dayjs(result.validTo).format('DD/MM/YYYY')}: ${result.extended.map((x) => x.name).join(', ')}`,
    });
  }
  return success(res, { message: `${result.extended.length} extended to ${dayjs(result.validTo).format('DD/MM/YYYY')}`, data: result });
});

export default { list, checklist, close, reopen, balances, status, exportPack, newYear, newYearTargets, newYearExtend };
