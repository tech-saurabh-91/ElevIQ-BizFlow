import ExcelJS from 'exceljs';
import dayjs from 'dayjs';

import Setting from '../../models/Setting.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';
import { hasPermission, roleHasPermission } from '../../middlewares/rbac.js';
import { COST_FIELDS } from '../../middlewares/costVisibility.js';
import { REPORTS, REPORT_GROUPS, findReport, canRun, missingFor, windowOf } from '../../services/reportRegistry.js';
import { AUDIT_ACTIONS, COMPANY_ROLES } from '../../config/constants.js';
import { audit } from '../../middlewares/audit.js';
import { DEFAULT_TZ } from '../../services/fieldForceService.js';
import { findCountry } from '../../services/locationService.js';

/**
 * Reports hub: the catalog of reports this user may open (grouped Register /
 * MIS / Listing), running one, and exporting it to Excel.
 */

/**
 * Report wording follows the company's tax vocabulary: "GST" / "GSTIN" read
 * as the company's own tax label and tax ID label (VAT, VAT no....) outside
 * India. Only the text changes; the figures are the same.
 */
const taxWording = async (req, settings) => {
  const country = await findCountry(req.company?.country || req.company?.address?.country).catch(() => null);
  const taxLabel = settings?.tax?.taxLabel || country?.tax?.label || 'Tax';
  const taxIdLabel = country?.tax?.taxIdLabel || 'Tax ID';
  if (taxLabel === 'GST' && (!country || country.code === 'IN')) return (text) => text;
  return (text) => (typeof text === 'string' ? text.replace(/\bGSTIN\b/g, taxIdLabel).replace(/\bGST\b/g, taxLabel) : text);
};
const reword = (columns, ctx) => columns.map((c) => ({ ...c, label: ctx.word(c.label) }));

const contextOf = async (req) => {
  const settings = req.settings || (await Setting.forCompany(req.companyId));
  const can = (perm) => hasPermission(req, perm);
  return {
    word: await taxWording(req, settings),
    settings,
    company: req.company,
    can,
    companyId: req.companyId,
    tz: req.company?.timezone || settings?.timezone || DEFAULT_TZ,
    role: req.user.role,
    user: { id: req.user.id, role: req.user.role, teamIds: req.dataScope?.teamIds || [] },
  };
};

const loadRunnable = async (req) => {
  const report = findReport(req.params.code);
  if (!report) throw new NotFoundError('Report not found');
  const ctx = await contextOf(req);
  if (!canRun(report, ctx)) throw new ForbiddenError('You do not have access to this report', 'FORBIDDEN');
  return { report, ctx };
};

/** Cost columns are dropped for users who may not see costs. */
/** Cost / stock-value figures stay hidden without "products.cost.view". */
const STOCK_VALUE_KEYS = ['cost', 'value', 'valueIn', 'valueOut', 'openingValue', 'inValue', 'outValue', 'closingValue', 'rate', 'lineValue', 'runningValue', 'wtAvgCost'];
const isCostKey = (key) => COST_FIELDS.includes(key) || STOCK_VALUE_KEYS.includes(key);
const visibleColumns = (columns, ctx) => (ctx.can('products.cost.view') ? columns : columns.filter((c) => !isCostKey(c.key)));

/** Rows and summary without the hidden figures (not just hidden columns). */
const visibleData = (result, ctx) => {
  if (ctx.can('products.cost.view')) return { rows: result.rows, totals: result.totals, summary: result.summary || null };
  const strip = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !isCostKey(k)));
  return {
    rows: result.rows.map(strip),
    totals: strip(result.totals),
    summary: result.summary ? result.summary.map(({ value, ...rest }) => rest) : null,
  };
};

export const catalog = asyncHandler(async (req, res) => {
  const ctx = await contextOf(req);
  const reports = REPORTS.filter((r) => canRun(r, ctx)).map((r) => ({
    code: r.code,
    group: r.group,
    title: ctx.word(r.title),
    description: ctx.word(r.description),
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
  const columns = reword(visibleColumns(result.columns, ctx), ctx);
  const visible = visibleData(result, ctx);
  const window = report.filters.includes('dateRange') ? windowOf(req.query, ctx.tz) : null;
  return success(res, {
    data: {
      code: report.code,
      title: ctx.word(report.title),
      group: report.group,
      description: ctx.word(report.description),
      columns,
      rows: visible.rows,
      totals: visible.totals,
      summary: visible.summary,
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
  const raw = await report.run(req.query, ctx);
  const columns = reword(visibleColumns(raw.columns, ctx), ctx);
  const result = { ...raw, ...visibleData(raw, ctx) };
  const window = report.filters.includes('dateRange') ? windowOf(req.query, ctx.tz) : null;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ElevIQ SFA';
  const sheet = wb.addWorksheet(ctx.word(report.title).slice(0, 31));
  const company = req.company?.businessName || '';
  sheet.addRow([company]).font = { bold: true, size: 13 };
  sheet.addRow([ctx.word(report.title) + (window ? `  (${dayjs(window.fromKey).format('DD MMM YYYY')} - ${dayjs(window.toKey).format('DD MMM YYYY')})` : '')]).font = { bold: true };
  if (result.note) sheet.addRow([result.note]).font = { italic: true, color: { argb: 'FF666666' } };
  // Summary block (e.g. opening / in / out / net in hand) above the table.
  const TONE_ARGB = { in: 'FF15803D', out: 'FFDC2626' };
  if (Array.isArray(result.summary) && result.summary.length) {
    sheet.addRow([]);
    sheet.addRow(['', 'Qty', 'Value']).font = { bold: true };
    result.summary.forEach((x) => {
      const row = sheet.addRow([x.label, x.qty ?? '', x.value ?? '']);
      row.getCell(2).numFmt = NUMFMT.number || '#,##0.##';
      row.getCell(3).numFmt = NUMFMT.money || '#,##0.00';
      row.font = { bold: Boolean(x.strong), ...(TONE_ARGB[x.tone] ? { color: { argb: TONE_ARGB[x.tone] } } : {}) };
    });
  }
  sheet.addRow([]);
  const header = sheet.addRow(columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  result.rows.forEach((r) => {
    const row = sheet.addRow(columns.map((c) => (c.type === 'date' ? (r[c.key] ? new Date(r[c.key]) : '') : r[c.key] ?? '')));
    // In / out columns in green / red when they carry a figure.
    columns.forEach((c, i) => {
      if (TONE_ARGB[c.tone] && Number(r[c.key])) row.getCell(i + 1).font = { color: { argb: TONE_ARGB[c.tone] } };
    });
  });
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

// ---------------------------------------------------------------------------
// Report-wise access (admin): which role may open which report.
// ---------------------------------------------------------------------------
const ROLES = Object.values(COMPANY_ROLES).filter((r) => r !== COMPANY_ROLES.COMPANY_ADMIN);

const accessView = (settings, company) => {
  const reports = REPORTS.filter((r) => !(r.module && company?.featureFlags?.[r.module] === false)).map((r) => {
    const listed = settings?.reportAccess?.[r.code];
    const roles = {};
    ROLES.forEach((role) => {
      const can = (perm) => roleHasPermission(settings, role, perm);
      const missing = missingFor(r, can);
      roles[role] = {
        allowed: canRun(r, { can, company, settings, role }),
        // Ticking it would still not open the report without these.
        missing,
      };
    });
    return { code: r.code, group: r.group, title: r.title, description: r.description, custom: Array.isArray(listed), roles };
  });
  return { roles: ROLES, groups: Object.entries(REPORT_GROUPS).map(([key, g]) => ({ key, label: g.label })), reports };
};

export const getAccess = asyncHandler(async (req, res) => {
  const settings = await Setting.forCompany(req.companyId);
  return success(res, { data: accessView(settings, req.company) });
});

/** PUT { access: { reportCode: [roles] | null } } - null puts a report back on its group permission. */
export const saveAccess = asyncHandler(async (req, res) => {
  const settings = await Setting.forCompany(req.companyId);
  const next = { ...(settings.reportAccess || {}) };
  Object.entries(req.body.access || {}).forEach(([code, roles]) => {
    if (!findReport(code)) return;
    if (roles === null) delete next[code];
    else next[code] = [...new Set(roles.filter((r) => ROLES.includes(r)))];
  });
  settings.reportAccess = next;
  settings.markModified('reportAccess');
  await settings.save();
  audit(req, { action: AUDIT_ACTIONS.UPDATE, entityType: 'Setting', entityLabel: 'Report access', description: 'Report-wise access updated' });
  return success(res, { message: 'Report access saved', data: accessView(settings, req.company) });
});

export const resetAccess = asyncHandler(async (req, res) => {
  const settings = await Setting.forCompany(req.companyId);
  settings.reportAccess = {};
  settings.markModified('reportAccess');
  await settings.save();
  audit(req, { action: AUDIT_ACTIONS.UPDATE, entityType: 'Setting', entityLabel: 'Report access', description: 'Report access reset to role permissions' });
  return success(res, { message: 'Report access reset', data: accessView(settings, req.company) });
});

/** Roles that can open at least one report (drives the Reports menu item). */
export const rolesWithReports = (settings, company) =>
  [COMPANY_ROLES.COMPANY_ADMIN, ...ROLES.filter((role) => {
    const can = (perm) => roleHasPermission(settings, role, perm);
    return REPORTS.some((r) => canRun(r, { can, company, settings, role }));
  })];

/** Whether this user (with their own Allow / Deny) can open at least one report. */
export const userHasReports = (req) => {
  const can = (perm) => hasPermission(req, perm);
  return REPORTS.some((r) => canRun(r, { can, company: req.company, settings: req.settings, role: req.user?.role }));
};

export default { catalog, run, exportXlsx, getAccess, saveAccess, resetAccess };
