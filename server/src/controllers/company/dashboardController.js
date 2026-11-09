import dayjs from 'dayjs';
import mongoose from 'mongoose';
import Setting from '../../models/Setting.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import logger from '../../utils/logger.js';

/**
 * GET /api/v1/dashboard/summary
 *
 * Lightweight workspace summary powering the company home screen.
 * Business-transaction models (Order/Invoice/Payment) arrive in Phases 4-6,
 * so this endpoint degrades gracefully: it returns whatever is available and
 * zeroes for what isn't, never a 500.
 */
export const summary = asyncHandler(async (req, res) => {
  const companyId = req.companyId;
  const user = req.user;

  const startOfDay = dayjs().startOf('day').toDate();
  const startOfMonth = dayjs().startOf('month').toDate();
  // A salesman's home shows their own numbers, not the whole company's.
  const own = user.role === 'SALESMAN';
  const me = own ? new mongoose.Types.ObjectId(String(user.id)) : null;
  const bySalesman = own ? { salesman: me } : {};
  const byCollector = own ? { collectedBy: me } : {};

  const base = {
    salesToday: 0,
    ordersToday: 0,
    salesMtd: 0,
    invoicedMtd: 0,
    collectionsMtd: 0,
    paymentsMtd: 0,
    outstanding: 0,
    overdueCount: 0,
    lowStockCount: 0,
    pendingApprovals: 0,
    recentOrders: [],
  };

  // ---- Master-data stats (Phase 3) ---------------------------------------
  // The four groups below are independent: run them together so the summary
  // costs one database round trip instead of four in a row.
  const loadMasters = async () => {
    try {
      const [
        { default: Customer },
        { default: Product },
        { default: Supplier },
        { default: Warehouse },
        { default: Route },
        { default: User },
      ] = await Promise.all([
        import('../../models/Customer.js'),
        import('../../models/Product.js'),
        import('../../models/Supplier.js'),
        import('../../models/Warehouse.js'),
        import('../../models/Route.js'),
        import('../../models/User.js'),
      ]);

      const [customers, products, suppliers, warehouses, routes, users, lowStock, dues] =
        await Promise.all([
          Customer.countDocuments({ isActive: true }),
          Product.countDocuments({ isActive: true }),
          Supplier.countDocuments({ isActive: true }),
          Warehouse.countDocuments({ isActive: true }),
          Route.countDocuments({ isActive: true }),
          User.countDocuments({ isActive: true }),
          Product.countDocuments({ $expr: { $lte: ['$stock', '$lowStockLevel'] } }),
          Customer.aggregate([
            {
              $match: {
                companyId: new mongoose.Types.ObjectId(companyId),
                isDeleted: { $ne: true },
              },
            },
            { $group: { _id: null, total: { $sum: '$outstanding' } } },
          ]),
        ]);

      return {
        masters: { customers, products, suppliers, warehouses, routes, users },
        lowStockCount: lowStock,
        outstanding: dues?.[0]?.total ?? 0,
      };
    } catch (err) {
      logger.debug?.(`dashboard summary: master stats unavailable (${err.message})`);
      return {};
    }
  };

  // ---- Optional transactional stats (Phase 4+) ---------------------------
  const loadOrders = async () => {
    try {
      const { default: Order } = await import('../../models/Order.js');
      const moneyStatuses = { $nin: ['CANCELLED', 'REJECTED'] };
      const tenantId = new mongoose.Types.ObjectId(companyId);

      const [ordersToday, pendingSales, pending, recent, today] = await Promise.all([
        Order.countDocuments({
          ...bySalesman,
          status: moneyStatuses,
          createdAt: { $gte: startOfDay },
        }),
        Order.aggregate([
          {
            $match: {
              companyId: tenantId,
              isDeleted: { $ne: true },
              ...bySalesman,
              status: moneyStatuses,
              createdAt: { $gte: startOfMonth },
            },
          },
          { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' } } },
        ]),
        Order.countDocuments({ ...bySalesman, status: 'PENDING_APPROVAL' }),
        Order.find({ ...bySalesman })
          .sort({ createdAt: -1 })
          .limit(5)
          .populate('customerId', 'name businessName')
          .lean(),
        Order.aggregate([
          {
            $match: {
              companyId: tenantId,
              isDeleted: { $ne: true },
              ...bySalesman,
              status: moneyStatuses,
              createdAt: { $gte: startOfDay },
            },
          },
          { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
      ]);

      return {
        ordersToday,
        salesToday: Math.round((today?.[0]?.total || 0) * 100) / 100,
        ordersMtd: pendingSales?.[0]?.count || 0,
        salesMtd: Math.round((pendingSales?.[0]?.total || 0) * 100) / 100,
        pendingApprovals: pending,
        recentOrders: recent.map((o) => ({
          id: String(o._id),
          orderNo: o.orderNo,
          customerName: o.customerId?.name || o.customerName || '—',
          date: o.orderDate || o.createdAt,
          total: o.total,
          status: o.status,
        })),
      };
    } catch (err) {
      // Order model not shipped yet — keep zeroes.
      logger.debug?.(`dashboard summary: order stats unavailable (${err.message})`);
      return {};
    }
  };

  // ---- Invoice metrics (Phase 5) -----------------------------------------
  const loadInvoices = async () => {
    try {
      const { default: Invoice } = await import('../../models/Invoice.js');
      const tenantId = new mongoose.Types.ObjectId(companyId);

      const [invoicesMtd, invoiceOutstanding, overdue] = await Promise.all([
        Invoice.aggregate([
          {
            $match: {
              companyId: tenantId,
              isDeleted: { $ne: true },
              ...bySalesman,
              invoiceDate: { $gte: startOfMonth },
              status: { $nin: ['DRAFT', 'CANCELLED'] },
            },
          },
          { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } },
        ]),
        Invoice.aggregate([
          {
            $match: {
              companyId: tenantId,
              isDeleted: { $ne: true },
              ...bySalesman,
              status: { $nin: ['DRAFT', 'CANCELLED'] },
            },
          },
          { $group: { _id: null, total: { $sum: '$balanceDue' } } },
        ]),
        Invoice.countDocuments({
          ...bySalesman,
          status: { $in: ['OVERDUE', 'PARTIALLY_PAID'] },
          balanceDue: { $gt: 0 },
        }),
      ]);

      return {
        invoicedMtd: Math.round((invoicesMtd?.[0]?.total || 0) * 100) / 100,
        invoicesMtd: invoicesMtd?.[0]?.count || 0,
        invoiceOutstanding: Math.round((invoiceOutstanding?.[0]?.total || 0) * 100) / 100,
        overdueCount: overdue,
      };
    } catch (err) {
      logger.debug?.(`dashboard summary: invoice stats unavailable (${err.message})`);
      return {};
    }
  };

  // ---- Collection metrics (Phase 6) --------------------------------------
  const loadPayments = async () => {
    try {
      const { default: Payment } = await import('../../models/Payment.js');
      const tenantId = new mongoose.Types.ObjectId(companyId);

      const paymentsMtd = await Payment.aggregate([
        {
          $match: {
            companyId: tenantId,
            isDeleted: { $ne: true },
            ...byCollector,
            status: 'RECEIVED',
            paymentDate: { $gte: startOfMonth },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]);

      return {
        collectionsMtd: Math.round((paymentsMtd?.[0]?.total || 0) * 100) / 100,
        paymentsMtd: paymentsMtd?.[0]?.count || 0,
      };
    } catch {
      return {}; // Payment model unavailable — keep zeroes.
    }
  };

  const [masterStats, orderStats, invoiceStats, paymentStats, loadedSettings] = await Promise.all([
    loadMasters(),
    loadOrders(),
    loadInvoices(),
    loadPayments(),
    req.settings ? null : Setting.forCompany(companyId).catch(() => null),
  ]);
  const masters = masterStats.masters || {
    customers: 0,
    products: 0,
    suppliers: 0,
    warehouses: 0,
    routes: 0,
    users: 0,
  };
  const lowStockCount = masterStats.lowStockCount || 0;
  const outstanding = masterStats.outstanding || 0;
  const transactions = { ...orderStats, ...invoiceStats, ...paymentStats };

  // ---- Onboarding checklist ----------------------------------------------
  const settings = req.settings || loadedSettings;
  const setup = settings?.setupProgress || {};

  const data = {
    ...base,
    ...transactions,
    lowStockCount: own ? 0 : lowStockCount,
    // A salesman's dues are on the invoices they sold; others see the ledger total.
    outstanding: own ? (transactions.invoiceOutstanding ?? 0) : outstanding,
    scope: own ? 'MINE' : 'COMPANY',
    masters,
    setup,
    company: req.company
      ? {
          id: String(req.company._id),
          name: req.company.businessName,
          code: req.company.code,
          status: req.company.status,
          currency: req.company.currency,
          currencySymbol: req.company.currencySymbol,
        }
      : null,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
    },
  };

  return success(res, { message: 'OK', data });
});

export default { summary };
