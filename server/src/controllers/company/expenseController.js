import mongoose from 'mongoose';
import dayjs from 'dayjs';
import ExcelJS from 'exceljs';

import Expense from '../../models/Expense.js';
import User from '../../models/User.js';
import Customer from '../../models/Customer.js';
import Setting from '../../models/Setting.js';

import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments, searchRegex } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import {
  AUDIT_ACTIONS,
  EXPENSE_STATUS,
  EXPENSE_STATUS_LIST,
  EXPENSE_CATEGORIES,
} from '../../config/constants.js';
import { BadRequestError, ConflictError, ErrorCodes } from '../../utils/errors.js';
import { toPlain, loadDoc, refOrNull, dateOrNull } from './_helpers.js';
import { nextExpenseNumber } from '../../services/fieldForceService.js';

/**
 * Phase 7 - Expense claims controller.
 *
 * Workflow: DRAFT -> SUBMITTED -> APPROVED -> PAID (or REJECTED).
 * A claimant edits their own drafts; submission locks them. Only an approver
 * (manager/admin/accountant) can approve/reject or mark a claim paid, and every
 * transition is stamped with who/when/why. Salesmen only ever see their own
 * claims, managers see their team's, admins see everything.
 */

const POPULATE = [
  { path: 'claimant', select: 'name email role title' },
  { path: 'customer', select: 'name code phone' },
  { path: 'approvedBy', select: 'name email' },
  { path: 'rejectedBy', select: 'name email' },
  { path: 'paidBy', select: 'name email' },
  { path: 'createdBy', select: 'name email' },
];

const SEARCH_FIELDS = ['expenseNo', 'claimantName', 'description', 'customerName', 'paymentReference'];

const SORT_ALLOWED = ['expenseDate', 'createdAt', 'amount', 'expenseNo', 'status', 'category', 'claimantName'];

const settingsOf = async (req) => req.settings || (await Setting.forCompany(req.companyId));
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const labelOf = (d) => d?.expenseNo || (d?._id ? String(d._id) : 'Expense');

/** Salesman -> own, manager -> team, others -> all. */
const scopeFilter = (req) => {
  const role = req.user?.role;
  if (role === 'SALESMAN') return { claimant: req.user.id };
  if (role === 'MANAGER') {
    const ids = [req.user.id, ...(req.dataScope?.teamIds || [])];
    return { claimant: { $in: ids } };
  }
  return {};
};

const pushHistory = (doc, status, req, text = '') => {
  doc.statusHistory.push({ status, at: new Date(), by: req.user.id, byName: req.user.name, note: text });
};

const loadExpense = (req, id) =>
  loadDoc(Expense, id, { populate: POPULATE, filter: scopeFilter(req), label: 'Expense' });

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------

export const list = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req) };
  if (req.query.me === 'true') filter.claimant = req.user.id;
  else if (req.query.claimant) filter.claimant = req.query.claimant;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.customer) filter.customer = req.query.customer;

  const result = await listDocuments(Expense, {
    filter,
    query: req.query,
    searchFields: SEARCH_FIELDS,
    filtersSpec: {
      claimant: { type: 'objectId' },
      customer: { type: 'objectId' },
      status: { type: 'string' },
      category: { type: 'string' },
    },
    sortAllowed: SORT_ALLOWED,
    defaultSort: '-expenseDate',
    dateField: 'expenseDate',
    populate: POPULATE,
  });

  return paginated(res, { data: result.data.map(toPlain), ...result.meta });
});

export const get = asyncHandler(async (req, res) => {
  const doc = await loadExpense(req, req.params.id);
  return success(res, { data: toPlain(doc) });
});

export const stats = asyncHandler(async (req, res) => {
  const base = {
    companyId: new mongoose.Types.ObjectId(req.companyId),
    isDeleted: { $ne: true },
    ...aggregateScope(req),
  };

  const startOfMonth = dayjs().startOf('month').toDate();

  // Reimbursable money is the APPROVED amount, not the claimed one — a claim
  // approved for less than asked should reduce the "ready to reimburse" figure.
  const reimbursable = { $ifNull: ['$approvedAmount', 0] };

  const [byStatus, byCategory, month, reimbursableByStatus] = await Promise.all([
    Expense.aggregate([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$amount' } } },
    ]),
    Expense.aggregate([
      { $match: { ...base, status: { $in: [EXPENSE_STATUS.APPROVED, EXPENSE_STATUS.PAID, EXPENSE_STATUS.SUBMITTED] } } },
      { $group: { _id: '$category', count: { $sum: 1 }, value: { $sum: '$amount' } } },
    ]),
    Expense.aggregate([
      { $match: { ...base, expenseDate: { $gte: startOfMonth } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$amount' } } },
    ]),
    Expense.aggregate([
      { $match: { ...base, status: { $in: [EXPENSE_STATUS.APPROVED, EXPENSE_STATUS.PAID] } } },
      { $group: { _id: '$status', value: { $sum: reimbursable } } },
    ]),
  ]);

  const counts = Object.fromEntries(EXPENSE_STATUS_LIST.map((s) => [s, 0]));
  const values = Object.fromEntries(EXPENSE_STATUS_LIST.map((s) => [s, 0]));
  byStatus.forEach((row) => {
    counts[row._id] = row.count;
    values[row._id] = round2(row.value);
  });

  const pending = (counts.SUBMITTED || 0);
  const pendingValue = values.SUBMITTED || 0;
  const reimbursableMap = Object.fromEntries(reimbursableByStatus.map((r) => [r._id, round2(r.value)]));
  const approvedValue = reimbursableMap.APPROVED || 0;
  const paidValue = reimbursableMap.PAID || 0;
  const m = month[0] || {};

  return success(res, {
    data: {
      total: Object.values(counts).reduce((s, n) => s + n, 0),
      byStatus: counts,
      valuesByStatus: values,
      pendingCount: pending,
      pendingValue: round2(pendingValue),
      approvedValue: round2(approvedValue),
      paidValue: round2(paidValue),
      month: { count: Number(m.count || 0), value: round2(m.value) },
      byCategory: Object.fromEntries(
        byCategory.map((r) => [r._id, { count: r.count, value: round2(r.value) }])
      ),
    },
  });
});

// ---------------------------------------------------------------------------
// CRUD (drafts only)
// ---------------------------------------------------------------------------

export const create = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const payload = { ...req.body };

  // A rep always claims for themselves; managers may log on someone's behalf.
  const claimantId = req.user.role === 'SALESMAN' ? req.user.id : payload.claimant || req.user.id;
  const claimant = await User.findById(claimantId);
  if (!claimant) throw new BadRequestError('Claimant not found', 'INVALID_REFERENCE');

  const customer = refOrNull(payload.customer) ? await Customer.findById(payload.customer) : null;

  const doc = new Expense({
    claimant: claimant._id,
    claimantName: claimant.name || '',
    claimantRole: claimant.role || '',
    expenseDate: dateOrNull(payload.expenseDate) || new Date(),
    category: payload.category,
    amount: round2(payload.amount),
    description: payload.description || '',
    customer: customer?._id || null,
    customerName: customer?.name || '',
    visit: refOrNull(payload.visit) || null,
    receiptUrl: payload.receiptUrl || '',
    hasReceipt: Boolean(payload.receiptUrl),
    fromPlace: payload.fromPlace || '',
    toPlace: payload.toPlace || '',
    distanceKm: Number(payload.distanceKm || 0),
    notes: payload.notes || '',
    status: EXPENSE_STATUS.DRAFT,
    statusHistory: [],
    source: 'WEB',
  });

  pushHistory(doc, EXPENSE_STATUS.DRAFT, req, `Created for ${claimant.name}`);
  doc.expenseNo = await nextExpenseNumber(req.companyId, settings, doc.expenseDate);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'Expense',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    after: toPlain(doc),
    description: `Expense ${labelOf(doc)} created for ${claimant.name} (${doc.amount})`,
  });

  let message = 'Expense saved as draft';
  if (payload.submit) {
    await submitDoc(req, doc, 'Submitted on create');
    message = 'Expense submitted';
  }

  const full = await loadDoc(Expense, doc._id, { populate: POPULATE, label: 'Expense' });
  return created(res, { message, data: toPlain(full) });
});

export const update = asyncHandler(async (req, res) => {
  const doc = await loadExpense(req, req.params.id);
  if (doc.status !== EXPENSE_STATUS.DRAFT) {
    throw new ConflictError('Only draft expenses can be edited', 'EXPENSE_LOCKED');
  }

  const before = toPlain(doc);
  const payload = { ...req.body };

  if (payload.expenseDate !== undefined) doc.expenseDate = dateOrNull(payload.expenseDate) || doc.expenseDate;
  if (payload.category !== undefined) doc.category = payload.category;
  if (payload.amount !== undefined) doc.amount = round2(payload.amount);
  if (payload.description !== undefined) doc.description = payload.description;
  if (payload.receiptUrl !== undefined) {
    doc.receiptUrl = payload.receiptUrl;
    doc.hasReceipt = Boolean(payload.receiptUrl);
  }
  if (payload.fromPlace !== undefined) doc.fromPlace = payload.fromPlace;
  if (payload.toPlace !== undefined) doc.toPlace = payload.toPlace;
  if (payload.distanceKm !== undefined) doc.distanceKm = Number(payload.distanceKm || 0);
  if (payload.notes !== undefined) doc.notes = payload.notes;
  if (payload.customer !== undefined) {
    const customer = refOrNull(payload.customer) ? await Customer.findById(payload.customer) : null;
    doc.customer = customer?._id || null;
    doc.customerName = customer?.name || '';
  }

  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Expense',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    before,
    after: toPlain(doc),
    description: `Expense ${labelOf(doc)} updated`,
  });

  const full = await loadDoc(Expense, doc._id, { populate: POPULATE, label: 'Expense' });
  return success(res, { message: 'Expense updated', data: toPlain(full) });
});

export const remove = asyncHandler(async (req, res) => {
  const doc = await loadExpense(req, req.params.id);
  if (doc.status !== EXPENSE_STATUS.DRAFT) {
    throw new ConflictError('Only draft expenses can be deleted. Reject this claim instead.', 'EXPENSE_LOCKED');
  }

  const snapshot = toPlain(doc);
  await doc.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'Expense',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    before: snapshot,
    description: `Draft expense ${labelOf(doc)} deleted`,
  });

  return success(res, { message: 'Expense deleted', data: { id: String(doc._id) } });
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

const submitDoc = async (req, doc, text = '') => {
  if (doc.status !== EXPENSE_STATUS.DRAFT) {
    throw new ConflictError('Only draft expenses can be submitted', 'EXPENSE_NOT_DRAFT');
  }
  if (Number(doc.amount || 0) <= 0) {
    throw new BadRequestError('An expense amount greater than zero is required', 'VALIDATION_ERROR');
  }

  doc.status = EXPENSE_STATUS.SUBMITTED;
  doc.submittedAt = new Date();
  pushHistory(doc, EXPENSE_STATUS.SUBMITTED, req, text || 'Submitted for approval');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Expense',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    before: { status: EXPENSE_STATUS.DRAFT },
    after: { status: EXPENSE_STATUS.SUBMITTED },
    description: `Expense ${labelOf(doc)} submitted`,
  });
  return doc;
};

export const submit = asyncHandler(async (req, res) => {
  const doc = await loadExpense(req, req.params.id);
  await submitDoc(req, doc, req.body?.note || '');

  const full = await loadDoc(Expense, doc._id, { populate: POPULATE, label: 'Expense' });
  return success(res, { message: 'Expense submitted for approval', data: toPlain(full) });
});

export const approve = asyncHandler(async (req, res) => {
  const doc = await loadExpense(req, req.params.id);
  if (doc.status !== EXPENSE_STATUS.SUBMITTED) {
    throw new ConflictError('Only submitted expenses can be approved', 'EXPENSE_NOT_SUBMITTED');
  }

  const approvedAmount = req.body?.approvedAmount;
  const amount =
    approvedAmount == null || approvedAmount === ''
      ? Number(doc.amount || 0)
      : round2(approvedAmount);

  if (amount > Number(doc.amount || 0)) {
    throw new BadRequestError('Approved amount cannot exceed the claimed amount', 'VALIDATION_ERROR');
  }

  doc.status = EXPENSE_STATUS.APPROVED;
  doc.approvedBy = req.user.id;
  doc.approvedAt = new Date();
  doc.approvedAmount = amount;
  pushHistory(doc, EXPENSE_STATUS.APPROVED, req, req.body?.note || `Approved ${amount}`);
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.APPROVE,
    entityType: 'Expense',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    before: { status: EXPENSE_STATUS.SUBMITTED },
    after: { status: EXPENSE_STATUS.APPROVED, approvedAmount: amount },
    description: `Expense ${labelOf(doc)} approved (${amount})`,
  });

  const full = await loadDoc(Expense, doc._id, { populate: POPULATE, label: 'Expense' });
  return success(res, { message: 'Expense approved', data: toPlain(full) });
});

export const reject = asyncHandler(async (req, res) => {
  const doc = await loadExpense(req, req.params.id);
  if (doc.status !== EXPENSE_STATUS.SUBMITTED) {
    throw new ConflictError('Only submitted expenses can be rejected', 'EXPENSE_NOT_SUBMITTED');
  }
  const reason = req.body?.reason || '';

  doc.status = EXPENSE_STATUS.REJECTED;
  doc.rejectedBy = req.user.id;
  doc.rejectedAt = new Date();
  doc.rejectionReason = reason;
  pushHistory(doc, EXPENSE_STATUS.REJECTED, req, reason || 'Rejected');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.REJECT,
    entityType: 'Expense',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    before: { status: EXPENSE_STATUS.SUBMITTED },
    after: { status: EXPENSE_STATUS.REJECTED },
    description: `Expense ${labelOf(doc)} rejected${reason ? `: ${reason}` : ''}`,
  });

  const full = await loadDoc(Expense, doc._id, { populate: POPULATE, label: 'Expense' });
  return success(res, { message: 'Expense rejected', data: toPlain(full) });
});

export const markPaid = asyncHandler(async (req, res) => {
  const doc = await loadExpense(req, req.params.id);
  if (doc.status !== EXPENSE_STATUS.APPROVED) {
    throw new ConflictError('Only approved expenses can be marked as paid', 'EXPENSE_NOT_APPROVED');
  }

  doc.status = EXPENSE_STATUS.PAID;
  doc.paidAt = dateOrNull(req.body?.paidAt) || new Date();
  doc.paidBy = req.user.id;
  if (req.body?.paymentMode !== undefined) doc.paymentMode = req.body.paymentMode;
  if (req.body?.paymentReference !== undefined) doc.paymentReference = req.body.paymentReference;
  pushHistory(doc, EXPENSE_STATUS.PAID, req, req.body?.note || 'Marked paid');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Expense',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    before: { status: EXPENSE_STATUS.APPROVED },
    after: { status: EXPENSE_STATUS.PAID },
    description: `Expense ${labelOf(doc)} marked paid`,
  });

  const full = await loadDoc(Expense, doc._id, { populate: POPULATE, label: 'Expense' });
  return success(res, { message: 'Expense marked as paid', data: toPlain(full) });
});

/** Allow an approver to send a rejected claim back for rework (reject -> draft). */
export const reopen = asyncHandler(async (req, res) => {
  const doc = await loadExpense(req, req.params.id);
  if (doc.status !== EXPENSE_STATUS.REJECTED) {
    throw new ConflictError('Only rejected expenses can be reopened', 'EXPENSE_NOT_REJECTED');
  }

  const before = doc.status;
  doc.status = EXPENSE_STATUS.DRAFT;
  pushHistory(doc, EXPENSE_STATUS.DRAFT, req, req.body?.note || 'Reopened for rework');
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Expense',
    entityId: doc._id,
    entityLabel: labelOf(doc),
    before: { status: before },
    after: { status: EXPENSE_STATUS.DRAFT },
    description: `Expense ${labelOf(doc)} reopened`,
  });

  const full = await loadDoc(Expense, doc._id, { populate: POPULATE, label: 'Expense' });
  return success(res, { message: 'Expense reopened', data: toPlain(full) });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const exportXlsx = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req) };
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = SEARCH_FIELDS.map((f) => ({ [f]: rx }));
  }
  ['status', 'category', 'claimant'].forEach((key) => {
    if (req.query[key]) filter[key] = req.query[key];
  });
  if (req.query.dateFrom || req.query.dateTo) {
    const range = {};
    if (req.query.dateFrom) range.$gte = new Date(req.query.dateFrom);
    if (req.query.dateTo) {
      const to = new Date(req.query.dateTo);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateTo))) to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
    filter.expenseDate = range;
  }

  const rows = await Expense.find(filter)
    .populate('claimant', 'name email')
    .populate('customer', 'name code')
    .sort({ expenseDate: -1 })
    .limit(5000)
    .lean();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ElevIQ SFA';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Expenses', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Expense No', key: 'expenseNo', width: 18 },
    { header: 'Date', key: 'expenseDate', width: 14 },
    { header: 'Claimant', key: 'claimant', width: 24 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Customer', key: 'customer', width: 24 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Approved', key: 'approvedAmount', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };

  rows.forEach((r) => {
    sheet.addRow({
      expenseNo: r.expenseNo,
      expenseDate: r.expenseDate ? dayjs(r.expenseDate).format('YYYY-MM-DD') : '',
      claimant: r.claimantName || r.claimant?.name || '',
      category: r.category,
      description: r.description || '',
      customer: r.customerName || r.customer?.name || '',
      amount: Number(r.amount || 0),
      approvedAmount: Number(r.approvedAmount || 0),
      status: r.status,
    });
  });

  if (rows.length) {
    sheet.addRow({});
    const totalRow = sheet.addRow({
      expenseNo: `Total (${rows.length} claims)`,
      amount: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
      approvedAmount: rows.reduce((s, r) => s + Number(r.approvedAmount || 0), 0),
    });
    totalRow.font = { bold: true };
  }

  const filename = `expenses-${dayjs().format('YYYY-MM-DD')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'Expense',
    entityLabel: 'Expense register',
    description: `Exported ${rows.length} expenses to Excel`,
  });

  res.end();
});

// ---------------------------------------------------------------------------
// Form options
// ---------------------------------------------------------------------------

export const formOptions = asyncHandler(async (req, res) => {
  const [customers, teammates] = await Promise.all([
    Customer.find({ isActive: { $ne: false } }).select('name code phone').sort({ name: 1 }).limit(500).lean(),
    User.find({ isActive: { $ne: false }, role: { $in: ['SALESMAN', 'MANAGER', 'COMPANY_ADMIN'] } })
      .select('name email role')
      .sort({ name: 1 })
      .limit(500)
      .lean(),
  ]);

  return success(res, {
    data: {
      categories: EXPENSE_CATEGORIES,
      customers: customers.map((c) => ({ ...c, id: String(c._id) })),
      users: teammates.map((u) => ({ ...u, id: String(u._id) })),
      statusList: EXPENSE_STATUS_LIST,
    },
  });
});

/** Same scope but with ObjectIds (for aggregate()). */
const aggregateScope = (req) => {
  const role = req.user?.role;
  const oid = (id) => new mongoose.Types.ObjectId(id);
  if (role === 'SALESMAN') return { claimant: oid(req.user.id) };
  if (role === 'MANAGER') {
    return { claimant: { $in: [req.user.id, ...(req.dataScope?.teamIds || [])].map(oid) } };
  }
  return {};
};

export default {
  list,
  get,
  stats,
  create,
  update,
  remove,
  submit,
  approve,
  reject,
  markPaid,
  reopen,
  exportXlsx,
  formOptions,
};
