import ExcelJS from 'exceljs';
import dayjs from 'dayjs';

import Setting from '../../models/Setting.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { hasPermission } from '../../middlewares/rbac.js';
import { COST_FIELDS } from '../../middlewares/costVisibility.js';
import { REPORTS, REPORT_GROUPS, findReport, canRun, windowOf } from '../../services/reportRegistry.js';
import { DEFAULT_TZ } from '../../services/fieldForceService.js';

/**
 * Reports hub: the catalog of reports this user may open (grouped Register /
 * MIS / Listing), running one, and exporting it to Excel.
 */

const contextOf = async (req) => {
  const settings = req.settings || (await Setting.forCompany(req.companyId));
  const can = (perm) => hasPermission(req, perm);
  return {
    settings,
    can,
    companyId: req.companyId,
    tz: req.company?.timezone || settings?.timezone || DEFAULT_TZ,
    user: { id: req.user.id, role: req.user.role, teamIds: req.dataScope?.teamIds || [] },
  };
};

const loadRunnable = async (req) => {
  const report = findReport(req.params.code);
  if (!report) throw new NotFoundError('Report not found');
  const ctx = await contextOf(req);
  if (!canRun(report, ctx.can, ctx.settings)) throw new ForbiddenError('You do not have access to this report', 'FORBIDDEN');
  return { report, ctx };
};

/** Cost columns are dropped for users who may not see costs. */
const visibleColumns = (columns, ctx) =>
  ctx.can('products.cost.view') ? columns : columns.filter((c) => !COST_FIELDS.includes(c.key) && !['cost', 'value'].includes(c.key));

export const catalog = asyncHandler(async (req, res) => {
  const ctx = await contextOf(req);
  const reports = REPORTS.filter((r) => canRun(r, ctx.can, ctx.settings)).map((r) => ({
    code: r.code,
    group: r.group,
    title: r.title,
    description: r.description,
    icon: r.icon,
    filters: r.filters,
    statuses: r.statuses || null,
    groupBy: r.groupBy || null,
  }));
  const groups = Object.entries(REPORT_GROUPS).map(([key, g]) => ({ key, label: g.label, count: reports.filter((r) => r.group === key).length }));
  return success(res, { data: { groups, reports, canExport: ctx.can('reports.export') } });
});

export const run = asyncHandler(async (req, res) => {
  const { report, ctx } = await loadRunnable(req);
  const result = await report.run(req.query, ctx);
  const columns = visibleColumns(result.columns, ctx);
  const window = report.filters.includes('dateRange') ? windowOf(req.query, ctx.tz) : null;
  return success(res, {
    data: {
      code: report.code,
      title: report.title,
      group: report.group,
      description: report.description,
      columns,
      rows: result.rows,
      totals: result.totals,
      note: result.note || '',
      truncated: Boolean(result.truncated),
      period: window ? { from: window.fromKey, to: window.toKey } : null,
    },
  });
});

const NUMFMT = { money: '#,##0.00', number: '#,##0.##', percent: '0.00"%"' };

export const exportXlsx = asyncHandler(async (req, res) => {
  const { report, ctx } = await loadRunnable(req);
  if (!ctx.can('reports.export')) throw new ForbiddenError('You do not have permission to export reports', 'FORBIDDEN');
  const result = await report.run(req.query, ctx);
  const columns = visibleColumns(result.columns, ctx);
  const window = report.filters.includes('dateRange') ? windowOf(req.query, ctx.tz) : null;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ElevIQ SFA';
  const sheet = wb.addWorksheet(report.title.slice(0, 31));
  const company = req.company?.businessName || '';
  sheet.addRow([company]).font = { bold: true, size: 13 };
  sheet.addRow([report.title + (window ? `  (${dayjs(window.fromKey).format('DD MMM YYYY')} - ${dayjs(window.toKey).format('DD MMM YYYY')})` : '')]).font = { bold: true };
  if (result.note) sheet.addRow([result.note]).font = { italic: true, color: { argb: 'FF666666' } };
  sheet.addRow([]);
  const header = sheet.addRow(columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  result.rows.forEach((r) =>
    sheet.addRow(columns.map((c) => (c.type === 'date' ? (r[c.key] ? new Date(r[c.key]) : '') : r[c.key] ?? '')))
  );
  if (Object.keys(result.totals || {}).length) {
    const totalRow = sheet.addRow(columns.map((c, i) => (i === 0 ? 'Total' : result.totals[c.key] ?? '')));
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => (cell.border = { top: { style: 'thin' } }));
  }
  columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = Math.min(40, Math.max(12, c.label.length + 4));
    if (NUMFMT[c.type]) column.numFmt = NUMFMT[c.type];
    if (c.type === 'date') column.numFmt = 'dd-mm-yyyy';
  });

  const buffer = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${report.code}-${dayjs().format('YYYYMMDD')}.xlsx"`);
  res.send(Buffer.from(buffer));
});

export default { catalog, run, exportXlsx };
