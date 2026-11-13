import Invoice from '../models/Invoice.js';
import CreditNote from '../models/CreditNote.js';
import Payment from '../models/Payment.js';
import GoodsReceipt from '../models/GoodsReceipt.js';
import PurchaseBill from '../models/PurchaseBill.js';
import SupplierPayment from '../models/SupplierPayment.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import StockAdjustment from '../models/StockAdjustment.js';
import StockTransfer from '../models/StockTransfer.js';
import Expense from '../models/Expense.js';
import { isLockedDate, booksClosedError } from '../services/yearCloseService.js';

/**
 * Closed financial years are read-only.
 *
 * 1. No request may carry a document date inside a closed year (create, or
 *    move a document into it).
 * 2. A posted / issued document dated inside a closed year cannot be edited,
 *    cancelled, bounced or deleted. A draft may still be re-dated forward or
 *    deleted, but not issued / posted while its date is in the closed year.
 *
 * Orders and purchase orders are commitments, not books: pending ones carry
 * into the new year and are invoiced / received with new-year documents, so
 * only their own date is checked (rule 1).
 */

const DOCUMENT_DATES = [
  'orderDate',
  'invoiceDate',
  'creditNoteDate',
  'paymentDate',
  'poDate',
  'grnDate',
  'billDate',
  'returnDate',
  'adjustmentDate',
  'transferDate',
  'expenseDate',
];

const BOOKED = [
  { base: 'invoices', Model: Invoice, field: 'invoiceDate', readOnly: ['send'] },
  { base: 'credit-notes', Model: CreditNote, field: 'creditNoteDate' },
  { base: 'payments', Model: Payment, field: 'paymentDate' },
  { base: 'goods-receipts', Model: GoodsReceipt, field: 'grnDate' },
  { base: 'purchase-bills', Model: PurchaseBill, field: 'billDate' },
  { base: 'supplier-payments', Model: SupplierPayment, field: 'paymentDate' },
  { base: 'purchase-returns', Model: PurchaseReturn, field: 'returnDate' },
  { base: 'inventory/adjustments', Model: StockAdjustment, field: 'adjustmentDate' },
  { base: 'inventory/transfers', Model: StockTransfer, field: 'transferDate' },
  { base: 'field-force/expenses', Model: Expense, field: 'expenseDate' },
];
/** Actions that put a draft into the books. */
const POSTING = new Set(['issue', 'post', 'receive', 'dispatch', 'approve', 'submit']);

const routeOf = (path) => {
  for (const entry of BOOKED) {
    const m = new RegExp(`^/${entry.base}/([a-f0-9]{24})(?:/([a-z-]+))?/?$`).exec(path);
    if (m) return { ...entry, id: m[1], action: m[2] || '' };
  }
  return null;
};

export const booksLock = async (req, _res, next) => {
  try {
    const company = req.company;
    if (!company?.booksClosedThrough || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    // 1. dates sent with the request
    const body = req.body || {};
    if (DOCUMENT_DATES.some((f) => body[f] && isLockedDate(company, body[f]))) return next(booksClosedError(company));

    // 2. the document being changed
    const route = routeOf(req.path);
    if (!route || route.readOnly?.includes(route.action)) return next();
    const doc = await route.Model.findById(route.id).select(`${route.field} status`).lean();
    if (!doc || !isLockedDate(company, doc[route.field])) return next();
    const draft = doc.status === 'DRAFT';
    if (draft && !POSTING.has(route.action)) return next();
    return next(booksClosedError(company));
  } catch (err) {
    return next(err);
  }
};

export default booksLock;
