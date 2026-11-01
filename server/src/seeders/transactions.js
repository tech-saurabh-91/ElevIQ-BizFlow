import dayjs from 'dayjs';
import { runWithContext } from '../middlewares/tenantContext.js';
import logger from '../utils/logger.js';

import Order from '../models/Order.js';
import Customer from '../models/Customer.js';
import Product from '../models/Product.js';
import PriceList from '../models/PriceList.js';
import Setting from '../models/Setting.js';
import { ORDER_STATUS } from '../config/constants.js';
import { buildOrderLines, nextOrderNumber } from '../services/orderService.js';

/**
 * Phase 4 demo transactions: a spread of purchased orders in different
 * workflow states so the list, dashboard and approval inbox are populated.
 *
 * Safe to re-run: skipped entirely when the tenant already has orders.
 */

const SALES_COUNTED = new Set([
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PARTIALLY_INVOICED,
  ORDER_STATUS.FULLY_INVOICED,
  ORDER_STATUS.DISPATCHED,
  ORDER_STATUS.DELIVERED,
]);

const snapshotOf = (customer) => ({
  customerId: customer._id,
  customerName: customer.name,
  customerCode: customer.code || '',
  customerPhone: customer.phone || '',
  customerGstin: customer.gstin || '',
  billingAddress: customer.address || {},
  shippingAddress: customer.shippingAddress?.line1 ? customer.shippingAddress : customer.address || {},
  salesman: customer.assignedTo || null,
  route: customer.route || null,
  warehouse: customer.warehouse || null,
  paymentMode: customer.paymentTerms === 'IMMEDIATE' ? 'CASH' : 'CREDIT',
  paymentTerms: customer.paymentTerms || 'IMMEDIATE',
  creditDays: customer.creditDays || 0,
});

const run = async (company, users = []) =>
  runWithContext({ scope: 'company', companyId: String(company._id), userId: null }, async () => {
    const existing = await Order.countDocuments({});
    if (existing > 0) {
      logger.info(`Orders already seeded (${existing} found).`);
      return;
    }

    const [settings, products, customers] = await Promise.all([
      Setting.forCompany(company._id),
      Product.find({ isActive: true }).lean(),
      Customer.find({ isActive: true }).sort({ createdAt: 1 }).lean(),
    ]);

    if (!products.length || !customers.length) {
      logger.warn('Skipping order seed: products or customers missing.');
      return;
    }

    const admin = users.find((u) => u.role === 'COMPANY_ADMIN') || null;
    const productMap = new Map(products.map((p) => [String(p._id), p]));
    const byName = new Map(customers.map((c) => [c.name, c]));
    const bySku = new Map(products.map((p) => [p.sku, p]));
    const defaultList = await PriceList.findOne({ isDefault: true }).lean();

    const priceListFor = async (customer) => {
      if (customer.priceList) {
        const list = await PriceList.findById(customer.priceList).lean();
        if (list) return list;
      }
      return defaultList;
    };

    const makeOrder = async ({
      customerName,
      daysAgo = 0,
      status,
      items,
      poReference = '',
      notes = '',
      approved = false,
      dispatchedDaysAgo = null,
      deliveredDaysAgo = null,
      cancelReason = '',
    }) => {
      const customer = byName.get(customerName) || customers[0];
      const priceList = await priceListFor(customer);
      const orderDate = dayjs().subtract(daysAgo, 'day').hour(11).minute(15).toDate();

      const inputs = items.map(([sku, qty, discountPercent = 0]) => {
        const product = bySku.get(sku);
        if (!product) throw new Error(`Seed order references unknown SKU ${sku}`);
        return { product: product._id, qty, discountPercent };
      });

      const priced = buildOrderLines(inputs, { products: productMap, priceList, settings });
      const orderNo = await nextOrderNumber(company._id, settings, orderDate);

      const history = [
        {
          status: ORDER_STATUS.DRAFT,
          at: orderDate,
          by: admin?._id || null,
          byName: admin?.name || 'System',
          note: 'Order created',
        },
      ];

      if (status !== ORDER_STATUS.DRAFT) {
        history.push({
          status:
            status === ORDER_STATUS.PENDING_APPROVAL ? ORDER_STATUS.PENDING_APPROVAL : ORDER_STATUS.CONFIRMED,
          at: dayjs(orderDate).add(20, 'minute').toDate(),
          by: admin?._id || null,
          byName: admin?.name || 'System',
          note: status === ORDER_STATUS.PENDING_APPROVAL ? 'Submitted for approval' : 'Approved',
        });
      }
      if (
        ![ORDER_STATUS.DRAFT, ORDER_STATUS.PENDING_APPROVAL, ORDER_STATUS.CONFIRMED, ORDER_STATUS.REJECTED].includes(
          status
        )
      ) {
        history.push({
          status,
          at: dayjs(orderDate).add(1, 'hour').toDate(),
          by: admin?._id || null,
          byName: admin?.name || 'System',
          note: `Marked ${status.toLowerCase()}`,
        });
      }
      if (status === ORDER_STATUS.CANCELLED) {
        history.push({
          status: ORDER_STATUS.CANCELLED,
          at: dayjs(orderDate).add(2, 'hour').toDate(),
          by: admin?._id || null,
          byName: admin?.name || 'System',
          note: cancelReason || 'Cancelled',
        });
      }

      const salesCounted = SALES_COUNTED.has(status);
      return {
        ...snapshotOf(customer),
        orderNo,
        orderDate,
        expectedDeliveryDate: dayjs(orderDate).add(2, 'day').toDate(),
        priceList: priceList?._id || null,
        items: priced.lines,
        ...priced.totals,
        taxBreakup: priced.taxBreakup,
        poReference,
        notes,
        status,
        approvalRequired: status === ORDER_STATUS.PENDING_APPROVAL,
        approvedBy: approved || status === ORDER_STATUS.DISPATCHED || status === ORDER_STATUS.DELIVERED ? admin?._id || null : null,
        approvedAt: approved || status === ORDER_STATUS.DISPATCHED || status === ORDER_STATUS.DELIVERED ? dayjs(orderDate).add(20, 'minute').toDate() : null,
        cancelledBy: status === ORDER_STATUS.CANCELLED ? admin?._id || null : null,
        cancelledAt: status === ORDER_STATUS.CANCELLED ? dayjs(orderDate).add(2, 'hour').toDate() : null,
        cancelReason: status === ORDER_STATUS.CANCELLED ? cancelReason : '',
        dispatchedAt: dispatchedDaysAgo == null ? null : dayjs().subtract(dispatchedDaysAgo, 'day').toDate(),
        deliveredAt: deliveredDaysAgo == null ? null : dayjs().subtract(deliveredDaysAgo, 'day').toDate(),
        salesCounted,
        statusHistory: history,
        source: 'WEB',
      };
    };

    const drafts = [
      await makeOrder({
        customerName: 'Sharma General Store',
        daysAgo: 0,
        status: ORDER_STATUS.CONFIRMED,
        poReference: 'PO-8841',
        items: [
          ['PRD-00001', 24],
          ['PRD-00006', 30],
          ['PRD-00011', 40, 2],
        ],
        approved: true,
      }),
      await makeOrder({
        customerName: 'Patel Super Market',
        daysAgo: 0,
        status: ORDER_STATUS.PENDING_APPROVAL,
        poReference: 'PO-8853',
        notes: 'Bulk monthly replenishment — awaiting manager sign-off.',
        items: [
          ['PRD-00002', 12],
          ['PRD-00004', 8],
          ['PRD-00009', 20, 3],
        ],
      }),
      await makeOrder({
        customerName: 'Krishna Distributors',
        daysAgo: 4,
        status: ORDER_STATUS.DELIVERED,
        poReference: 'PO-8790',
        items: [
          ['PRD-00003', 30],
          ['PRD-00005', 20],
          ['PRD-00012', 10],
        ],
        approved: true,
        dispatchedDaysAgo: 3,
        deliveredDaysAgo: 2,
      }),
      await makeOrder({
        customerName: 'Balaji Kirana Stores',
        daysAgo: 2,
        status: ORDER_STATUS.DISPATCHED,
        items: [
          ['PRD-00007', 18],
          ['PRD-00008', 12],
        ],
        approved: true,
        dispatchedDaysAgo: 1,
      }),
      await makeOrder({
        customerName: 'Metro Cash & Carry',
        daysAgo: 1,
        status: ORDER_STATUS.DRAFT,
        notes: 'Draft — confirm quantities after the outlet visit.',
        items: [['PRD-00010', 25, 5]],
      }),
      await makeOrder({
        customerName: 'Ganesh Provision Store',
        daysAgo: 6,
        status: ORDER_STATUS.CANCELLED,
        items: [
          ['PRD-00013', 10],
          ['PRD-00014', 24],
        ],
        cancelReason: 'Outlet cancelled the requirement for this week.',
      }),
    ];

    const created = await Order.create(drafts);

    // Keep the customer lifetime counters consistent with confirmed orders.
    const counters = new Map();
    created
      .filter((o) => o.salesCounted)
      .forEach((o) => {
        const key = String(o.customerId);
        const current = counters.get(key) || { count: 0, value: 0, last: null };
        current.count += 1;
        current.value += Number(o.total || 0);
        if (!current.last || o.orderDate > current.last) current.last = o.orderDate;
        counters.set(key, current);
      });
    for (const [customerId, agg] of counters.entries()) {
      await Customer.updateOne(
        { _id: customerId },
        {
          $inc: { totalOrders: agg.count, totalSales: Math.round(agg.value * 100) / 100 },
          $set: { lastOrderAt: agg.last },
        }
      );
    }

    await Setting.updateOne({}, { $set: { 'setupProgress.firstOrder': true } });

    logger.info(`Seeded ${created.length} demo orders.`);
    return created;
  });

export default run;
