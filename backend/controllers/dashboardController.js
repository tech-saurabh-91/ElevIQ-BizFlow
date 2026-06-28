const { SalesOrder, TourVisit, Expense, Attendance, Approval, Customer, Item, User } = require('../models');
const { ApiResponse } = require('../utils/apiResponse');

const getDashboard = async (req, res, next) => {
  try {
    const companyId = req.companyId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      todayOrders,
      todayInvoices,
      todayExpenses,
      pendingApprovals,
      approvedToday,
      attendanceHistory,
      totalCustomers,
      totalItems,
      totalUsers,
      recentOrders,
    ] = await Promise.all([
      SalesOrder.countDocuments({ companyId, createdAt: { $gte: today, $lt: tomorrow } }),
      SalesOrder.aggregate([
        { $match: { companyId, createdAt: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, total: { $sum: '$grandTotal' } } },
      ]),
      Expense.aggregate([
        { $match: { companyId, createdAt: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Approval.countDocuments({ companyId, status: 'pending' }),
      Approval.countDocuments({ companyId, status: 'approved', approvedAt: { $gte: today, $lt: tomorrow } }),
      Attendance.find({ companyId, userId: req.user._id }).sort({ date: -1 }).limit(7),
      Customer.countDocuments({ companyId, isActive: true }),
      Item.countDocuments({ companyId, isActive: true }),
      User.countDocuments({ companyId, isActive: true }),
      SalesOrder.find({ companyId }).sort({ createdAt: -1 }).limit(5).populate('customerId executiveId'),
    ]);

    const todayOrderValue = todayInvoices.length > 0 ? todayInvoices[0].total : 0;
    const todayExpenseAmount = todayExpenses.length > 0 ? todayExpenses[0].total : 0;
    const tourVisits = await TourVisit.countDocuments({ companyId, visitDate: { $gte: today, $lt: tomorrow } });

    return res.status(200).json(new ApiResponse(200, {
      today: {
        tourVisits,
        sales: todayOrders,
        orderValue: todayOrderValue,
        totalInvoices: todayOrders,
        totalExpense: todayExpenseAmount,
      },
      approvals: {
        pending: pendingApprovals,
        approvedToday,
      },
      attendanceHistory,
      summary: {
        totalCustomers,
        totalItems,
        totalUsers,
      },
      recentOrders,
    }, 'Dashboard data fetched'));
  } catch (error) {
    next(error);
  }
};

module.exports = { getDashboard };
