import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import dayjs from 'dayjs';

import Payment from '../../models/Payment.js';
import Invoice from '../../models/Invoice.js';
import Customer from '../../models/Customer.js';
import Setting from '../../models/Setting.js';

import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments, searchRegex } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import {
  AUDIT_ACTIONS,
  PAYMENT_STATUS,
  PAYMENT_STATUS_LIST,
  PAYMENT_MODES,
} from '../../config/constants.js';
import { AppError, BadRequestError, ConflictError, ErrorCodes } from '../../utils/errors.js';
import { toPlain, loadDoc, refOrNull, dateOrNull } from './_helpers.js';
import { PAYMENT_REASONS } from '../../models/Payment.js';
import {
  nextPaymentNumber,
  applyPayment,
  reversePayment,
  loadPayableInvoices,
  assertAllocationsWithinAmount,
  PAYABLE_INVOICE_STATUSES,
} from '../../services/paymentService.js';

/**
 * Phase 6 - Payments & Collections controller.
 * Pattern mirrors creditNoteController: drafts are editable, RECEIVED settles
 * invoices, cancel/bounce reverses exactly what was applied.
 */

const POPULATE = [
  {
    path: 'customerId',
    select: 'name code phone gstin type creditLimit outstanding address',
  },
  { path: 'collectedBy', select: 'name email role' },
  { path: 'createdBy', select: 'name email' },
  { path: 'receivedBy', select: 'name email' },
  { path: 'cancelledBy', select: 'name email' },
];

const SEARCH_FIELDS = ['paymentNo', 'customerName', 'customerCode', 'customerPhone', 'reference'];

const FILTERS_SPEC = {
  status: { type: 'string' },
  customerId: { type: 'objectId' },
  mode: { type: 'string' },
  reason: { type: 'string' },
  collectedBy: { type: 'objectId' },
};

const SORT_ALLOWED = ['paymentDate', 'createdAt', 'updatedAt', 'amount', 'paymentNo', 'status', 'customerName'];

/** Scope a salesman to their own collections, a manager to their team. */
const scopeFilter = (req) => {
  const role = req.user?.role;
  if (role === 'SALESMAN') return { collectedBy: req.user.id };
  if (role === 'MANAGER') {
    const ids = [req.user.id, ...(req.dataScope?.teamIds || [])];
    return { collectedBy: { $in: ids } };
  }
  return {};
};

const aggregateScope = (req) => {
  const role = req.user?.role;
  const oid = (id) => new mongoose.Types.ObjectId(id);
  if (role === 'SALESMAN') return { collectedBy: oid(req.user.id) };
  if (role === 'MANAGER') {
    return { collectedBy: { $in: [req.user.id, ...(req.dataScope?.teamIds || [])].map(oid) } };
  }
  return {};
};

const settingsOf = async (req) => req.settings || (await Setting.forCompany(req.companyId));

const serialize = (doc) => {
  const plain = toPlain(doc);
  const customer = plain?.customerId;
  if (customer && typeof customer === 'object' && customer.name) {
    plain.customer = {
      id: customer.id || String(customer._id),
      name: customer.name,
      code: customer.code || '',
    };
  }
  return plain;
};

const labelOf = (p) => p?.paymentNo || (p?._id ? String(p._id) : 'Payment');

const loadPayment = (req, id) =>
  loadDoc(Payment, id, { populate: POPULATE, filter: scopeFilter(req), label: 'Payment' });

const pushHistory = (payment, status, req, text = '') => {
  payment.statusHistory.push({
    status,
    at: new Date(),
    by: req.user.id,
    byName: req.user.name,
    note: text,
  });
};

/** Normalize incoming allocations: dedupe by invoice, coerce amounts. */
const normalizeAllocations = (raw = []) => {
  const byInvoice = new Map();
  raw.forEach((a) => {
    const invoiceId = String(a.invoice?._id || a.invoice);
    const amount = Number(a.amount || 0);
    if (!invoiceId || !Number.isFinite(amount) || amount <= 0) return;
    byInvoice.set(invoiceId, round2((byInvoice.get(invoiceId) || 0) + amount));
  });
  return [...byInvoice.entries()].map(([invoice, amount]) => ({ invoice, amount }));
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Copy the invoice number onto each allocation for display history. */
const stampInvoiceNos = (allocations, invoicesById) => {
  allocations.forEach((alloc) => {
    const invoice = invoicesById.get(String(alloc.invoice));
    if (invoice?.invoiceNo) alloc.invoiceNo = invoice.invoiceNo;
  });
  return allocations;
};

/** Snapshot customer fields onto the payment for display history. */
const snapshotCustomer = (customer) => ({
  customerId: customer._id,
  customerName: customer.name || '',
  customerCode: customer.code || '',
  customerPhone: customer.phone || '',
});

// ---------------------------------------------------------------------------
// Workflow helpers
// ---------------------------------------------------------------------------

/** Receive a draft payment: confirm allocations and settle invoices. */
const receivePayment = async (req, payment, text = '') => {
  if (payment.status !== PAYMENT_STATUS.DRAFT) {
    throw new ConflictError('Only draft payments can be received', 'PAYMENT_NOT_DRAFT');
  }

  assertAllocationsWithinAmount(payment.amount, payment.allocations);
  const invoicesById = await loadPayableInvoices(payment.allocations);

  payment.status = PAYMENT_STATUS.RECEIVED;
  payment.receivedAt = new Date();
  payment.receivedBy = req.user.id;
  pushHistory(payment, PAYMENT_STATUS.RECEIVED, req, text || 'Payment received');

  await applyPayment(payment, invoicesById);
  await payment.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Payment',
    entityId: payment._id,
    entityLabel: labelOf(payment),
    before: { status: PAYMENT_STATUS.DRAFT },
    after: { status: PAYMENT_STATUS.RECEIVED },
    description: `Payment ${labelOf(payment)} received (${payment.amount} from ${payment.customerName})`,
  });

  return payment;
};

/** Reverse a received payment's allocations and mark it cancelled/bounced. */
const settleReversal = async (req, payment, nextStatus, reason, auditText) => {
  if (payment.status === nextStatus) {
    throw new ConflictError(`Payment is already ${nextStatus.toLowerCase()}`, ErrorCodes.INVALID_STATUS_TRANSITION);
  }
  if (![PAYMENT_STATUS.RECEIVED, PAYMENT_STATUS.DRAFT].includes(payment.status)) {
    throw new ConflictError(
      `A ${payment.status.toLowerCase()} payment cannot be ${nextStatus.toLowerCase()}`,
      ErrorCodes.INVALID_STATUS_TRANSITION
    );
  }

  const before = payment.status;
  if (before === PAYMENT_STATUS.RECEIVED) {
    const invoiceIds = (payment.allocations || []).map((a) => String(a.invoice));
    const invoicesById = invoiceIds.length
      ? new Map((await Invoice.find({ _id: { $in: invoiceIds } })).map((d) => [String(d._id), d]))
      : new Map();
    await reversePayment(payment, invoicesById);
  }

  payment.status = nextStatus;
  if (nextStatus === PAYMENT_STATUS.BOUNCED) {
    payment.bouncedAt = new Date();
    payment.bounceReason = reason;
  } else {
    payment.cancelledAt = new Date();
    payment.cancelledBy = req.user.id;
    payment.cancelReason = reason;
  }
  pushHistory(payment, nextStatus, req, reason || auditText);
  await payment.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'Payment',
    entityId: payment._id,
    entityLabel: labelOf(payment),
    before: { status: before },
    after: { status: nextStatus },
    description: `Payment ${labelOf(payment)} ${nextStatus.toLowerCase()}${reason ? `: ${reason}` : ''}`,
  });

  return payment;
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const list = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req) };
  if (req.query.invoiceId) filter['allocations.invoice'] = req.query.invoiceId;

  const result = await listDocuments(Payment, {
    filter,
    query: req.query,
    searchFields: SEARCH_FIELDS,
    filtersSpec: FILTERS_SPEC,
    sortAllowed: SORT_ALLOWED,
    defaultSort: '-paymentDate',
    dateField: 'paymentDate',
    populate: POPULATE,
  });

  return paginated(res, { data: result.data.map(serialize), ...result.meta });
});

export const stats = asyncHandler(async (req, res) => {
  const base = {
    companyId: new mongoose.Types.ObjectId(req.companyId),
    isDeleted: { $ne: true },
    ...aggregateScope(req),
  };

  const startOfDay = dayjs().startOf('day').toDate();
  const startOfMonth = dayjs().startOf('month').toDate();

  const [byStatus, today, month, received, outstandingAgg] = await Promise.all([
    Payment.aggregate([{ $match: base }, { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$amount' } } }]),
    Payment.aggregate([
      { $match: { ...base, paymentDate: { $gte: startOfDay }, status: PAYMENT_STATUS.RECEIVED } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$amount' } } },
    ]),
    Payment.aggregate([
      { $match: { ...base, paymentDate: { $gte: startOfMonth }, status: PAYMENT_STATUS.RECEIVED } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$amount' } } },
    ]),
    Payment.aggregate([
      { $match: { ...base, status: PAYMENT_STATUS.RECEIVED } },
      {
        $group: {
          _id: null,
          value: { $sum: '$amount' },
          applied: { $sum: '$amountApplied' },
          unapplied: { $sum: '$unappliedAmount' },
        },
      },
    ]),
    Invoice.aggregate([
      {
        $match: {
          companyId: base.companyId,
          isDeleted: { $ne: true },
          status: { $in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
      },
      { $group: { _id: null, outstanding: { $sum: '$balanceDue' } } },
    ]),
  ]);

  const counts = Object.fromEntries(PAYMENT_STATUS_LIST.map((s) => [s, 0]));
  const values = Object.fromEntries(PAYMENT_STATUS_LIST.map((s) => [s, 0]));
  byStatus.forEach((row) => {
    counts[row._id] = row.count;
    values[row._id] = round2(row.value);
  });

  return success(res, {
    data: {
      total: Object.values(counts).reduce((s, n) => s + n, 0),
      byStatus: counts,
      valuesByStatus: values,
      draftCount: counts.DRAFT || 0,
      receivedCount: counts.RECEIVED || 0,
      receivedValue: round2(received?.[0]?.value),
      appliedValue: round2(received?.[0]?.applied),
      advanceValue: round2(received?.[0]?.unapplied),
      outstanding: round2(outstandingAgg?.[0]?.outstanding),
      today: { count: today?.[0]?.count || 0, value: round2(today?.[0]?.value) },
      month: { count: month?.[0]?.count || 0, value: round2(month?.[0]?.value) },
    },
  });
});

export const get = asyncHandler(async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  return success(res, { data: serialize(payment) });
});

export const create = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const payload = { ...req.body };

  const customer = await Customer.findById(payload.customerId);
  if (!customer) throw new BadRequestError('Customer not found', 'INVALID_REFERENCE');

  const allocations = normalizeAllocations(payload.allocations || []);
  assertAllocationsWithinAmount(payload.amount, allocations);

  // Validate every referenced invoice is payable before persisting anything.
  let invoicesById = new Map();
  if (allocations.length) invoicesById = await loadPayableInvoices(allocations);
  stampInvoiceNos(allocations, invoicesById);

  const payment = new Payment({
    ...snapshotCustomer(customer),
    amount: round2(payload.amount),
    allocations,
    amountApplied: 0,
    unappliedAmount: round2(payload.amount),
    paymentDate: dateOrNull(payload.paymentDate) || new Date(),
    mode: payload.mode || 'CASH',
    reference: payload.reference || '',
    bankName: payload.bankName || '',
    chequeDate: dateOrNull(payload.chequeDate),
    reason: payload.reason || 'INVOICE_SETTLEMENT',
    collectedBy: refOrNull(payload.collectedBy) || req.user.id,
    notes: payload.notes || '',
    status: PAYMENT_STATUS.DRAFT,
    statusHistory: [],
    source: 'WEB',
  });
  pushHistory(payment, PAYMENT_STATUS.DRAFT, req, `Created for ${customer.name}`);

  payment.paymentNo = await nextPaymentNumber(req.companyId, settings, payment.paymentDate);
  await payment.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'Payment',
    entityId: payment._id,
    entityLabel: labelOf(payment),
    after: toPlain(payment),
    description: `Payment ${labelOf(payment)} created for ${customer.name} (${payment.amount})`,
  });

  let message = 'Payment recorded';
  if (payload.receive) {
    await receivePayment(req, payment, 'Received on create');
    message = 'Payment received';
  }

  const full = await loadDoc(Payment, payment._id, { populate: POPULATE, label: 'Payment' });
  return created(res, { message, data: serialize(full) });
});

export const update = asyncHandler(async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  if (payment.status !== PAYMENT_STATUS.DRAFT) {
    throw new ConflictError('Only draft payments can be edited', 'PAYMENT_LOCKED');
  }

  const before = toPlain(payment);
  const payload = { ...req.body };
  delete payload.receive;

  if (payload.amount !== undefined) payment.amount = round2(payload.amount);
  if (payload.paymentDate !== undefined) payment.paymentDate = dateOrNull(payload.paymentDate) || payment.paymentDate;
  if (payload.mode !== undefined) payment.mode = payload.mode;
  if (payload.reference !== undefined) payment.reference = payload.reference;
  if (payload.bankName !== undefined) payment.bankName = payload.bankName;
  if (payload.chequeDate !== undefined) payment.chequeDate = dateOrNull(payload.chequeDate);
  if (payload.reason !== undefined) payment.reason = payload.reason;
  if (payload.collectedBy !== undefined) payment.collectedBy = refOrNull(payload.collectedBy);
  if (payload.notes !== undefined) payment.notes = payload.notes;

  if (payload.allocations !== undefined) {
    const allocations = normalizeAllocations(payload.allocations);
    assertAllocationsWithinAmount(payment.amount, allocations);
    if (allocations.length) {
      const invoicesById = await loadPayableInvoices(allocations);
      stampInvoiceNos(allocations, invoicesById);
    }
    payment.allocations = allocations;
  }
  payment.unappliedAmount = round2(payment.amount);

  await payment.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Payment',
    entityId: payment._id,
    entityLabel: labelOf(payment),
    before,
    after: toPlain(payment),
    description: `Payment ${labelOf(payment)} updated`,
  });

  const full = await loadDoc(Payment, payment._id, { populate: POPULATE, label: 'Payment' });
  return success(res, { message: 'Payment updated', data: serialize(full) });
});

export const remove = asyncHandler(async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  if (payment.status !== PAYMENT_STATUS.DRAFT) {
    throw new ConflictError(
      'Only draft payments can be deleted. Cancel this payment instead.',
      'PAYMENT_LOCKED'
    );
  }

  const snapshot = toPlain(payment);
  await payment.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'Payment',
    entityId: payment._id,
    entityLabel: labelOf(payment),
    before: snapshot,
    description: `Draft payment ${labelOf(payment)} deleted`,
  });

  return success(res, { message: 'Payment deleted', data: { id: String(payment._id) } });
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const receive = asyncHandler(async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  await receivePayment(req, payment, req.body?.note || '');

  const full = await loadDoc(Payment, payment._id, { populate: POPULATE, label: 'Payment' });
  return success(res, { message: 'Payment received', data: serialize(full) });
});

export const cancel = asyncHandler(async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  const reason = req.body?.reason || '';
  await settleReversal(req, payment, PAYMENT_STATUS.CANCELLED, reason, 'Payment cancelled');

  const full = await loadDoc(Payment, payment._id, { populate: POPULATE, label: 'Payment' });
  return success(res, { message: 'Payment cancelled', data: serialize(full) });
});

export const bounce = asyncHandler(async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  if (payment.status !== PAYMENT_STATUS.RECEIVED) {
    throw new ConflictError('Only received payments can be marked as bounced', ErrorCodes.INVALID_STATUS_TRANSITION);
  }
  const reason = req.body?.reason || '';
  await settleReversal(req, payment, PAYMENT_STATUS.BOUNCED, reason, 'Payment bounced');

  const full = await loadDoc(Payment, payment._id, { populate: POPULATE, label: 'Payment' });
  return success(res, { message: 'Payment marked as bounced', data: serialize(full) });
});

// ---------------------------------------------------------------------------
// Form options
// ---------------------------------------------------------------------------

export const formOptions = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const invoiceId = refOrNull(req.query.invoiceId);
  const customerId = refOrNull(req.query.customerId);

  const invoiceFilter = { status: { $in: PAYABLE_INVOICE_STATUSES } };
  if (customerId) invoiceFilter.customerId = customerId;

  const invoices = await Invoice.find(invoiceFilter)
    .select('invoiceNo invoiceDate dueDate status total amountPaid balanceDue customerName customerId')
    .sort({ dueDate: 1 })
    .limit(200)
    .lean();

  const idOf = (d) => ({ ...d, id: String(d._id), _id: undefined });

  let invoice = null;
  if (invoiceId) {
    const doc = await Invoice.findById(invoiceId);
    if (!doc) throw new BadRequestError('Invoice not found', 'INVALID_REFERENCE');
    if (!PAYABLE_INVOICE_STATUSES.includes(doc.status)) {
      throw new AppError('This invoice cannot accept a payment', {
        status: 422,
        code: 'INVOICE_NOT_PAYABLE',
      });
    }
    invoice = {
      id: String(doc._id),
      invoiceNo: doc.invoiceNo,
      invoiceDate: doc.invoiceDate,
      dueDate: doc.dueDate,
      status: doc.status,
      total: Number(doc.total || 0),
      amountPaid: Number(doc.amountPaid || 0),
      creditNoteTotal: Number(doc.creditNoteTotal || 0),
      balanceDue: Number(doc.balanceDue || 0),
      customerId: String(doc.customerId),
      customerName: doc.customerName,
      orderNo: doc.orderNo || '',
    };
  }

  return success(res, {
    data: {
      invoice,
      invoices: invoices.map((i) => ({
        ...idOf(i),
        total: Number(i.total || 0),
        amountPaid: Number(i.amountPaid || 0),
        balanceDue: Number(i.balanceDue || 0),
        customerId: String(i.customerId),
      })),
      reasons: PAYMENT_REASONS,
      modes: PAYMENT_MODES,
      settings: {
        currency: settings?.currency || 'INR',
        currencySymbol: settings?.currencySymbol || '₹',
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Export / print
// ---------------------------------------------------------------------------

const buildExportFilter = (req) => {
  const filter = { ...scopeFilter(req) };

  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = SEARCH_FIELDS.map((f) => ({ [f]: rx }));
  }
  ['status', 'customerId', 'mode', 'reason', 'collectedBy'].forEach((key) => {
    if (req.query[key]) filter[key] = req.query[key];
  });
  if (req.query.invoiceId) filter['allocations.invoice'] = req.query.invoiceId;

  if (req.query.dateFrom || req.query.dateTo) {
    const range = {};
    if (req.query.dateFrom) range.$gte = new Date(req.query.dateFrom);
    if (req.query.dateTo) {
      const to = new Date(req.query.dateTo);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateTo))) to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
    filter.paymentDate = { ...(filter.paymentDate || {}), ...range };
  }
  return filter;
};

export const exportXlsx = asyncHandler(async (req, res) => {
  const payments = await Payment.find(buildExportFilter(req))
    .sort({ paymentDate: -1 })
    .limit(5000)
    .populate('customerId', 'name code phone')
    .lean();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ElevIQ SFA';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Payments', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Payment No', key: 'paymentNo', width: 20 },
    { header: 'Date', key: 'paymentDate', width: 14 },
    { header: 'Customer', key: 'customer', width: 32 },
    { header: 'Customer Code', key: 'customerCode', width: 16 },
    { header: 'Mode', key: 'mode', width: 14 },
    { header: 'Reference', key: 'reference', width: 18 },
    { header: 'Reason', key: 'reason', width: 20 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Amount', key: 'amount', width: 16 },
    { header: 'Applied', key: 'amountApplied', width: 14 },
    { header: 'Advance', key: 'unappliedAmount', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };

  payments.forEach((p) => {
    sheet.addRow({
      paymentNo: p.paymentNo,
      paymentDate: p.paymentDate ? dayjs(p.paymentDate).format('YYYY-MM-DD') : '',
      customer: p.customerId?.name || p.customerName || '',
      customerCode: p.customerCode || p.customerId?.code || '',
      mode: p.mode || '',
      reference: p.reference || '',
      reason: p.reason || '',
      status: p.status,
      amount: Number(p.amount || 0),
      amountApplied: Number(p.amountApplied || 0),
      unappliedAmount: Number(p.unappliedAmount || 0),
    });
  });

  if (payments.length) {
    sheet.addRow({});
    const totalRow = sheet.addRow({
      paymentNo: `Total (${payments.length} payments)`,
      amount: payments.reduce((s, p) => s + Number(p.amount || 0), 0),
      amountApplied: payments.reduce((s, p) => s + Number(p.amountApplied || 0), 0),
    });
    totalRow.font = { bold: true };
  }

  const filename = `payments-${dayjs().format('YYYY-MM-DD')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'Payment',
    entityLabel: 'Payment register',
    description: `Exported ${payments.length} payments to Excel`,
  });

  res.end();
});

const money2 = (n) => Number(n || 0).toFixed(2);

export const pdf = asyncHandler(async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  const settings = await settingsOf(req);
  const company = req.company || {};
  const customer = payment.customerId || {};

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const filename = `receipt-${(payment.paymentNo || payment._id).toString().replace(/[^a-z0-9-]/gi, '')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);

  const left = 40;
  const right = 555;

  doc.font('Helvetica-Bold').fontSize(18).text(company.businessName || 'ElevIQ SFA', left, 40);
  doc.font('Helvetica').fontSize(8).fillColor('#555');
  const companyLine = [
    company.code ? `Code: ${company.code}` : '',
    company.gstin ? `GSTIN: ${company.gstin}` : '',
    company.phone || '',
    company.email || '',
  ]
    .filter(Boolean)
    .join('  |  ');
  if (companyLine) doc.text(companyLine, left, 62);
  doc.fillColor('#000');

  doc.font('Helvetica-Bold').fontSize(14).text('PAYMENT RECEIPT', right - 180, 40, { width: 180, align: 'right' });
  doc.font('Helvetica').fontSize(9);
  doc.text(`Receipt No: ${payment.paymentNo || '—'}`, right - 220, 62, { width: 220, align: 'right' });
  doc.text(`Date: ${payment.paymentDate ? dayjs(payment.paymentDate).format('DD MMM YYYY') : '—'}`, right - 220, 75, {
    width: 220,
    align: 'right',
  });
  doc.text(`Status: ${payment.status}`, right - 220, 88, { width: 220, align: 'right' });

  doc.moveTo(left, 114).lineTo(right, 114).strokeColor('#cbd5e1').stroke();

  doc.font('Helvetica-Bold').fontSize(9).text('CUSTOMER', left, 126);
  doc.font('Helvetica').fontSize(9);
  doc.text(payment.customerName || customer.name || '—', left, 140, { width: 240 });
  if (payment.customerPhone || customer.phone) {
    doc.text(`Phone: ${payment.customerPhone || customer.phone}`, left, 154, { width: 240 });
  }

  doc.font('Helvetica-Bold').fontSize(9).text('PAYMENT DETAILS', 300, 126);
  doc.font('Helvetica').fontSize(9);
  doc.text(`Mode: ${String(payment.mode || '—').replace(/_/g, ' ')}`, 300, 140, { width: 255 });
  if (payment.reference) doc.text(`Reference: ${payment.reference}`, 300, 154, { width: 255 });
  if (payment.bankName) doc.text(`Bank: ${payment.bankName}`, 300, 168, { width: 255 });
  doc.text(`Reason: ${String(payment.reason || '—').replace(/_/g, ' ')}`, 300, 182, { width: 255 });

  let y = 214;
  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('Invoice', left, y, { width: 260 });
  doc.text('Amount applied', right - 120, y, { width: 120, align: 'right' });
  y += 13;
  doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor('#cbd5e1').stroke();
  doc.font('Helvetica').fontSize(9);

  (payment.allocations || []).forEach((alloc) => {
    doc.text(alloc.invoiceNo || String(alloc.invoice), left, y, { width: 260 });
    doc.text(money2(alloc.amount), right - 120, y, { width: 120, align: 'right' });
    y += 15;
  });

  if (!(payment.allocations || []).length) {
    doc.text('Advance (no invoice allocated)', left, y, { width: 300 });
    y += 15;
  }

  y += 8;
  doc.moveTo(left, y).lineTo(right, y).strokeColor('#cbd5e1').stroke();
  y += 10;

  doc.font('Helvetica').fontSize(9);
  doc.text('Total received', 350, y, { width: 120, align: 'right' });
  doc.text(`${settings?.currencySymbol || 'Rs.'} ${money2(payment.amount)}`, 475, y, { width: 80, align: 'right' });
  y += 14;
  doc.text('Applied to invoices', 350, y, { width: 120, align: 'right' });
  doc.text(money2(payment.amountApplied), 475, y, { width: 80, align: 'right' });
  y += 14;
  doc.text('Advance / unallocated', 350, y, { width: 120, align: 'right' });
  doc.text(money2(payment.unappliedAmount), 475, y, { width: 80, align: 'right' });

  const footerY = Math.max(y + 40, 700);
  doc.font('Helvetica').fontSize(8).fillColor('#555');
  if (payment.notes) doc.text(`Notes: ${payment.notes}`, left, footerY, { width: 340 });
  doc.text(`Generated by ElevIQ SFA on ${dayjs().format('DD MMM YYYY HH:mm')}`, left, 790, {
    width: 515,
    align: 'center',
  });

  doc.end();

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'Payment',
    entityId: payment._id,
    entityLabel: labelOf(payment),
    description: `Printed payment receipt ${labelOf(payment)}`,
  });
});

export default {
  list,
  stats,
  get,
  create,
  update,
  remove,
  receive,
  cancel,
  bounce,
  formOptions,
  exportXlsx,
  pdf,
};
