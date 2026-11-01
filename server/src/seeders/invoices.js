import dayjs from 'dayjs';
import { runWithContext } from '../middlewares/tenantContext.js';
import logger from '../utils/logger.js';

import Invoice from '../models/Invoice.js';
import CreditNote from '../models/CreditNote.js';
import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import Product from '../models/Product.js';
import PriceList from '../models/PriceList.js';
import Setting from '../models/Setting.js';
import { CREDIT_NOTE_STATUS, INVOICE_STATUS } from '../config/constants.js';
import {
  nextInvoiceNumber,
  nextCreditNoteNumber,
  buildInvoiceLinesFromOrder,
  buildDirectInvoiceLines,
  buildCreditNoteLinesFromInvoice,
  refreshInvoiceStatus,
  syncOrderInvoicing,
  applyCreditNote,
} from '../services/invoiceService.js';

/**
 * Phase 5 demo invoices + credit notes.
 *
 * Produces a realistic register: an unpaid issued invoice, a partially paid
 * invoice, a partially invoiced dispatched order, an overdue direct invoice, a
 * draft, a fully paid counter sale and a credit note that has already been
 * applied against one of the invoices.
 *
 * Safe to re-run: skipped entirely when the tenant already has invoices.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const snapshotOf = (customer, order, settings) => ({
  order: order?._id || null,
  orderNo: order?.orderNo || '',
  direct: !order,

  customerId: customer._id,
  customerName: customer.name,
  customerCode: customer.code || '',
  customerPhone: customer.phone || '',
  customerGstin: customer.gstin || '',
  billingAddress: customer.address || order?.billingAddress || {},
  shippingAddress: customer.shippingAddress?.line1
    ? customer.shippingAddress
    : customer.address || order?.shippingAddress || {},

  salesman: order?.salesman || customer.assignedTo || null,
  route: order?.route || customer.route || null,
  warehouse: order?.warehouse || customer.warehouse || settings?.inventory?.defaultWarehouse || null,

  paymentMode: order?.paymentMode || (customer.paymentTerms === 'IMMEDIATE' ? 'CASH' : 'CREDIT'),
  paymentTerms: order?.paymentTerms || customer.paymentTerms || settings?.invoice?.defaultPaymentTerms || 'IMMEDIATE',
  creditDays: Number(order?.creditDays || customer.creditDays || 0),
  poReference: order?.poReference || '',
  placeOfSupply: customer.address?.state || settings?.tax?.placeOfSupply || '',

  notes: '',
  terms: settings?.invoice?.terms || '',
  footerNote: settings?.invoice?.footerNote || '',
  source: 'WEB',
});

const historyFor = (status, at, admin, note) => [
  {
    status: INVOICE_STATUS.DRAFT,
    at,
    by: admin?._id || null,
    byName: admin?.name || 'System',
    note: 'Invoice created',
  },
  ...(status === INVOICE_STATUS.DRAFT
    ? []
    : [
        {
          status,
          at: dayjs(at).add(10, 'minute').toDate(),
          by: admin?._id || null,
          byName: admin?.name || 'System',
          note,
        },
      ]),
];

const run = async (company, users = []) =>
  runWithContext({ scope: 'company', companyId: String(company._id), userId: null }, async () => {
    const existing = await Invoice.countDocuments({});
    if (existing > 0) {
      logger.info(`Invoices already seeded (${existing} found).`);
      return;
    }

    const [settings, products, customers, orders] = await Promise.all([
      Setting.forCompany(company._id),
      Product.find({ isActive: true }).lean(),
      Customer.find({ isActive: true }).sort({ createdAt: 1 }).lean(),
      Order.find({}).sort({ orderDate: 1 }),
    ]);

    if (!products.length || !customers.length) {
      logger.warn('Skipping invoice seed: products or customers missing.');
      return;
    }

    const admin = users.find((u) => u.role === 'COMPANY_ADMIN') || null;
    const productMap = new Map(products.map((p) => [String(p._id), p]));
    const bySku = new Map(products.map((p) => [p.sku, p]));
    const byName = new Map(customers.map((c) => [c.name, c]));
    const orderByCustomer = new Map(orders.map((o) => [String(o.customerId), o]));
    const defaultList = await PriceList.findOne({ isDefault: true }).lean();

    const priceListFor = async (customer) => {
      if (customer.priceList) {
        const list = await PriceList.findById(customer.priceList).lean();
        if (list) return list;
      }
      return defaultList;
    };

    const productInput = (sku, qty, discountPercent = 0) => {
      const product = bySku.get(sku);
      if (!product) throw new Error(`Seed invoice references unknown SKU ${sku}`);
      return { product: product._id, qty, discountPercent };
    };

    /**
     * Create an invoice, derive its status from the money it carries and keep
     * the customer balance / order progress consistent with the normal API.
     */
    const makeInvoice = async ({
      customerName,
      order = null,
      items = [],
      daysAgo = 0,
      dueInDays = 15,
      amountPaid = 0,
      status = INVOICE_STATUS.ISSUED,
      paymentMode,
      notes = '',
      poReference = '',
    }) => {
      const customer = customers.find((c) => String(c._id) === String(order?.customerId)) || byName.get(customerName) || customers[0];
      const priceList = await priceListFor(customer);
      const invoiceDate = dayjs().subtract(daysAgo, 'day').hour(10).minute(30).toDate();

      const priced = order
        ? await buildInvoiceLinesFromOrder(order, items, settings)
        : buildDirectInvoiceLines(items, { products: productMap, priceList, settings });

      const snapshot = snapshotOf(customer, order, settings);
      if (paymentMode) snapshot.paymentMode = paymentMode;
      if (poReference) snapshot.poReference = poReference;
      snapshot.notes = notes;

      const paid = round2(Math.min(Number(amountPaid || 0), priced.totals.total));
      const invoice = new Invoice({
        ...snapshot,
        invoiceDate,
        dueDate: dayjs(invoiceDate).add(dueInDays, 'day').toDate(),
        items: priced.lines,
        ...priced.totals,
        taxBreakup: priced.taxBreakup,
        status: INVOICE_STATUS.DRAFT,
        amountPaid: paid,
        balanceDue: round2(priced.totals.total - paid),
        creditNoteTotal: 0,
        creditNoteCount: 0,
        statusHistory: historyFor(status, invoiceDate, admin, 'Invoice issued'),
      });

      if (status !== INVOICE_STATUS.DRAFT) {
        invoice.status = INVOICE_STATUS.ISSUED;
        invoice.issuedAt = dayjs(invoiceDate).add(10, 'minute').toDate();
        invoice.issuedBy = admin?._id || null;
        refreshInvoiceStatus(invoice);
      }

      invoice.invoiceNo = await nextInvoiceNumber(company._id, settings, invoiceDate);
      await invoice.save();

      if (invoice.status !== INVOICE_STATUS.DRAFT) {
        await Customer.updateOne(
          { _id: invoice.customerId },
          { $inc: { outstanding: Number(invoice.balanceDue || 0) } }
        );
      }
      if (order) await syncOrderInvoicing(order._id);

      return invoice;
    };

    // ---- Invoices ---------------------------------------------------------
    const krishnaOrder = orderByCustomer.get(
      String((byName.get('Krishna Distributors') || customers[0])._id)
    );
    const sharmaOrder = orderByCustomer.get(
      String((byName.get('Sharma General Store') || customers[0])._id)
    );
    const balajiOrder = orderByCustomer.get(
      String((byName.get('Balaji Kirana Stores') || customers[0])._id)
    );

    // Fully invoiced delivered order, unpaid -> ISSUED
    const deliveredInvoice = await makeInvoice({
      customerName: 'Krishna Distributors',
      order: krishnaOrder,
      daysAgo: 3,
      dueInDays: 15,
      status: INVOICE_STATUS.ISSUED,
      poReference: 'PO-8790',
      notes: 'Delivered in full; payment expected within the agreed credit period.',
    });

    // Fully invoiced confirmed order with a part payment -> PARTIALLY_PAID
    const partialTotal = sharmaOrder ? Number(sharmaOrder.total || 0) : 0;
    const partialInvoice = await makeInvoice({
      customerName: 'Sharma General Store',
      order: sharmaOrder,
      daysAgo: 0,
      dueInDays: 15,
      amountPaid: round2(partialTotal * 0.4),
      status: INVOICE_STATUS.PARTIALLY_PAID,
      poReference: 'PO-8841',
      notes: 'Part payment received at the counter.',
    });

    // Partially invoiced dispatched order -> order stays DISPATCHED
    const balajiLine = balajiOrder?.items?.[0];
    const partialLines = balajiLine
      ? [
          {
            orderItemId: balajiLine._id,
            qty: Math.max(1, Math.floor(Number(balajiLine.qty || 1) / 2)),
          },
        ]
      : [];
    const dispatchedInvoice = await makeInvoice({
      customerName: 'Balaji Kirana Stores',
      order: balajiOrder,
      items: partialLines,
      daysAgo: 1,
      dueInDays: 10,
      status: INVOICE_STATUS.ISSUED,
      notes: 'First dispatch invoiced; balance follows with the next dispatch.',
    });

    // Overdue direct invoice (unpaid, due 30 days ago) -> OVERDUE
    const overdueInvoice = await makeInvoice({
      customerName: 'Patel Super Market',
      items: [productInput('PRD-00002', 6), productInput('PRD-00009', 4, 3)],
      daysAgo: 45,
      dueInDays: 15,
      status: INVOICE_STATUS.ISSUED,
      notes: 'Counter requirement billed directly; follow up for collection.',
    });

    // Draft direct invoice (does not affect outstanding) -> DRAFT
    await makeInvoice({
      customerName: 'Metro Cash & Carry',
      items: [productInput('PRD-00010', 10, 5)],
      daysAgo: 0,
      dueInDays: 15,
      status: INVOICE_STATUS.DRAFT,
      notes: 'Draft — confirm the delivered quantity before issuing.',
    });

    const paidItems = [productInput('PRD-00013', 5), productInput('PRD-00014', 12)];

    // Counter sale paid in full -> PAID
    const paidPriceList = await priceListFor(byName.get('Ganesh Provision Store') || customers[0]);
    const paidPriced = buildDirectInvoiceLines(paidItems, {
      products: productMap,
      priceList: paidPriceList,
      settings,
    });
    await makeInvoice({
      customerName: 'Ganesh Provision Store',
      items: paidItems,
      daysAgo: 2,
      dueInDays: 0,
      amountPaid: paidPriced.totals.total,
      status: INVOICE_STATUS.PAID,
      paymentMode: 'CASH',
      notes: 'Counter sale settled in cash.',
    });

    // ---- Credit notes -----------------------------------------------------
    const makeCreditNote = async ({ invoice, qty, reason, reasonNote = '', issue = false, daysAgo = 1 }) => {
      const line = (invoice.items || [])[0];
      if (!line) return null;

      const requested = [{ invoiceItemId: line._id, qty: Math.min(Number(qty), Number(line.qty)) }];
      const priced = await buildCreditNoteLinesFromInvoice(invoice, requested, settings);
      const noteDate = dayjs().subtract(daysAgo, 'day').hour(12).toDate();

      const note = new CreditNote({
        invoice: invoice._id,
        invoiceNo: invoice.invoiceNo,
        order: invoice.order || null,
        orderNo: invoice.orderNo || '',
        customerId: invoice.customerId,
        customerName: invoice.customerName,
        customerCode: invoice.customerCode || '',
        customerPhone: invoice.customerPhone || '',
        customerGstin: invoice.customerGstin || '',
        billingAddress: invoice.billingAddress || {},
        salesman: invoice.salesman || null,
        reason,
        reasonNote,
        creditNoteDate: noteDate,
        items: priced.lines,
        ...priced.totals,
        taxBreakup: priced.taxBreakup,
        appliedAmount: 0,
        unappliedAmount: 0,
        status: CREDIT_NOTE_STATUS.DRAFT,
        statusHistory: [
          {
            status: CREDIT_NOTE_STATUS.DRAFT,
            at: noteDate,
            by: admin?._id || null,
            byName: admin?.name || 'System',
            note: `Created against ${invoice.invoiceNo}`,
          },
          ...(issue
            ? [
                {
                  status: CREDIT_NOTE_STATUS.ISSUED,
                  at: dayjs(noteDate).add(10, 'minute').toDate(),
                  by: admin?._id || null,
                  byName: admin?.name || 'System',
                  note: 'Credit note issued',
                },
              ]
            : []),
        ],
        notes: '',
        source: 'WEB',
      });

      note.creditNoteNo = await nextCreditNoteNumber(company._id, settings, noteDate);

      if (issue) {
        note.status = CREDIT_NOTE_STATUS.ISSUED;
        note.issuedAt = dayjs(noteDate).add(10, 'minute').toDate();
        note.issuedBy = admin?._id || null;
        await applyCreditNote(note, invoice);
      }

      await note.save();
      return note;
    };

    const issuedCredit = await makeCreditNote({
      invoice: deliveredInvoice,
      qty: 2,
      reason: 'DAMAGE',
      reasonNote: 'Two cases were damaged in transit and returned by the outlet.',
      issue: true,
      daysAgo: 1,
    });

    await makeCreditNote({
      invoice: partialInvoice,
      qty: 1,
      reason: 'RATE_DIFFERENCE',
      reasonNote: 'Pending approval: scheme price was applied late.',
      issue: false,
      daysAgo: 0,
    });

    logger.info(
      `Seeded ${await Invoice.countDocuments({})} invoices and ${await CreditNote.countDocuments({})} credit notes ` +
        `(overdue: ${overdueInvoice.invoiceNo}, dispatched partial: ${dispatchedInvoice.invoiceNo}` +
        `${issuedCredit ? `, credit: ${issuedCredit.creditNoteNo}` : ''}).`
    );
  });

export default run;
