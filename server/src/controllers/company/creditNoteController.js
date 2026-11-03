import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { pdfLocale, taxRows, sellerSnapshot, sellerFor } from '../../utils/pdfLocale.js';
import dayjs from 'dayjs';

import CreditNote from '../../models/CreditNote.js';
import Invoice from '../../models/Invoice.js';
import Customer from '../../models/Customer.js';
import Setting from '../../models/Setting.js';

import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments, searchRegex } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, CREDIT_NOTE_STATUS, CREDIT_NOTE_STATUS_LIST } from '../../config/constants.js';
import { AppError, BadRequestError, ConflictError, ErrorCodes } from '../../utils/errors.js';
import { toPlain, loadDoc, refOrNull, dateOrNull } from './_helpers.js';
import { CREDIT_NOTE_REASONS } from '../../models/CreditNote.js';
import {
  nextCreditNoteNumber,
  buildCreditNoteLinesFromInvoice,
  creditedQtyByInvoiceLine,
  applyCreditNote,
  reverseCreditNote,
} from '../../services/invoiceService.js';
import { taxBreakupFor, sellerStateOf, buyerStateOf } from '../../services/orderService.js';

const POPULATE = [
  {
    path: 'customerId',
    select: 'name code phone gstin type creditLimit creditDays paymentTerms outstanding address shippingAddress',
  },
  {
    path: 'invoice',
    select: 'invoiceNo invoiceDate dueDate status total amountPaid balanceDue creditNoteTotal orderNo',
  },
  { path: 'salesman', select: 'name email role title' },
  { path: 'createdBy', select: 'name email' },
  { path: 'issuedBy', select: 'name email' },
  { path: 'cancelledBy', select: 'name email' },
];

const SEARCH_FIELDS = ['creditNoteNo', 'invoiceNo', 'customerName', 'customerCode', 'customerPhone', 'orderNo'];

const FILTERS_SPEC = {
  status: { type: 'string' },
  customerId: { type: 'objectId' },
  salesman: { type: 'objectId' },
  reason: { type: 'string' },
};

const SORT_ALLOWED = ['creditNoteDate', 'createdAt', 'updatedAt', 'total', 'creditNoteNo', 'status', 'customerName'];

/** Invoices that can receive a credit note. */
const CREDITABLE_INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];

const scopeFilter = (req) => {
  const role = req.user?.role;
  if (role === 'SALESMAN') return { salesman: req.user.id };
  if (role === 'MANAGER') {
    const ids = [req.user.id, ...(req.dataScope?.teamIds || [])];
    return { salesman: { $in: ids } };
  }
  return {};
};

const aggregateScope = (req) => {
  const role = req.user?.role;
  const oid = (id) => new mongoose.Types.ObjectId(id);
  if (role === 'SALESMAN') return { salesman: oid(req.user.id) };
  if (role === 'MANAGER') {
    return { salesman: { $in: [req.user.id, ...(req.dataScope?.teamIds || [])].map(oid) } };
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

const labelOf = (note) =>
  note?.creditNoteNo || (note?._id ? String(note._id) : 'Credit note');

const loadCreditNote = (req, id) =>
  loadDoc(CreditNote, id, { populate: POPULATE, filter: scopeFilter(req), label: 'Credit note' });

const pushHistory = (note, status, req, text = '') => {
  note.statusHistory.push({
    status,
    at: new Date(),
    by: req.user.id,
    byName: req.user.name,
    note: text,
  });
};

const loadInvoiceForCredit = async (invoiceId) => {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new BadRequestError('Invoice not found', 'INVALID_REFERENCE');
  if (!CREDITABLE_INVOICE_STATUSES.includes(invoice.status)) {
    throw new AppError(
      `Invoice ${invoice.invoiceNo || ''} is ${invoice.status.toLowerCase().replace(/_/g, ' ')}; only issued invoices can be credited`,
      { status: 422, code: 'INVOICE_NOT_ISSUED' }
    );
  }
  return invoice;
};

const snapshotFromInvoice = (invoice, customer, payload) => ({
  invoice: invoice._id,
  invoiceNo: invoice.invoiceNo || '',
  order: invoice.order || null,
  orderNo: invoice.orderNo || '',

  customerId: invoice.customerId,
  customerName: invoice.customerName || customer?.name || '',
  customerCode: invoice.customerCode || customer?.code || '',
  customerPhone: invoice.customerPhone || customer?.phone || '',
  customerGstin: invoice.customerGstin || customer?.gstin || '',
  billingAddress: invoice.billingAddress || customer?.address || {},

  salesman: invoice.salesman || null,

  reason: payload.reason || 'SALES_RETURN',
  reasonNote: payload.reasonNote || '',

  creditNoteDate: dateOrNull(payload.creditNoteDate) || new Date(),
  notes: payload.notes || '',
  source: 'WEB',
});

/** Re-check a draft's quantities against what is still creditable on the invoice. */
const assertDraftQuantities = async (note) => {
  const invoice = await Invoice.findById(note.invoice);
  if (!invoice) throw new BadRequestError('Linked invoice not found', 'INVALID_REFERENCE');

  const used = await creditedQtyByInvoiceLine(invoice._id);
  const errors = [];
  (note.items || []).forEach((line, index) => {
    const invoiceLine = (invoice.items || []).find(
      (i) => String(i._id) === String(line.invoiceItemId)
    );
    const credited = used.get(String(line.invoiceItemId)) || 0;
    const remaining = invoiceLine ? Number(invoiceLine.qty || 0) - credited : 0;
    if (!invoiceLine || Number(line.qty) > remaining + 0.0001) {
      errors.push({
        field: `items.${index}.qty`,
        message: `${line.name}: only ${Math.max(0, remaining)} can still be credited (${line.qty} requested)`,
      });
    }
  });

  if (errors.length) {
    throw new AppError('Credit note quantity exceeds the invoice quantity', {
      status: 422,
      code: 'CREDIT_QTY_EXCEEDED',
      errors,
    });
  }

  return invoice;
};

/** Issue a draft credit note and knock the amount off the invoice. */
const issueCreditNote = async (req, note, text = '') => {
  if (note.status !== CREDIT_NOTE_STATUS.DRAFT) {
    throw new ConflictError('Only draft credit notes can be issued', 'CREDIT_NOTE_NOT_DRAFT');
  }

  const invoice = await assertDraftQuantities(note);
  if (!CREDITABLE_INVOICE_STATUSES.includes(invoice.status)) {
    throw new ConflictError('Linked invoice is not issued', 'INVOICE_NOT_ISSUED');
  }

  note.status = CREDIT_NOTE_STATUS.ISSUED;
  note.seller = sellerSnapshot(req.company);
  note.issuedAt = new Date();
  note.issuedBy = req.user.id;
  pushHistory(note, CREDIT_NOTE_STATUS.ISSUED, req, text || 'Credit note issued');

  await applyCreditNote(note, invoice);
  await note.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'CreditNote',
    entityId: note._id,
    entityLabel: labelOf(note),
    before: { status: CREDIT_NOTE_STATUS.DRAFT },
    after: { status: CREDIT_NOTE_STATUS.ISSUED },
    description: `Credit note ${labelOf(note)} issued against ${invoice.invoiceNo} (${note.appliedAmount} applied)`,
  });

  return note;
};

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export const list = asyncHandler(async (req, res) => {
  const filter = { ...scopeFilter(req) };
  if (req.query.invoiceId) filter.invoice = req.query.invoiceId;

  const result = await listDocuments(CreditNote, {
    filter,
    query: req.query,
    searchFields: SEARCH_FIELDS,
    filtersSpec: FILTERS_SPEC,
    sortAllowed: SORT_ALLOWED,
    defaultSort: '-creditNoteDate',
    dateField: 'creditNoteDate',
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

  const [byStatus, today, month, issued] = await Promise.all([
    CreditNote.aggregate([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    CreditNote.aggregate([
      { $match: { ...base, creditNoteDate: { $gte: startOfDay }, status: 'ISSUED' } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    CreditNote.aggregate([
      { $match: { ...base, creditNoteDate: { $gte: startOfMonth }, status: 'ISSUED' } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    CreditNote.aggregate([
      { $match: { ...base, status: 'ISSUED' } },
      {
        $group: {
          _id: null,
          value: { $sum: '$total' },
          applied: { $sum: '$appliedAmount' },
          unapplied: { $sum: '$unappliedAmount' },
        },
      },
    ]),
  ]);

  const counts = Object.fromEntries(CREDIT_NOTE_STATUS_LIST.map((s) => [s, 0]));
  const values = Object.fromEntries(CREDIT_NOTE_STATUS_LIST.map((s) => [s, 0]));
  byStatus.forEach((row) => {
    counts[row._id] = row.count;
    values[row._id] = Math.round((row.value || 0) * 100) / 100;
  });

  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

  return success(res, {
    data: {
      total: Object.values(counts).reduce((s, n) => s + n, 0),
      byStatus: counts,
      valuesByStatus: values,
      draftCount: counts.DRAFT || 0,
      issuedCount: counts.ISSUED || 0,
      issuedValue: round(issued?.[0]?.value),
      appliedValue: round(issued?.[0]?.applied),
      unappliedValue: round(issued?.[0]?.unapplied),
      today: { count: today?.[0]?.count || 0, value: round(today?.[0]?.value) },
      month: { count: month?.[0]?.count || 0, value: round(month?.[0]?.value) },
    },
  });
});

export const get = asyncHandler(async (req, res) => {
  const note = await loadCreditNote(req, req.params.id);
  return success(res, { data: serialize(note) });
});

export const create = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const payload = { ...req.body };

  const invoice = await loadInvoiceForCredit(payload.invoiceId);
  const customer = await Customer.findById(invoice.customerId);
  const items = (payload.items || []).map((i) => ({
    invoiceItemId: i.invoiceItemId ? String(i.invoiceItemId?._id || i.invoiceItemId) : undefined,
    product: i.product ? String(i.product?._id || i.product) : undefined,
    qty: Number(i.qty),
    note: i.note || '',
  }));

  const priced = await buildCreditNoteLinesFromInvoice(invoice, items, settings);
  // A credit note reverses its invoice, so it follows the invoice's place of supply.
  priced.taxBreakup = taxBreakupFor(priced.totals.taxTotal, settings, {
    sellerState: sellerStateOf(settings, req.company),
    buyerState: invoice.placeOfSupply || buyerStateOf(customer),
  });

  const note = new CreditNote({
    ...snapshotFromInvoice(invoice, customer, payload),
    items: priced.lines,
    ...priced.totals,
    taxBreakup: priced.taxBreakup,
    appliedAmount: 0,
    unappliedAmount: 0,
    status: CREDIT_NOTE_STATUS.DRAFT,
    statusHistory: [],
  });
  pushHistory(note, CREDIT_NOTE_STATUS.DRAFT, req, `Created against ${invoice.invoiceNo}`);

  note.creditNoteNo = await nextCreditNoteNumber(req.companyId, settings, note.creditNoteDate);
  await note.save();

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'CreditNote',
    entityId: note._id,
    entityLabel: labelOf(note),
    after: toPlain(note),
    description: `Credit note ${labelOf(note)} created against ${invoice.invoiceNo}`,
  });

  let message = 'Credit note created';
  if (payload.issue) {
    await issueCreditNote(req, note, 'Issued on create');
    message = 'Credit note issued';
  }

  const full = await loadDoc(CreditNote, note._id, { populate: POPULATE, label: 'Credit note' });
  return created(res, { message, data: serialize(full) });
});

export const update = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const note = await loadCreditNote(req, req.params.id);
  if (note.status !== CREDIT_NOTE_STATUS.DRAFT) {
    throw new ConflictError('Only draft credit notes can be edited', 'CREDIT_NOTE_LOCKED');
  }

  const before = toPlain(note);
  const payload = { ...req.body };
  delete payload.issue;
  delete payload.invoiceId;

  const invoice = await Invoice.findById(note.invoice);
  if (!invoice) throw new BadRequestError('Linked invoice not found', 'INVALID_REFERENCE');

  const items = payload.items
    ? payload.items.map((i) => ({
        invoiceItemId: i.invoiceItemId ? String(i.invoiceItemId?._id || i.invoiceItemId) : undefined,
        product: i.product ? String(i.product?._id || i.product) : undefined,
        qty: Number(i.qty),
        note: i.note || '',
      }))
    : note.items.map((i) => ({
        invoiceItemId: String(i.invoiceItemId),
        product: String(i.product),
        qty: Number(i.qty),
        note: i.note || '',
      }));

  const priced = await buildCreditNoteLinesFromInvoice(invoice, items, settings);
  // A credit note reverses its invoice, so it follows the invoice's place of supply.
  priced.taxBreakup = taxBreakupFor(priced.totals.taxTotal, settings, {
    sellerState: sellerStateOf(settings, req.company),
    buyerState: invoice.placeOfSupply || buyerStateOf(invoice.billingAddress ? { address: invoice.billingAddress } : null),
  });

  if (payload.creditNoteDate !== undefined) {
    note.creditNoteDate = dateOrNull(payload.creditNoteDate) || note.creditNoteDate;
  }
  if (payload.reason !== undefined) note.reason = payload.reason;
  if (payload.reasonNote !== undefined) note.reasonNote = payload.reasonNote;
  if (payload.notes !== undefined) note.notes = payload.notes;

  Object.assign(note, priced.totals, {
    items: priced.lines,
    taxBreakup: priced.taxBreakup,
  });
  await note.save();

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'CreditNote',
    entityId: note._id,
    entityLabel: labelOf(note),
    before,
    after: toPlain(note),
    description: `Credit note ${labelOf(note)} updated`,
  });

  const full = await loadDoc(CreditNote, note._id, { populate: POPULATE, label: 'Credit note' });
  return success(res, { message: 'Credit note updated', data: serialize(full) });
});

export const remove = asyncHandler(async (req, res) => {
  const note = await loadCreditNote(req, req.params.id);
  if (note.status !== CREDIT_NOTE_STATUS.DRAFT) {
    throw new ConflictError(
      'Only draft credit notes can be deleted. Cancel this credit note instead.',
      'CREDIT_NOTE_LOCKED'
    );
  }

  const snapshot = toPlain(note);
  await note.softDelete();

  audit(req, {
    action: AUDIT_ACTIONS.DELETE,
    entityType: 'CreditNote',
    entityId: note._id,
    entityLabel: labelOf(note),
    before: snapshot,
    description: `Draft credit note ${labelOf(note)} deleted`,
  });

  return success(res, { message: 'Credit note deleted', data: { id: String(note._id) } });
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export const issue = asyncHandler(async (req, res) => {
  const note = await loadCreditNote(req, req.params.id);
  await issueCreditNote(req, note, req.body?.note || '');

  const full = await loadDoc(CreditNote, note._id, { populate: POPULATE, label: 'Credit note' });
  return success(res, { message: 'Credit note issued', data: serialize(full) });
});

export const cancel = asyncHandler(async (req, res) => {
  const note = await loadCreditNote(req, req.params.id);
  const reason = req.body?.reason || '';

  if (note.status === CREDIT_NOTE_STATUS.CANCELLED) {
    throw new ConflictError('Credit note is already cancelled', ErrorCodes.INVALID_STATUS_TRANSITION);
  }

  const before = note.status;
  if (before === CREDIT_NOTE_STATUS.ISSUED) {
    const invoice = await Invoice.findById(note.invoice);
    if (invoice) await reverseCreditNote(note, invoice);
  }

  note.status = CREDIT_NOTE_STATUS.CANCELLED;
  note.cancelledAt = new Date();
  note.cancelledBy = req.user.id;
  note.cancelReason = reason;
  pushHistory(note, CREDIT_NOTE_STATUS.CANCELLED, req, reason || 'Credit note cancelled');
  await note.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'CreditNote',
    entityId: note._id,
    entityLabel: labelOf(note),
    before: { status: before },
    after: { status: CREDIT_NOTE_STATUS.CANCELLED },
    description: `Credit note ${labelOf(note)} cancelled${reason ? `: ${reason}` : ''}`,
  });

  const full = await loadDoc(CreditNote, note._id, { populate: POPULATE, label: 'Credit note' });
  return success(res, { message: 'Credit note cancelled', data: serialize(full) });
});

// ---------------------------------------------------------------------------
// Form options
// ---------------------------------------------------------------------------

export const formOptions = asyncHandler(async (req, res) => {
  const settings = await settingsOf(req);
  const invoiceId = refOrNull(req.query.invoiceId);

  const invoices = await Invoice.find({ status: { $in: CREDITABLE_INVOICE_STATUSES } })
    .select('invoiceNo invoiceDate dueDate status total amountPaid balanceDue creditNoteTotal customerName')
    .sort({ invoiceDate: -1 })
    .limit(100)
    .lean();

  const idOf = (d) => ({ ...d, id: String(d._id), _id: undefined });

  let invoice = null;
  if (invoiceId) {
    const doc = await Invoice.findById(invoiceId);
    if (!doc) throw new BadRequestError('Invoice not found', 'INVALID_REFERENCE');
    if (!CREDITABLE_INVOICE_STATUSES.includes(doc.status)) {
      throw new AppError('Only issued invoices can be credited', {
        status: 422,
        code: 'INVOICE_NOT_ISSUED',
      });
    }

    const used = await creditedQtyByInvoiceLine(doc._id);
    const items = (doc.items || [])
      .map((line) => {
        const credited = used.get(String(line._id)) || 0;
        return {
          invoiceItemId: String(line._id),
          product: String(line.product),
          name: line.name,
          sku: line.sku || '',
          unit: line.unit || 'PCS',
          hsnCode: line.hsnCode || '',
          qty: Number(line.qty || 0),
          creditedQty: Math.round(credited * 100) / 100,
          remainingQty: Math.round((Number(line.qty || 0) - credited) * 100) / 100,
          unitPrice: Number(line.unitPrice || 0),
          discountPercent: Number(line.discountPercent || 0),
          taxRate: Number(line.taxRate || 0),
        };
      })
      .filter((line) => line.remainingQty > 0.0001);

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
      placeOfSupply: doc.placeOfSupply || '',
      items,
    };
  }

  return success(res, {
    data: {
      invoice,
      invoices: invoices.map((i) => ({
        ...idOf(i),
        total: Number(i.total || 0),
        balanceDue: Number(i.balanceDue || 0),
        creditNoteTotal: Number(i.creditNoteTotal || 0),
      })),
      reasons: CREDIT_NOTE_REASONS,
      settings: {
        currency: settings?.currency || 'INR',
        currencySymbol: settings?.currencySymbol || '₹',
        tax: {
          taxInclusive: Boolean(settings?.tax?.taxInclusive),
          enableCgstSgst: settings?.tax?.enableCgstSgst !== false,
          regime: settings?.tax?.regime || 'GST',
          label: settings?.tax?.taxLabel || 'Tax',
          // Company state: same-state sales split into CGST + SGST, others IGST.
          sellerState: sellerStateOf(settings, req.company),
        },
        invoice: {
          rounding: settings?.invoice?.rounding || 'NEAREST',
          terms: settings?.invoice?.terms || '',
          footerNote: settings?.invoice?.footerNote || '',
        },
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
  ['status', 'customerId', 'salesman', 'reason'].forEach((key) => {
    if (req.query[key]) filter[key] = req.query[key];
  });
  if (req.query.invoiceId) filter.invoice = req.query.invoiceId;

  if (req.query.dateFrom || req.query.dateTo) {
    const range = {};
    if (req.query.dateFrom) range.$gte = new Date(req.query.dateFrom);
    if (req.query.dateTo) {
      const to = new Date(req.query.dateTo);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateTo))) to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
    filter.creditNoteDate = { ...(filter.creditNoteDate || {}), ...range };
  }
  return filter;
};

export const exportXlsx = asyncHandler(async (req, res) => {
  const notes = await CreditNote.find(buildExportFilter(req))
    .sort({ creditNoteDate: -1 })
    .limit(5000)
    .populate('customerId', 'name code phone')
    .lean();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ElevIQ SFA';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Credit Notes', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Credit Note No', key: 'creditNoteNo', width: 20 },
    { header: 'Date', key: 'creditNoteDate', width: 14 },
    { header: 'Invoice No', key: 'invoiceNo', width: 20 },
    { header: 'Customer', key: 'customer', width: 32 },
    { header: 'Customer Code', key: 'customerCode', width: 16 },
    { header: 'Reason', key: 'reason', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Items', key: 'itemCount', width: 10 },
    { header: 'Subtotal', key: 'subtotal', width: 14 },
    { header: 'Tax', key: 'taxTotal', width: 14 },
    { header: 'Total', key: 'total', width: 16 },
    { header: 'Applied', key: 'appliedAmount', width: 14 },
    { header: 'Unapplied', key: 'unappliedAmount', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };

  notes.forEach((n) => {
    sheet.addRow({
      creditNoteNo: n.creditNoteNo,
      creditNoteDate: n.creditNoteDate ? dayjs(n.creditNoteDate).format('YYYY-MM-DD') : '',
      invoiceNo: n.invoiceNo || '',
      customer: n.customerId?.name || n.customerName || '',
      customerCode: n.customerCode || n.customerId?.code || '',
      reason: n.reason || '',
      status: n.status,
      itemCount: n.itemCount || 0,
      subtotal: Number(n.subtotal || 0),
      taxTotal: Number(n.taxTotal || 0),
      total: Number(n.total || 0),
      appliedAmount: Number(n.appliedAmount || 0),
      unappliedAmount: Number(n.unappliedAmount || 0),
    });
  });

  if (notes.length) {
    sheet.addRow({});
    const totalRow = sheet.addRow({
      creditNoteNo: `Total (${notes.length} credit notes)`,
      total: notes.reduce((s, n) => s + Number(n.total || 0), 0),
      appliedAmount: notes.reduce((s, n) => s + Number(n.appliedAmount || 0), 0),
    });
    totalRow.font = { bold: true };
  }

  const filename = `credit-notes-${dayjs().format('YYYY-MM-DD')}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'CreditNote',
    entityLabel: 'Credit note register',
    description: `Exported ${notes.length} credit notes to Excel`,
  });

  res.end();
});

const money2 = (n) => Number(n || 0).toFixed(2);

export const pdf = asyncHandler(async (req, res) => {
  const note = await loadCreditNote(req, req.params.id);
  const settings = await settingsOf(req);
  const company = sellerFor(note, req.company || {});
  const loc = await pdfLocale(settings, company);
  const customer = note.customerId || {};

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const filename = `credit-note-${(note.creditNoteNo || note._id)
    .toString()
    .replace(/[^a-z0-9-]/gi, '')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);

  const left = 40;
  const right = 555;

  doc.font('Helvetica-Bold').fontSize(18).text(company.businessName || 'ElevIQ SFA', left, 40);
  doc.font('Helvetica').fontSize(8).fillColor('#555');
  const companyLine = [
    company.code ? `Code: ${company.code}` : '',
    company.gstin && loc.showTaxId ? `${loc.taxIdLabel}: ${company.gstin}` : '',
    company.phone || '',
    company.email || '',
  ]
    .filter(Boolean)
    .join('  |  ');
  if (companyLine) doc.text(companyLine, left, 62);
  doc.fillColor('#000');

  doc.font('Helvetica-Bold').fontSize(14).text('CREDIT NOTE', right - 180, 40, { width: 180, align: 'right' });
  doc.font('Helvetica').fontSize(9);
  doc.text(`Credit Note No: ${note.creditNoteNo || '—'}`, right - 220, 62, { width: 220, align: 'right' });
  doc.text(
    `Date: ${note.creditNoteDate ? dayjs(note.creditNoteDate).format('DD MMM YYYY') : '—'}`,
    right - 220,
    75,
    { width: 220, align: 'right' }
  );
  doc.text(`Against invoice: ${note.invoiceNo || '—'}`, right - 220, 88, { width: 220, align: 'right' });

  doc.moveTo(left, 114).lineTo(right, 114).strokeColor('#cbd5e1').stroke();

  doc.font('Helvetica-Bold').fontSize(9).text('CUSTOMER', left, 126);
  doc.font('Helvetica').fontSize(9);
  doc.text(note.customerName || customer.name || '—', left, 140, { width: 240 });
  const addr = note.billingAddress || {};
  const addrLines = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
  if (addrLines) doc.text(addrLines, left, 154, { width: 240 });
  if (note.customerPhone || customer.phone) {
    doc.text(`Phone: ${note.customerPhone || customer.phone}`, left, 168, { width: 240 });
  }
  if (note.customerGstin || customer.gstin) {
    doc.text(`${loc.taxIdLabel}: ${note.customerGstin || customer.gstin}`, left, 182, { width: 240 });
  }

  doc.font('Helvetica-Bold').fontSize(9).text('REASON', 300, 126);
  doc.font('Helvetica').fontSize(9);
  doc.text(String(note.reason || '—').replace(/_/g, ' '), 300, 140, { width: 255 });
  if (note.reasonNote) doc.text(note.reasonNote, 300, 154, { width: 255 });
  doc.text(`Status: ${note.status}`, 300, 182, { width: 255 });

  let y = 214;
  const cols = [
    { x: left, w: 26, label: '#' },
    { x: left + 26, w: 200, label: 'Item' },
    { x: left + 226, w: 55, label: loc.codeLabel },
    { x: left + 281, w: 45, label: 'Qty', align: 'right' },
    { x: left + 326, w: 62, label: 'Rate', align: 'right' },
    { x: left + 388, w: 45, label: 'Disc', align: 'right' },
    { x: left + 433, w: 42, label: `${loc.taxLabel}%`, align: 'right' },
    { x: right - 80, w: 80, label: 'Amount', align: 'right' },
  ];

  const headerRow = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#111');
    cols.forEach((c) => doc.text(c.label, c.x, y, { width: c.w, align: c.align || 'left' }));
    y += 13;
    doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor('#cbd5e1').stroke();
    doc.font('Helvetica').fontSize(8);
  };
  headerRow();

  (note.items || []).forEach((item, index) => {
    if (y > 640) {
      doc.addPage();
      y = 50;
      headerRow();
    }
    doc.text(String(index + 1), cols[0].x, y, { width: cols[0].w });
    doc.text(item.name || '—', cols[1].x, y, { width: cols[1].w });
    doc.text(item.hsnCode || '—', cols[2].x, y, { width: cols[2].w });
    doc.text(String(item.qty), cols[3].x, y, { width: cols[3].w, align: 'right' });
    doc.text(money2(item.unitPrice), cols[4].x, y, { width: cols[4].w, align: 'right' });
    doc.text(`${Number(item.discountPercent || 0)}%`, cols[5].x, y, { width: cols[5].w, align: 'right' });
    doc.text(`${Number(item.taxRate || 0)}%`, cols[6].x, y, { width: cols[6].w, align: 'right' });
    doc.text(money2(item.lineTotal), cols[7].x, y, { width: cols[7].w, align: 'right' });
    y += 16;
  });

  y += 8;
  doc.moveTo(left, y).lineTo(right, y).strokeColor('#cbd5e1').stroke();
  y += 10;

  const totals = [
    ['Subtotal', note.subtotal],
    ['Discount', -Number(note.discountTotal || 0)],
    ['Taxable', note.taxableTotal],
    ...taxRows(note.taxTotal, note.taxBreakup, loc),
    ['Round off', note.roundOff],
    ['Credit total', note.total],
  ];
  doc.fontSize(9);
  totals.forEach(([label, value]) => {
    doc.text(label, 380, y, { width: 90, align: 'right' });
    doc.text(money2(value), 475, y, { width: 80, align: 'right' });
    y += 14;
  });
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text('Applied to invoice', 350, y + 2, { width: 120, align: 'right' });
  doc.text(`${loc.money} ${money2(note.appliedAmount)}`, 475, y + 2, {
    width: 80,
    align: 'right',
  });
  y += 26;
  doc.font('Helvetica').fontSize(9);
  doc.text('Unapplied credit', 350, y, { width: 120, align: 'right' });
  doc.text(money2(note.unappliedAmount), 475, y, { width: 80, align: 'right' });

  const footerY = Math.max(y + 40, 700);
  doc.font('Helvetica').fontSize(8).fillColor('#555');
  if (note.notes) doc.text(`Notes: ${note.notes}`, left, footerY, { width: 340 });
  doc.text(`Generated by ElevIQ SFA on ${dayjs().format('DD MMM YYYY HH:mm')}`, left, 790, {
    width: 515,
    align: 'center',
  });

  doc.end();

  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: 'CreditNote',
    entityId: note._id,
    entityLabel: labelOf(note),
    description: `Printed credit note ${labelOf(note)}`,
  });
});

export default {
  list,
  stats,
  get,
  create,
  update,
  remove,
  issue,
  cancel,
  formOptions,
  exportXlsx,
  pdf,
};
