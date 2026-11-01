import dayjs from 'dayjs';
import { runWithContext } from '../middlewares/tenantContext.js';
import logger from '../utils/logger.js';

import Payment from '../models/Payment.js';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import Setting from '../models/Setting.js';
import { PAYMENT_STATUS } from '../config/constants.js';
import {
  nextPaymentNumber,
  applyPayment,
  reversePayment,
} from '../services/paymentService.js';

/**
 * Phase 6 demo payments.
 *
 * Produces a realistic collections register against the seeded invoices:
 *   - a full settlement (invoice flips to PAID)
 *   - a part payment against the overdue invoice (OVERDUE -> PARTIALLY_PAID)
 *   - an advance with no invoice allocated
 *   - a draft awaiting confirmation
 *   - a cheque that bounced (allocation reversed, kept for audit)
 *
 * Safe to re-run: skipped entirely when the tenant already has payments.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const historyFor = (status, at, by, name, note) => [
  { status: PAYMENT_STATUS.DRAFT, at, by: by || null, byName: name || 'System', note: 'Payment created' },
  ...(status === PAYMENT_STATUS.DRAFT
    ? []
    : [
        {
          status,
          at: dayjs(at).add(10, 'minute').toDate(),
          by: by || null,
          byName: name || 'System',
          note,
        },
      ]),
];

const run = async (company, users = []) =>
  runWithContext({ scope: 'company', companyId: String(company._id), userId: null }, async () => {
    const existing = await Payment.countDocuments({});
    if (existing > 0) {
      logger.info(`Payments already seeded (${existing} found).`);
      return;
    }

    const [settings, customers] = await Promise.all([
      Setting.forCompany(company._id),
      Customer.find({ isActive: true }).sort({ createdAt: 1 }).lean(),
    ]);
    if (!customers.length) {
      logger.warn('Skipping payment seed: no customers found.');
      return;
    }

    const accountant = users.find((u) => u.role === 'ACCOUNTANT') || users.find((u) => u.role === 'COMPANY_ADMIN') || null;
    const collector = users.find((u) => u.role === 'SALESMAN') || accountant || null;
    const byName = new Map(customers.map((c) => [c.name, c]));

    // Issued-ish invoices, freshest dues first, so part payments land sensibly.
    const payable = await Invoice.find({
      status: { $in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
    })
      .sort({ dueDate: 1 })
      .lean();

    const makePayment = async ({
      customerName,
      amount,
      allocations = [],
      mode = 'CASH',
      reference = '',
      bankName = '',
      reason = 'INVOICE_SETTLEMENT',
      daysAgo = 0,
      status = PAYMENT_STATUS.RECEIVED,
      notes = '',
      bounced = false,
    }) => {
      const customer =
        byName.get(customerName) ||
        customers.find((c) => allocations.some((a) => String(a.invoice.customerId) === String(c._id))) ||
        customers[0];

      const paymentDate = dayjs().subtract(daysAgo, 'day').hour(11).minute(15).toDate();
      const payment = new Payment({
        customerId: customer._id,
        customerName: customer.name,
        customerCode: customer.code || '',
        customerPhone: customer.phone || '',
        amount: round2(amount),
        allocations: allocations.map((a) => ({
          invoice: a.invoice._id,
          invoiceNo: a.invoice.invoiceNo,
          amount: round2(a.amount),
        })),
        amountApplied: 0,
        unappliedAmount: round2(amount),
        paymentDate,
        mode,
        reference,
        bankName,
        reason,
        collectedBy: collector?._id || null,
        notes,
        status: PAYMENT_STATUS.DRAFT,
        statusHistory: historyFor(status, paymentDate, accountant?._id, accountant?.name, 'Payment received'),
        source: 'WEB',
      });
      payment.paymentNo = await nextPaymentNumber(company._id, settings, paymentDate);

      if (status !== PAYMENT_STATUS.DRAFT) {
        payment.status = PAYMENT_STATUS.RECEIVED;
        payment.receivedAt = dayjs(paymentDate).add(10, 'minute').toDate();
        payment.receivedBy = accountant?._id || null;

        const ids = payment.allocations.map((a) => String(a.invoice));
        const invoicesById = new Map(
          (await Invoice.find({ _id: { $in: ids } })).map((d) => [String(d._id), d])
        );
        await applyPayment(payment, invoicesById);

        if (bounced) {
          // Reverse what was just applied and mark the cheque bounced.
          await reversePayment(payment, invoicesById);
          payment.status = PAYMENT_STATUS.BOUNCED;
          payment.bouncedAt = dayjs(paymentDate).add(2, 'day').toDate();
          payment.bounceReason = 'Cheque returned: insufficient funds.';
          payment.statusHistory.push({
            status: PAYMENT_STATUS.BOUNCED,
            at: payment.bouncedAt,
            by: accountant?._id || null,
            byName: accountant?.name || 'System',
            note: 'Cheque bounced',
          });
        }
      }

      await payment.save();
      return payment;
    };

    // 1) Full settlement of the oldest issued invoice -> PAID
    const fullTarget = payable.find((i) => Number(i.balanceDue || 0) > 0 && i.status === 'ISSUED');
    if (fullTarget) {
      await makePayment({
        amount: round2(fullTarget.balanceDue),
        allocations: [{ invoice: fullTarget, amount: round2(fullTarget.balanceDue) }],
        mode: 'UPI',
        reference: `UPI${dayjs().format('DDHHmm')}XZ`,
        reason: 'INVOICE_SETTLEMENT',
        daysAgo: 2,
        notes: `Full settlement of ${fullTarget.invoiceNo} via UPI.`,
      });
    }

    // 2) Part payment against the overdue invoice -> PARTIALLY_PAID
    const overdue = payable.find((i) => i.status === 'OVERDUE') || payable.find((i) => Number(i.balanceDue || 0) > 0);
    if (overdue) {
      const part = round2(Number(overdue.balanceDue || 0) * 0.5);
      await makePayment({
        customerName: overdue.customerName,
        amount: part,
        allocations: [{ invoice: overdue, amount: part }],
        mode: 'CASH',
        reason: 'PART_PAYMENT',
        daysAgo: 1,
        notes: `Part payment collected on visit; balance promised next week.`,
      });
    }

    // 3) Advance with no invoice allocated
    const advanceCustomer = byName.get('Metro Cash & Carry') || customers[0];
    await makePayment({
      customerName: advanceCustomer.name,
      amount: 2500,
      allocations: [],
      mode: 'BANK_TRANSFER',
      reference: `NEFT${dayjs().format('DDMM')}4421`,
      bankName: 'HDFC Bank',
      reason: 'ADVANCE',
      daysAgo: 3,
      notes: 'Advance received against future supply.',
    });

    // 4) A cheque that later bounced (kept for audit; allocation reversed)
    const bounceTarget = payable.find(
      (i) => i.status !== 'OVERDUE' && Number(i.balanceDue || 0) > 0 && String(i._id) !== String(fullTarget?._id)
    );
    if (bounceTarget) {
      const amount = round2(Math.min(Number(bounceTarget.balanceDue || 0), 1500));
      if (amount > 0) {
        await makePayment({
          customerName: bounceTarget.customerName,
          amount,
          allocations: [{ invoice: bounceTarget, amount }],
          mode: 'CHEQUE',
          reference: `CHQ${dayjs().format('DD')}778811`,
          bankName: 'State Bank of India',
          daysAgo: 4,
          notes: 'Cheque collected on delivery route.',
          bounced: true,
        });
      }
    }

    // 5) A draft awaiting confirmation (counter entry not yet verified)
    const draftTarget = payable.find((i) => Number(i.balanceDue || 0) > 0);
    if (draftTarget) {
      await makePayment({
        customerName: draftTarget.customerName,
        amount: round2(Math.min(Number(draftTarget.balanceDue || 0), 750)),
        allocations: [{ invoice: draftTarget, amount: round2(Math.min(Number(draftTarget.balanceDue || 0), 750)) }],
        mode: 'CARD',
        daysAgo: 0,
        status: PAYMENT_STATUS.DRAFT,
        notes: 'Card swipe done at the counter; awaiting settlement confirmation.',
      });
    }

    const total = await Payment.countDocuments({});
    const received = await Payment.countDocuments({ status: PAYMENT_STATUS.RECEIVED });
    logger.info(`Seeded ${total} payments (${received} received) across ${payable.length} payable invoices.`);
  });

export default run;
