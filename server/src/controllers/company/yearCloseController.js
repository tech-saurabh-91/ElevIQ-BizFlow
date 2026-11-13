import mongoose from 'mongoose';
import Company from '../../models/Company.js';
import YearBalance from '../../models/YearBalance.js';
import FinancialYear from '../../models/FinancialYear.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { success, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../middlewares/audit.js';
import { escapeRegex } from '../../utils/query.js';
import * as years from '../../services/yearCloseService.js';

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
  const result = await years.closeYear({ companyId: req.companyId, tag: req.params.tag, user: req.user, notes: req.body?.notes || '' });
  audit(req, {
    action: AUDIT_ACTIONS.YEAR_CLOSE,
    entityType: 'FinancialYear',
    entityId: result.doc._id,
    entityLabel: result.year.label,
    after: result.doc.totals,
    description: `${result.year.label} closed - documents up to ${result.year.endDay} are locked`,
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

export default { list, checklist, close, reopen, balances };
