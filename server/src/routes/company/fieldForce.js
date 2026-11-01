import { Router } from 'express';
import * as ff from '../../controllers/company/fieldForceController.js';
import * as exp from '../../controllers/company/expenseController.js';
import * as tgt from '../../controllers/company/targetController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import {
  attendanceCheckInSchema,
  attendanceCheckOutSchema,
  attendanceUpdateSchema,
  attendanceReviewSchema,
  attendanceListQuerySchema,
  visitCreateSchema,
  visitUpdateSchema,
  visitCheckInSchema,
  visitCheckOutSchema,
  visitSkipSchema,
  visitCancelSchema,
  visitListQuerySchema,
  expenseCreateSchema,
  expenseUpdateSchema,
  expenseSubmitSchema,
  expenseApproveSchema,
  expenseRejectSchema,
  expensePaySchema,
  expenseListQuerySchema,
  targetCreateSchema,
  targetUpdateSchema,
  targetCloseSchema,
  targetListQuerySchema,
} from '../../validators/fieldForceValidators.js';

/**
 * Phase 7 - Field Force API.
 * Mounted at /api/v1/field-force with four sub-resources:
 *   /attendance, /visits, /expenses, /targets
 * Static routes are declared before `/:id`.
 */

// ===========================================================================
// Attendance
// ===========================================================================
export const attendance = Router();

attendance.get('/today', authorize('fieldforce.attendance.view'), ff.myToday);
attendance.get('/summary', authorize('fieldforce.view'), ff.attendanceSummary);
attendance.get('/', authorize('fieldforce.attendance.view'), validate({ query: attendanceListQuerySchema }), ff.listAttendance);

// Check-in/out are performed by the signed-in rep (manage permission).
attendance.post('/check-in', authorize('fieldforce.attendance.manage'), validate({ body: attendanceCheckInSchema }), ff.checkIn);
attendance.post('/check-out', authorize('fieldforce.attendance.manage'), validate({ body: attendanceCheckOutSchema }), ff.checkOut);

attendance.get('/:id', authorize('fieldforce.attendance.view'), validate({ params: idParamsSchema }), ff.getAttendance);
attendance.patch(
  '/:id',
  authorize('fieldforce.attendance.approve'),
  validate({ params: idParamsSchema, body: attendanceUpdateSchema }),
  ff.updateAttendance
);
attendance.post(
  '/:id/review',
  authorize('fieldforce.attendance.approve'),
  validate({ params: idParamsSchema, body: attendanceReviewSchema }),
  ff.reviewAttendance
);

// ===========================================================================
// Visits
// ===========================================================================
export const visits = Router();

visits.get('/stats', authorize('fieldforce.visits.view'), ff.visitStats);
visits.get('/nearby', authorize('fieldforce.visits.view'), ff.nearbyCustomers);
visits.get('/', authorize('fieldforce.visits.view'), validate({ query: visitListQuerySchema }), ff.listVisits);
visits.post('/', authorize('fieldforce.visits.manage'), validate({ body: visitCreateSchema }), ff.createVisit);

visits.get('/:id', authorize('fieldforce.visits.view'), validate({ params: idParamsSchema }), ff.getVisit);
visits.patch(
  '/:id',
  authorize('fieldforce.visits.manage'),
  validate({ params: idParamsSchema, body: visitUpdateSchema }),
  ff.updateVisit
);
visits.delete('/:id', authorize('fieldforce.visits.manage'), validate({ params: idParamsSchema }), ff.removeVisit);

visits.post(
  '/:id/check-in',
  authorize('fieldforce.visits.manage'),
  validate({ params: idParamsSchema, body: visitCheckInSchema }),
  ff.visitCheckIn
);
visits.post(
  '/:id/check-out',
  authorize('fieldforce.visits.manage'),
  validate({ params: idParamsSchema, body: visitCheckOutSchema }),
  ff.visitCheckOut
);
visits.post(
  '/:id/skip',
  authorize('fieldforce.visits.manage'),
  validate({ params: idParamsSchema, body: visitSkipSchema }),
  ff.skipVisit
);
visits.post(
  '/:id/cancel',
  authorize('fieldforce.visits.manage'),
  validate({ params: idParamsSchema, body: visitCancelSchema }),
  ff.cancelVisit
);

// ===========================================================================
// Expenses
// ===========================================================================
export const expenses = Router();

expenses.get('/stats', authorize('fieldforce.expenses.view'), exp.stats);
expenses.get('/form-options', authorize('fieldforce.expenses.view'), exp.formOptions);
expenses.get('/export', authorize('fieldforce.expenses.view'), validate({ query: expenseListQuerySchema }), exp.exportXlsx);
expenses.get('/', authorize('fieldforce.expenses.view'), validate({ query: expenseListQuerySchema }), exp.list);
expenses.post('/', authorize('fieldforce.expenses.manage'), validate({ body: expenseCreateSchema }), exp.create);

expenses.get('/:id', authorize('fieldforce.expenses.view'), validate({ params: idParamsSchema }), exp.get);
expenses.patch(
  '/:id',
  authorize('fieldforce.expenses.manage'),
  validate({ params: idParamsSchema, body: expenseUpdateSchema }),
  exp.update
);
expenses.put(
  '/:id',
  authorize('fieldforce.expenses.manage'),
  validate({ params: idParamsSchema, body: expenseUpdateSchema }),
  exp.update
);
expenses.delete('/:id', authorize('fieldforce.expenses.manage'), validate({ params: idParamsSchema }), exp.remove);

expenses.post(
  '/:id/submit',
  authorize('fieldforce.expenses.manage'),
  validate({ params: idParamsSchema, body: expenseSubmitSchema }),
  exp.submit
);
expenses.post(
  '/:id/approve',
  authorize('fieldforce.expenses.approve'),
  validate({ params: idParamsSchema, body: expenseApproveSchema }),
  exp.approve
);
expenses.post(
  '/:id/reject',
  authorize('fieldforce.expenses.approve'),
  validate({ params: idParamsSchema, body: expenseRejectSchema }),
  exp.reject
);
expenses.post(
  '/:id/pay',
  authorize('fieldforce.expenses.approve'),
  validate({ params: idParamsSchema, body: expensePaySchema }),
  exp.markPaid
);
expenses.post(
  '/:id/reopen',
  authorize('fieldforce.expenses.approve'),
  validate({ params: idParamsSchema }),
  exp.reopen
);

// ===========================================================================
// Targets
// ===========================================================================
export const targets = Router();

targets.get('/progress', authorize('fieldforce.targets.view'), tgt.progress);
targets.get('/form-options', authorize('fieldforce.targets.view'), tgt.formOptions);
targets.get('/', authorize('fieldforce.targets.view'), validate({ query: targetListQuerySchema }), tgt.list);
targets.post('/', authorize('fieldforce.targets.manage'), validate({ body: targetCreateSchema }), tgt.create);

targets.get('/:id', authorize('fieldforce.targets.view'), validate({ params: idParamsSchema }), tgt.get);
targets.patch(
  '/:id',
  authorize('fieldforce.targets.manage'),
  validate({ params: idParamsSchema, body: targetUpdateSchema }),
  tgt.update
);
targets.put(
  '/:id',
  authorize('fieldforce.targets.manage'),
  validate({ params: idParamsSchema, body: targetUpdateSchema }),
  tgt.update
);
targets.delete('/:id', authorize('fieldforce.targets.manage'), validate({ params: idParamsSchema }), tgt.remove);

targets.post(
  '/:id/close',
  authorize('fieldforce.targets.manage'),
  validate({ params: idParamsSchema, body: targetCloseSchema }),
  tgt.close
);
targets.post('/:id/refresh', authorize('fieldforce.targets.view'), validate({ params: idParamsSchema }), tgt.refresh);

export default { attendance, visits, expenses, targets };
