const express = require('express');
const { protect, checkLicense } = require('../middleware/auth');
const { mongoIdValidation, paginationValidation, salesOrderValidation } = require('../validations');
const {
  salesOrderController, expenseController, attendanceController, tourVisitController,
  dayCashOutController, cashChequeDepositController, salesReturnController,
  monthlyJourneyPlanController,
} = require('../controllers/moduleControllers');
const approvalController = require('../controllers/approvalController');

const router = express.Router();
router.use(protect, checkLicense);

// Sales Orders
router.post('/sales-order', salesOrderValidation, salesOrderController.create);
router.get('/sales-order', paginationValidation, salesOrderController.getAll);
router.get('/sales-order/:id', mongoIdValidation, salesOrderController.getById);
router.put('/sales-order/:id', mongoIdValidation, salesOrderController.update);
router.delete('/sales-order/:id', mongoIdValidation, salesOrderController.delete);

// Expenses
router.post('/expense', expenseController.create);
router.get('/expense', paginationValidation, expenseController.getAll);
router.get('/expense/:id', mongoIdValidation, expenseController.getById);
router.put('/expense/:id', mongoIdValidation, expenseController.update);
router.delete('/expense/:id', mongoIdValidation, expenseController.delete);

// Attendance
router.post('/attendance', attendanceController.create);
router.get('/attendance', paginationValidation, attendanceController.getAll);
router.get('/attendance/:id', mongoIdValidation, attendanceController.getById);
router.put('/attendance/:id', mongoIdValidation, attendanceController.update);
router.delete('/attendance/:id', mongoIdValidation, attendanceController.delete);

// Tour Visits
router.post('/tour-visit', tourVisitController.create);
router.get('/tour-visit', paginationValidation, tourVisitController.getAll);
router.get('/tour-visit/:id', mongoIdValidation, tourVisitController.getById);
router.put('/tour-visit/:id', mongoIdValidation, tourVisitController.update);
router.delete('/tour-visit/:id', mongoIdValidation, tourVisitController.delete);

// Day Cash Out
router.post('/day-cash-out', dayCashOutController.create);
router.get('/day-cash-out', paginationValidation, dayCashOutController.getAll);
router.get('/day-cash-out/:id', mongoIdValidation, dayCashOutController.getById);
router.put('/day-cash-out/:id', mongoIdValidation, dayCashOutController.update);

// Cash/Cheque Deposit
router.post('/cash-cheque-deposit', cashChequeDepositController.create);
router.get('/cash-cheque-deposit', paginationValidation, cashChequeDepositController.getAll);
router.get('/cash-cheque-deposit/:id', mongoIdValidation, cashChequeDepositController.getById);
router.put('/cash-cheque-deposit/:id', mongoIdValidation, cashChequeDepositController.update);

// Sales Returns
router.post('/sales-return', salesReturnController.create);
router.get('/sales-return', paginationValidation, salesReturnController.getAll);
router.get('/sales-return/:id', mongoIdValidation, salesReturnController.getById);
router.put('/sales-return/:id', mongoIdValidation, salesReturnController.update);

// Monthly Journey Plan
router.post('/monthly-journey-plan', monthlyJourneyPlanController.create);
router.get('/monthly-journey-plan', paginationValidation, monthlyJourneyPlanController.getAll);
router.get('/monthly-journey-plan/:id', mongoIdValidation, monthlyJourneyPlanController.getById);
router.put('/monthly-journey-plan/:id', mongoIdValidation, monthlyJourneyPlanController.update);
router.delete('/monthly-journey-plan/:id', mongoIdValidation, monthlyJourneyPlanController.delete);

// Approvals
router.get('/approval/pending', approvalController.getPendingApprovals);
router.put('/approval/:id/approve', mongoIdValidation, approvalController.approveRequest);
router.put('/approval/:id/reject', mongoIdValidation, approvalController.rejectRequest);

module.exports = router;
