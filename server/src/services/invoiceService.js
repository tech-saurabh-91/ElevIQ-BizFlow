import dayjs from 'dayjs';
import Invoice from '../models/Invoice.js';
import CreditNote from '../models/CreditNote.js';
import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import { round2 } from '../models/helpers.js';
import { AppError, BadRequestError, ConflictError } from '../utils/errors.js';
import { nextSeries, getFinancialYearTag } from '../utils/numberSeries.js';
import { priceLineValues, computeTotals, resolveLinePricing, assertPackQty, unitFieldsFrom } from './orderService.js';

/**
 * Invoice + credit-note domain rules.
 *
 * Everything money-related is computed here from the source document (order
 * line snapshot, invoice line snapshot or live price list) so a client can
 * never inject its own totals.
 */

const EPSILON = 0.0001;
const ISSUED_INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];
const UNBILLED_INVOICE_STATUSES = ['DRAFT', 'CANCELLED'];

const oid = (value) => (value?._id ? value._id : value);

// ---------------------------------------------------------------------------
// Numbering / dates
// ---------------------------------------------------------------------------

export const nextInvoiceNumber = async (companyId, settings, date = new Date()) => {
  const prefix = settings?.series?.invoice?.prefix || 'INV';
  const pad = Number(settings?.series?.invoice?.pad || 6);
  const startMonth = Number(settings?.financialYearStartMonth || 4);
  const fy = getFinancialYearTag(date, startMonth);
  return nextSeries(companyId, 'INVOICE', { prefix, pad, fy });
};

export const nextCreditNoteNumber = async (companyId, settings, date = new Date()) => {
  const prefix = settings?.series?.creditNote?.prefix || 'CN';
  const pad = Number(settings?.series?.creditNote?.pad || 6);
  const startMonth = Number(settings?.financialYearStartMonth || 4);
  const fy = getFinancialYearTag(date, startMonth);
  return nextSeries(companyId, 'CREDIT_NOTE', { prefix, pad, fy });
};

/** Days of credit granted by a payment term. */
export const paymentTermsDays = (terms, creditDays = 0) => {
  const value = String(terms || '').toUpperCase();
  const match = /^NET_(\d+)$/.exec(value);
  if (match) return Number(match[1]);
  if (value === 'IMMEDIATE') return 0;
  if (value === 'CUSTOM') return Number(creditDays || 0);
  return Number(creditDays || 0);
};

/** Due date derived from invoice date + payment terms (settings as fallback). */
export const dueDateFor = (invoiceDate, { paymentTerms, creditDays } = {}, settings) => {
  const fallbackDays = Number(settings?.invoice?.defaultDueDays || 0);
  const days =
    paymentTerms || creditDays ? paymentTermsDays(paymentTerms, creditDays) : fallbackDays;
  return dayjs(invoiceDate || new Date())
    .add(days, 'day')
    .toDate();
};

// ---------------------------------------------------------------------------
// Money / status
// ---------------------------------------------------------------------------

export const recalcInvoiceBalance = (invoice) => {
  const total = Number(invoice.total || 0);
  const paid = Number(invoice.amountPaid || 0);
  const credited = Number(invoice.creditNoteTotal || 0);
  invoice.balanceDue = Math.max(0, round2(total - paid - credited));
  return invoice.balanceDue;
};

/**
 * Derive the invoice status from its money + due date.
 * DRAFT and CANCELLED are terminal/manual and never touched.
 */
export const refreshInvoiceStatus = (invoice, now = new Date()) => {
  if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED') return invoice.status;

  recalcInvoiceBalance(invoice);
  const settled = round2(Number(invoice.amountPaid || 0) + Number(invoice.creditNoteTotal || 0));

  if (Number(invoice.balanceDue) <= EPSILON) {
    invoice.status = 'PAID';
  } else if (settled > EPSILON) {
    invoice.status = 'PARTIALLY_PAID';
  } else if (
    invoice.dueDate &&
    dayjs(invoice.dueDate).startOf('day').isBefore(dayjs(now).startOf('day'))
  ) {
    invoice.status = 'OVERDUE';
  } else {
    invoice.status = 'ISSUED';
  }
  return invoice.status;
};

/** Irreversible "issued" invoices that count toward order fulfilment. */
export const isIssued = (invoice) => ISSUED_INVOICE_STATUSES.includes(invoice?.status);

// ---------------------------------------------------------------------------
// Order -> invoice line building
// ---------------------------------------------------------------------------

/** Quantity of each order line already billed by issued invoices. */
/** Invoices that bill an order (as their only order or one of several). */
export const invoicesOfOrder = (orderId) => ({ $or: [{ order: orderId }, { orders: orderId }] });

/** Does this invoice line bill that order? (Old invoices carry no line order.) */
export const lineOfOrder = (invoice, line, orderId) =>
  line.order ? String(line.order) === String(orderId) : String(invoice.order) === String(orderId);

export const billedQtyByOrderLine = async (orderId, { excludeInvoiceId = null } = {}) => {
  const filter = { ...invoicesOfOrder(orderId), status: { $nin: UNBILLED_INVOICE_STATUSES } };
  if (excludeInvoiceId) filter._id = { $ne: excludeInvoiceId };
  const invoices = await Invoice.find(filter).select('order items').lean();

  const used = new Map();
  invoices.forEach((invoice) => {
    (invoice.items || []).forEach((line) => {
      if (!lineOfOrder(invoice, line, orderId)) return;
      const key = line.orderItemId ? String(line.orderItemId) : String(line.product);
      used.set(key, (used.get(key) || 0) + Number(line.qty || 0));
    });
  });
  return used;
};

/** Order lines with the still-billable quantity, in order-line order. */
export const remainingOrderLines = async (order, { excludeInvoiceId = null } = {}) => {
  const used = await billedQtyByOrderLine(order._id, { excludeInvoiceId });
  return (order.items || []).map((line) => {
    const key = String(line._id);
    const billed = used.get(key) ?? used.get(String(line.product)) ?? 0;
    return {
      line,
      orderItemId: line._id,
      product: line.product,
      qty: Number(line.qty || 0),
      billed: round2(billed),
      remainingQty: round2(Number(line.qty || 0) - billed),
    };
  });
};

const findOrderLine = (rows, requested) => {
  if (requested.orderItemId) {
    const byId = rows.find((row) => String(row.orderItemId) === String(requested.orderItemId));
    if (byId) return byId;
  }
  if (requested.product) {
    return rows.find((row) => String(row.product) === String(requested.product));
  }
  return null;
};

/**
 * Build invoice lines from an order.
 * An empty `requested` list means "bill everything still unbilled".
 */
export const buildInvoiceLinesFromOrder = async (order, requested = [], settings, options = {}) => {
  const rows = await remainingOrderLines(order, options);
  const billable = rows.filter((row) => row.remainingQty > EPSILON);
  if (!billable.length) {
    throw new ConflictError('Every line on this order is already invoiced', 'ORDER_FULLY_INVOICED');
  }

  const source = requested.length
    ? requested
    : billable.map((row) => ({ orderItemId: row.orderItemId, qty: row.remainingQty }));

  const errors = [];
  const lines = [];

  source.forEach((input, index) => {
    const row = findOrderLine(rows, input);
    if (!row) {
      throw new BadRequestError(
        `Order line not found for invoice line ${index + 1}`,
        'INVALID_REFERENCE'
      );
    }

    const qty = Number(input.qty ?? row.remainingQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequestError(`Quantity must be greater than zero (line ${index + 1})`, 'VALIDATION_ERROR');
    }
    if (qty > row.remainingQty + EPSILON) {
      errors.push({
        field: `items.${index}.qty`,
        message: `${row.line.name}: only ${row.remainingQty} left to invoice (${qty} requested)`,
      });
      return;
    }

    const line = row.line;
    lines.push({
      product: line.product,
      orderItemId: row.orderItemId,
      order: order._id,
      name: line.name || '',
      sku: line.sku || '',
      ...unitFieldsFrom(line, qty),
      hsnCode: line.hsnCode || '',
      ...priceLineValues(
        {
          qty,
          freeQty: 0,
          unitPrice: Number(line.unitPrice || 0),
          discountPercent: Number(line.discountPercent || 0),
          taxRate: Number(line.taxRate || 0),
          note: input.note || '',
        },
        settings
      ),
    });
  });

  if (errors.length) {
    throw new AppError('Invoice quantity exceeds the unbilled order quantity', {
      status: 422,
      code: 'INVOICE_QTY_EXCEEDED',
      errors,
    });
  }
  if (!lines.length) throw new BadRequestError('Add at least one item to invoice', 'VALIDATION_ERROR');

  const totals = computeTotals(lines, settings);
  return { lines, ...totals };
};

// ---------------------------------------------------------------------------
// Direct invoice / credit note line building
// ---------------------------------------------------------------------------

/** Build lines for a direct (no order) invoice from live product + price list. */
export const buildDirectInvoiceLines = (items, { products, priceList, settings }) => {
  const lines = items.map((input, index) => {
    const product = products.get(String(input.product?._id || input.product));
    if (!product) throw new BadRequestError(`Product not found for line ${index + 1}`, 'INVALID_REFERENCE');
    if (!product.isActive) {
      throw new BadRequestError(`"${product.name}" is inactive and cannot be invoiced`, 'INACTIVE_PRODUCT');
    }

    const pricing = resolveLinePricing(product, priceList, input);
    assertPackQty(input.qty, pricing.unitFactor, product, pricing.unit, index);
    return {
      product: product._id,
      name: product.name,
      sku: product.sku || '',
      unit: pricing.unit,
      unitFactor: pricing.unitFactor,
      baseQty: Number(input.qty) * pricing.unitFactor,
      hsnCode: product.hsnCode || '',
      ...priceLineValues(
        { ...input, unitPrice: pricing.unitPrice, discountPercent: pricing.discountPercent, taxRate: pricing.taxRate },
        settings
      ),
    };
  });

  if (!lines.length) throw new BadRequestError('Add at least one product', 'VALIDATION_ERROR');
  const totals = computeTotals(lines, settings);
  return { lines, ...totals };
};

/** Quantity of each invoice line already credited by issued credit notes. */
export const creditedQtyByInvoiceLine = async (invoiceId, { excludeCreditNoteId = null } = {}) => {
  const filter = { invoice: invoiceId, status: 'ISSUED' };
  if (excludeCreditNoteId) filter._id = { $ne: excludeCreditNoteId };
  const notes = await CreditNote.find(filter).select('items').lean();

  const used = new Map();
  notes.forEach((note) => {
    (note.items || []).forEach((line) => {
      const key = line.invoiceItemId ? String(line.invoiceItemId) : String(line.product);
      used.set(key, (used.get(key) || 0) + Number(line.qty || 0));
    });
  });
  return used;
};

/** Build credit-note lines from an invoice (fully or partially). */
export const buildCreditNoteLinesFromInvoice = async (
  invoice,
  requested = [],
  settings,
  options = {}
) => {
  const used = await creditedQtyByInvoiceLine(invoice._id, options);
  const rows = (invoice.items || []).map((line) => {
    const key = String(line._id);
    const credited = used.get(key) ?? used.get(String(line.product)) ?? 0;
    return {
      line,
      invoiceItemId: line._id,
      product: line.product,
      qty: Number(line.qty || 0),
      credited: round2(credited),
      remainingQty: round2(Number(line.qty || 0) - credited),
    };
  });

  const billable = rows.filter((row) => row.remainingQty > EPSILON);
  if (!billable.length) {
    throw new ConflictError('Every line on this invoice is already credited', 'INVOICE_FULLY_CREDITED');
  }

  const source = requested.length
    ? requested
    : billable.map((row) => ({ invoiceItemId: row.invoiceItemId, qty: row.remainingQty }));

  const errors = [];
  const lines = [];

  source.forEach((input, index) => {
    const row =
      rows.find((r) => input.invoiceItemId && String(r.invoiceItemId) === String(input.invoiceItemId)) ||
      rows.find((r) => input.product && String(r.product) === String(input.product));
    if (!row) {
      throw new BadRequestError(
        `Invoice line not found for credit note line ${index + 1}`,
        'INVALID_REFERENCE'
      );
    }

    const qty = Number(input.qty ?? row.remainingQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequestError(`Quantity must be greater than zero (line ${index + 1})`, 'VALIDATION_ERROR');
    }
    if (qty > row.remainingQty + EPSILON) {
      errors.push({
        field: `items.${index}.qty`,
        message: `${row.line.name}: only ${row.remainingQty} can still be credited (${qty} requested)`,
      });
      return;
    }

    const line = row.line;
    lines.push({
      product: line.product,
      invoiceItemId: row.invoiceItemId,
      name: line.name || '',
      sku: line.sku || '',
      ...unitFieldsFrom(line, qty),
      hsnCode: line.hsnCode || '',
      ...priceLineValues(
        {
          qty,
          unitPrice: Number(line.unitPrice || 0),
          discountPercent: Number(line.discountPercent || 0),
          taxRate: Number(line.taxRate || 0),
          note: input.note || '',
        },
        settings
      ),
    });
  });

  if (errors.length) {
    throw new AppError('Credit note quantity exceeds the invoice quantity', {
      status: 422,
      code: 'CREDIT_QTY_EXCEEDED',
      errors,
    });
  }
  if (!lines.length) throw new BadRequestError('Add at least one item to credit', 'VALIDATION_ERROR');

  const totals = computeTotals(lines, settings);
  return { lines, ...totals };
};

// ---------------------------------------------------------------------------
// Side-effect syncing
// ---------------------------------------------------------------------------

/** Recompute an order's invoiced quantity/amount + status from issued invoices. */
export const syncOrderInvoicing = async (order) => {
  if (!order) return null;
  const doc = typeof order.save === 'function' ? order : await Order.findById(oid(order));
  if (!doc) return null;

  const invoices = await Invoice.find({
    ...invoicesOfOrder(doc._id),
    status: { $nin: UNBILLED_INVOICE_STATUSES },
  })
    .select('order items total')
    .lean();

  // Only the lines that bill THIS order count (an invoice may bill several).
  let billedQty = 0;
  let billedAmount = 0;
  invoices.forEach((invoice) => {
    (invoice.items || []).forEach((line) => {
      if (!lineOfOrder(invoice, line, doc._id)) return;
      billedQty += Number(line.qty || 0);
      billedAmount += Number(line.lineTotal || 0);
    });
  });
  const orderedQty = (doc.items || []).reduce((sum, line) => sum + Number(line.qty || 0), 0);

  doc.invoicedQty = round2(billedQty);
  doc.invoicedAmount = round2(billedAmount);

  const tracked = ['CONFIRMED', 'PARTIALLY_INVOICED', 'FULLY_INVOICED'];
  if (tracked.includes(doc.status)) {
    if (billedQty <= EPSILON) doc.status = 'CONFIRMED';
    else if (billedQty + EPSILON >= orderedQty) doc.status = 'FULLY_INVOICED';
    else doc.status = 'PARTIALLY_INVOICED';
  }

  await doc.save();
  return doc;
};

/** Apply an issued credit note against its invoice. Returns the applied amount. */
export const applyCreditNote = async (creditNote, invoice) => {
  recalcInvoiceBalance(invoice);
  const applied = Math.min(
    round2(Number(creditNote.total || 0)),
    Math.max(0, round2(Number(invoice.balanceDue || 0)))
  );

  creditNote.appliedAmount = applied;
  creditNote.unappliedAmount = round2(Number(creditNote.total || 0) - applied);

  invoice.creditNoteTotal = round2(Number(invoice.creditNoteTotal || 0) + applied);
  invoice.creditNoteCount = Number(invoice.creditNoteCount || 0) + 1;
  recalcInvoiceBalance(invoice);
  refreshInvoiceStatus(invoice);
  await invoice.save();

  if (applied > 0) {
    await Customer.updateOne({ _id: invoice.customerId }, { $inc: { outstanding: -applied } });
  }

  return applied;
};

/** Undo a previously applied credit note (on cancellation). */
export const reverseCreditNote = async (creditNote, invoice) => {
  const applied = Number(creditNote.appliedAmount || 0);
  if (applied <= 0) return 0;

  invoice.creditNoteTotal = Math.max(0, round2(Number(invoice.creditNoteTotal || 0) - applied));
  invoice.creditNoteCount = Math.max(0, Number(invoice.creditNoteCount || 0) - 1);
  recalcInvoiceBalance(invoice);
  refreshInvoiceStatus(invoice);
  await invoice.save();

  await Customer.updateOne({ _id: invoice.customerId }, { $inc: { outstanding: applied } });

  return applied;
};

export default {
  nextInvoiceNumber,
  nextCreditNoteNumber,
  paymentTermsDays,
  dueDateFor,
  recalcInvoiceBalance,
  refreshInvoiceStatus,
  isIssued,
  billedQtyByOrderLine,
  remainingOrderLines,
  buildInvoiceLinesFromOrder,
  buildDirectInvoiceLines,
  creditedQtyByInvoiceLine,
  buildCreditNoteLinesFromInvoice,
  syncOrderInvoicing,
  applyCreditNote,
  reverseCreditNote,
};
