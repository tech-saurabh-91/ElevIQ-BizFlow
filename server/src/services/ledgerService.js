import mongoose from 'mongoose';
import dayjs from 'dayjs';

import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import CreditNote from '../models/CreditNote.js';
import PurchaseBill from '../models/PurchaseBill.js';
import SupplierPayment from '../models/SupplierPayment.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import { NotFoundError } from '../utils/errors.js';
import { startOfDay, dayKey, DEFAULT_TZ } from './fieldForceService.js';

/**
 * Party ledger (statement of account) for one customer or supplier.
 *
 *   opening balance on the first day
 *   + every document in the period, in date order, with a running balance
 *   = closing balance on the last day
 *
 * The documents and amounts that count are the same "legs" as the Customer /
 * Supplier Balance Summary reports and the year-end closing figures, so a
 * statement's closing balance always equals those figures, and a closed
 * year's closing balance is the next year's opening.
 *
 * Customer: invoices raise the balance (debit); receipts set against invoices
 *   and credit notes lower it (credit). Money received but not set against
 *   an invoice is an advance: shown on the receipt's line, not in the balance.
 * Supplier: bills raise what we owe (credit); payments and returns lower it
 *   (debit).
 */

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const LIVE_INVOICE = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'];
const modeText = (m) => String(m || '').replace(/_/g, ' ');

/** The documents that move a party's balance; `sign` +1 raises it, -1 lowers it. */
export const CUSTOMER_LEGS = [
  {
    key: 'sales',
    type: 'Invoice',
    Model: Invoice,
    match: { status: { $in: LIVE_INVOICE } },
    date: 'invoiceDate',
    party: 'customerId',
    value: '$total',
    sign: 1,
    select: 'invoiceNo invoiceDate total createdAt',
    row: (d) => ({ no: d.invoiceNo, amount: d.total, narration: '' }),
  },
  {
    key: 'receipts',
    type: 'Receipt',
    Model: Payment,
    match: { status: 'RECEIVED' },
    date: 'paymentDate',
    party: 'customerId',
    value: { $ifNull: ['$amountApplied', '$amount'] },
    sign: -1,
    select: 'paymentNo paymentDate amount amountApplied unappliedAmount mode reference createdAt',
    row: (d) => {
      const advance = r2(d.unappliedAmount);
      return {
        no: d.paymentNo,
        amount: d.amountApplied ?? d.amount,
        advance: advance > 0 ? advance : 0,
        narration: [
          modeText(d.mode),
          d.reference,
          advance > 0 ? `${advance.toFixed(2)} kept as advance` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      };
    },
  },
  {
    key: 'credits',
    type: 'Credit note',
    Model: CreditNote,
    match: { status: 'ISSUED' },
    date: 'creditNoteDate',
    party: 'customerId',
    value: '$total',
    sign: -1,
    select: 'creditNoteNo creditNoteDate total invoiceNo reason createdAt',
    row: (d) => ({
      no: d.creditNoteNo,
      amount: d.total,
      narration: [d.invoiceNo ? `Against ${d.invoiceNo}` : '', modeText(d.reason)]
        .filter(Boolean)
        .join(' · '),
    }),
  },
];

export const SUPPLIER_LEGS = [
  {
    key: 'bills',
    type: 'Bill',
    Model: PurchaseBill,
    match: { status: { $ne: 'CANCELLED' } },
    date: 'billDate',
    party: 'supplierId',
    value: '$total',
    sign: 1,
    select: 'billNo billDate total supplierInvoiceNo createdAt',
    row: (d) => ({
      no: d.billNo,
      amount: d.total,
      narration: d.supplierInvoiceNo ? `Supplier invoice ${d.supplierInvoiceNo}` : '',
    }),
  },
  {
    key: 'payments',
    type: 'Payment',
    Model: SupplierPayment,
    match: { status: { $ne: 'CANCELLED' } },
    date: 'paymentDate',
    party: 'supplierId',
    value: '$amount',
    sign: -1,
    select: 'paymentNo paymentDate amount mode reference createdAt',
    row: (d) => ({
      no: d.paymentNo,
      amount: d.amount,
      narration: [modeText(d.mode), d.reference].filter(Boolean).join(' · '),
    }),
  },
  {
    key: 'returns',
    type: 'Return',
    Model: PurchaseReturn,
    match: { status: { $ne: 'CANCELLED' } },
    date: 'returnDate',
    party: 'supplierId',
    value: '$total',
    sign: -1,
    select: 'returnNo returnDate total billNo createdAt',
    row: (d) => ({
      no: d.returnNo,
      amount: d.total,
      narration: d.billNo ? `Against ${d.billNo}` : '',
    }),
  },
];

export const KINDS = {
  customer: { Party: Customer, legs: CUSTOMER_LEGS, label: 'Customer' },
  supplier: { Party: Supplier, legs: SUPPLIER_LEGS, label: 'Supplier' },
};

/** Inclusive company-local period; default: this financial year to today. */
export const periodOf = ({ from, to } = {}, { tz = DEFAULT_TZ, startMonth = 4 } = {}) => {
  const today = dayKey(new Date(), tz);
  const t = dayjs(today);
  const fyYear = t.month() + 1 >= startMonth ? t.year() : t.year() - 1;
  const fromKey = from || `${fyYear}-${String(startMonth).padStart(2, '0')}-01`;
  const toKey = to || today;
  return {
    fromKey,
    toKey,
    start: startOfDay(fromKey, tz),
    end: dayjs(startOfDay(toKey, tz)).add(1, 'day').toDate(),
  };
};

/**
 * The statement of one party for a period.
 * @param {'customer'|'supplier'} kind
 */
export const buildLedger = async ({
  kind,
  partyId,
  companyId,
  from,
  to,
  tz = DEFAULT_TZ,
  startMonth,
}) => {
  const { Party, legs, label } = KINDS[kind];
  const party = await Party.findById(partyId).lean();
  if (!party) throw new NotFoundError(`${label} not found`);
  const period = periodOf({ from, to }, { tz, startMonth });
  const { start, end } = period;
  const base = { companyId: oid(companyId), isDeleted: { $ne: true }, [legs[0].party]: party._id };

  // ---- opening: the master's own opening balance + every document before the period
  const createdAt = new Date(party.createdAt);
  let opening = createdAt < start ? Number(party.openingBalance || 0) : 0;
  for (const leg of legs) {
    const [sum] = await leg.Model.aggregate([
      { $match: { ...base, ...leg.match, [leg.date]: { $lt: start } } },
      { $group: { _id: null, v: { $sum: leg.value } } },
    ]);
    opening += leg.sign * Number(sum?.v || 0);
  }
  opening = r2(opening);

  // ---- the period, document by document
  const entries = [];
  if (createdAt >= start && createdAt < end && Number(party.openingBalance || 0)) {
    entries.push({
      date: party.createdAt,
      at: party.createdAt,
      master: true,
      type: 'Opening balance',
      no: '',
      narration: `Balance brought in when the ${label.toLowerCase()} was added`,
      sign: 1,
      amount: Number(party.openingBalance),
    });
  }
  for (const leg of legs) {
    const docs = await leg.Model.find({
      [legs[0].party]: party._id,
      ...leg.match,
      [leg.date]: { $gte: start, $lt: end },
    })
      .select(leg.select)
      .lean();
    docs.forEach((d) =>
      entries.push({
        date: d[leg.date],
        at: d.createdAt,
        type: leg.type,
        sign: leg.sign,
        id: String(d._id),
        ...leg.row(d),
      })
    );
  }
  // By day; on a day, the party's own opening balance first, then in the order entered.
  const zone = tz || DEFAULT_TZ;
  const dayOf = (d) => dayKey(new Date(d), zone);
  entries.sort(
    (a, b) =>
      dayOf(a.date).localeCompare(dayOf(b.date)) ||
      Number(Boolean(b.master)) - Number(Boolean(a.master)) ||
      new Date(a.at) - new Date(b.at)
  );

  // Customer: up = debit. Supplier: up = credit (what we owe grows).
  const upIsDebit = kind === 'customer';
  let balance = opening;
  let debit = 0;
  let credit = 0;
  let advance = 0;
  const rows = entries.map((e) => {
    const amount = r2(e.amount);
    balance = r2(balance + e.sign * amount);
    const isDebit = e.sign > 0 === upIsDebit;
    if (isDebit) debit += amount;
    else credit += amount;
    advance += Number(e.advance || 0);
    return {
      date: e.date,
      type: e.type,
      no: e.no || '',
      id: e.id || null,
      narration: e.narration || '',
      debit: isDebit ? amount : 0,
      credit: isDebit ? 0 : amount,
      balance,
    };
  });

  return {
    kind,
    party: {
      id: String(party._id),
      name: party.name,
      code: party.code || '',
      phone: party.phone || '',
      email: party.email || '',
      gstin: party.gstin || '',
      address: party.address || {},
      outstanding: r2(party.outstanding),
    },
    period: { from: period.fromKey, to: period.toKey },
    opening,
    rows,
    totals: { debit: r2(debit), credit: r2(credit) },
    closing: rows.length ? rows[rows.length - 1].balance : opening,
    advance: r2(advance),
  };
};

/** "Dr" / "Cr" side of a balance, as an accountant reads it. */
export const sideOf = (kind, amount) => {
  if (Math.abs(amount) < 0.005) return '';
  const owedToUs = kind === 'customer' ? amount > 0 : amount < 0;
  return owedToUs ? 'Dr' : 'Cr';
};

export default { buildLedger, periodOf, sideOf, CUSTOMER_LEGS, SUPPLIER_LEGS, KINDS };
