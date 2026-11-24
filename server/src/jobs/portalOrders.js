import dayjs from 'dayjs';
import Company from '../models/Company.js';
import Order from '../models/Order.js';
import Setting from '../models/Setting.js';
import Notification from '../models/Notification.js';
import { withTenant, withoutTenant } from '../middlewares/tenant.js';
import { notifyPermission, notifyUsers } from '../services/notifyService.js';
import { ORDER_STATUS } from '../config/constants.js';
import logger from '../utils/logger.js';

/**
 * Daily order housekeeping, per company:
 *
 * 1. Expire customer requests (portal orders still REQUESTED) older than
 *    portal.requestExpiryDays. They never reserved stock, so nothing is
 *    released; the customer sees "Expired" and the salesman is told.
 * 2. Remind about confirmed orders not invoiced after order.staleConfirmedDays:
 *    their stock stays reserved meanwhile. One reminder a day at most.
 */
const STALE_STATUSES = [ORDER_STATUS.CONFIRMED, ORDER_STATUS.PARTIALLY_INVOICED];

const expireRequests = async (settings, now) => {
  const days = Number(settings?.portal?.requestExpiryDays || 3);
  const before = dayjs(now).subtract(days, 'day').toDate();
  const orders = await Order.find({ status: ORDER_STATUS.REQUESTED, createdAt: { $lt: before } });
  for (const order of orders) {
    order.status = ORDER_STATUS.EXPIRED;
    order.statusHistory.push({
      status: ORDER_STATUS.EXPIRED,
      at: now,
      by: null,
      byName: 'System',
      note: `Not accepted within ${days} day${days === 1 ? '' : 's'}`,
    });
    await order.save();
    if (order.salesman) {
      await notifyUsers([order.salesman], {
        type: 'PORTAL_ORDER',
        title: `Online order ${order.orderNo} expired`,
        body: `${order.customerName} · nobody accepted it within ${days} day${days === 1 ? '' : 's'}`,
        link: `/app/orders/${order._id}`,
        entityType: 'Order',
        entityId: order._id,
      });
    }
  }
  return orders.length;
};

const remindStale = async (companyId, settings, now) => {
  const days = Number(settings?.order?.staleConfirmedDays ?? 7);
  if (!(days > 0)) return 0;
  const already = await Notification.exists({
    type: 'STALE_ORDER',
    createdAt: { $gte: dayjs(now).subtract(20, 'hour').toDate() },
  });
  if (already) return 0;

  const before = dayjs(now).subtract(days, 'day').toDate();
  const stale = await Order.find({ status: { $in: STALE_STATUSES }, orderDate: { $lt: before } })
    .select('salesman total')
    .lean();
  if (!stale.length) return 0;

  const link = `/app/orders?status=CONFIRMED&olderThanDays=${days}`;
  const total = stale.reduce((s, o) => s + Number(o.total || 0), 0);
  const plural = (n) => `${n} order${n === 1 ? '' : 's'}`;
  await notifyPermission(companyId, 'orders.approve', {
    type: 'STALE_ORDER',
    title: `${plural(stale.length)} confirmed but not invoiced for over ${days} days`,
    body: `Worth ${total.toFixed(2)}. Their stock stays reserved: invoice them or cancel the ones that will not go.`,
    link,
  });

  // Each salesman about their own.
  const bySalesman = new Map();
  stale.forEach((o) => {
    if (!o.salesman) return;
    const key = String(o.salesman);
    bySalesman.set(key, (bySalesman.get(key) || 0) + 1);
  });
  for (const [salesman, count] of bySalesman) {
    await notifyUsers([salesman], {
      type: 'STALE_ORDER',
      title: `${plural(count)} of yours confirmed but not invoiced for over ${days} days`,
      body: 'Follow up so they are invoiced, or ask for them to be cancelled.',
      link,
    });
  }
  return stale.length;
};

export const runPortalOrderJobs = async (now = new Date()) => {
  const companies = await withoutTenant(() =>
    Company.find({ status: { $in: ['ACTIVE', 'TRIAL'] }, isDeleted: { $ne: true } })
      .select('_id')
      .skipTenant()
      .lean()
  );
  let expired = 0;
  let stale = 0;
  for (const company of companies) {
    try {
      await withTenant(company._id, async () => {
        const settings = await Setting.forCompany(company._id);
        expired += await expireRequests(settings, now);
        stale += await remindStale(company._id, settings, now);
      });
    } catch (err) {
      logger.warn?.(`order housekeeping failed for ${company._id}: ${err.message}`);
    }
  }
  return { companies: companies.length, expired, stale };
};

export default runPortalOrderJobs;
