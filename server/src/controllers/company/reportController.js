import dayjs from 'dayjs';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';

import * as reportService from '../../services/reportService.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';

/**
 * Phase 8 - Reports controller.
 *
 * Read-only. Every handler resolves the requested window, applies role scoping
 * (a salesman only ever sees their own numbers), delegates to reportService and
 * returns the plain result. The export endpoint re-runs one of the reports and
 * streams it to Excel.
 */

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Safely build an ObjectId; returns null for anything malformed. */
const toOid = (id) => {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
};

/** Build the shared window + knobs from a validated query. */
const windowFrom = (query) => reportService.resolveWindow(query);

export const overview = asyncHandler(async (req, res) => {
  const window = windowFrom(req.query);
  const data = await reportService.overviewReport({ companyId: req.companyId, window });
  return success(res, { data });
});

export const sales = asyncHandler(async (req, res) => {
  const window = windowFrom(req.query);
  const scope = {};
  const salesman = req.user?.role === 'SALESMAN' ? req.user.id : req.query.salesman;
  const salesmanOid = salesman ? toOid(salesman) : null;
  if (salesmanOid) scope.salesman = salesmanOid;

  const data = await reportService.salesReport({
    companyId: req.companyId,
    window,
    granularity: req.query.granularity || 'day',
    top: Number(req.query.top || 10),
    scope,
  });
  return success(res, { data });
});

export const receivables = asyncHandler(async (req, res) => {
  const data = await reportService.receivablesReport({
    companyId: req.companyId,
    buckets: Number(req.query.buckets || 30),
    top: Number(req.query.top || 10),
    customerId: req.query.customerId || null,
  });
  return success(res, { data });
});

export const collections = asyncHandler(async (req, res) => {
  const window = windowFrom(req.query);
  const scope = {};
  const collector = req.user?.role === 'SALESMAN' ? req.user.id : req.query.salesman;
  const collectorOid = collector ? toOid(collector) : null;
  if (collectorOid) scope.collectedBy = collectorOid;

  const data = await reportService.collectionsReport({
    companyId: req.companyId,
    window,
    granularity: req.query.granularity || 'day',
    top: Number(req.query.top || 10),
    scope,
  });
  return success(res, { data });
});

export const inventory = asyncHandler(async (req, res) => {
  const window = windowFrom(req.query);
  const data = await reportService.inventoryReport({
    companyId: req.companyId,
    window,
    granularity: req.query.granularity || 'day',
    top: Number(req.query.top || 10),
    warehouseId: req.query.warehouseId || null,
  });
  return success(res, { data });
});

export const fieldForce = asyncHandler(async (req, res) => {
  const window = windowFrom(req.query);
  const salesman = req.user?.role === 'SALESMAN' ? req.user.id : req.query.salesman || null;
  const data = await reportService.fieldForceReport({
    companyId: req.companyId,
    window,
    granularity: req.query.granularity || 'day',
    top: Number(req.query.top || 10),
    salesman,
  });
  return success(res, { data });
});

// ---------------------------------------------------------------------------
// Excel export
// ---------------------------------------------------------------------------

const styleSheet = (sheet) => {
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
};

export const exportXlsx = asyncHandler(async (req, res) => {
  const type = req.query.type;
  const window = windowFrom(req.query);
  const scope = req.user?.role === 'SALESMAN' ? { salesman: toOid(req.user.id) } : {};

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ElevIQ SFA';
  workbook.created = new Date();

  let sheet;
  let label;

  if (type === 'sales') {
    label = 'Sales';
    const r = await reportService.salesReport({
      companyId: req.companyId, window, granularity: 'day', top: 100, scope,
    });
    sheet = workbook.addWorksheet('Sales by customer', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Customer', key: 'name', width: 34 },
      { header: 'Code', key: 'code', width: 16 },
      { header: 'Invoices', key: 'count', width: 12 },
      { header: 'Invoiced', key: 'value', width: 16 },
      { header: 'Outstanding', key: 'outstanding', width: 16 },
    ];
    styleSheet(sheet);
    r.byCustomer.forEach((c) => sheet.addRow(c));
    addTotalRow(sheet, ['count', 'value', 'outstanding'], r.byCustomer.length, 'Total');
  } else if (type === 'receivables') {
    label = 'Receivables';
    const r = await reportService.receivablesReport({
      companyId: req.companyId, buckets: Number(req.query.buckets || 30), top: 100,
    });
    sheet = workbook.addWorksheet('Open invoices', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Invoice No', key: 'invoiceNo', width: 20 },
      { header: 'Invoice Date', key: 'invoiceDate', width: 14 },
      { header: 'Due Date', key: 'dueDate', width: 14 },
      { header: 'Customer', key: 'customerName', width: 32 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'Outstanding', key: 'outstanding', width: 16 },
    ];
    styleSheet(sheet);
    r.invoices.forEach((i) => sheet.addRow({ ...i, invoiceDate: fmt(i.invoiceDate), dueDate: fmt(i.dueDate) }));
    addTotalRow(sheet, ['total', 'outstanding'], r.invoices.length, 'Total', r.invoices);
  } else if (type === 'collections') {
    label = 'Collections';
    const r = await reportService.collectionsReport({
      companyId: req.companyId, window, granularity: 'day', top: 100, scope,
    });
    sheet = workbook.addWorksheet('By mode', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Mode', key: 'mode', width: 16 },
      { header: 'Payments', key: 'count', width: 12 },
      { header: 'Received', key: 'value', width: 16 },
      { header: 'Applied', key: 'applied', width: 16 },
    ];
    styleSheet(sheet);
    r.byMode.forEach((m) => sheet.addRow(m));
    addTotalRow(sheet, ['count', 'value', 'applied'], r.byMode.length, 'Total', r.byMode);
  } else if (type === 'inventory') {
    label = 'Inventory';
    const r = await reportService.inventoryReport({
      companyId: req.companyId, window, granularity: 'day', top: 100,
    });
    sheet = workbook.addWorksheet('Low stock', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Product', key: 'name', width: 34 },
      { header: 'SKU', key: 'sku', width: 16 },
      { header: 'Unit', key: 'unit', width: 10 },
      { header: 'On hand', key: 'stock', width: 12 },
      { header: 'Reorder level', key: 'lowStockLevel', width: 14 },
    ];
    styleSheet(sheet);
    r.lowStock.forEach((p) => sheet.addRow(p));
    addTotalRow(sheet, ['stock'], r.lowStock.length, 'Total', r.lowStock);
  } else {
    label = 'Field force';
    const r = await reportService.fieldForceReport({
      companyId: req.companyId, window, granularity: 'day', top: 100,
      salesman: req.user?.role === 'SALESMAN' ? req.user.id : null,
    });
    sheet = workbook.addWorksheet('Rep activity', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Rep', key: 'name', width: 30 },
      { header: 'Visits', key: 'visits', width: 10 },
      { header: 'Completed', key: 'completed', width: 12 },
      { header: 'Skipped', key: 'skipped', width: 10 },
      { header: 'Order value', key: 'value', width: 16 },
    ];
    styleSheet(sheet);
    r.visits.bySalesman.forEach((s) => sheet.addRow(s));
    addTotalRow(sheet, ['visits', 'completed', 'skipped', 'value'], r.visits.bySalesman.length, 'Total', r.visits.bySalesman);
  }

  const filename = `report-${type}-${dayjs().format('YYYY-MM-DD')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'Report',
    entityLabel: `${label} report`,
    description: `Exported the ${label} report (${window.fromIso} → ${window.toIso}) to Excel`,
  });

  res.end();
});

const fmt = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : '');

function addTotalRow(sheet, numericKeys, count, label, rows = null) {
  if (!count) return;
  sheet.addRow({});
  const values = { [sheet.columns[0].key]: `${label} (${count})` };
  if (rows) {
    numericKeys.forEach((k) => {
      values[k] = round2(rows.reduce((s, r) => s + Number(r[k] || 0), 0));
    });
  }
  const totalRow = sheet.addRow(values);
  totalRow.font = { bold: true };
}

export default { overview, sales, receivables, collections, inventory, fieldForce, exportXlsx };
