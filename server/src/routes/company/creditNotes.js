import { Router } from 'express';
import * as ctrl from '../../controllers/company/creditNoteController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import {
  creditNoteCreateSchema,
  creditNoteUpdateSchema,
  creditNoteIssueSchema,
  creditNoteCancelSchema,
  creditNoteListQuerySchema,
  creditNoteFormOptionsQuerySchema,
} from '../../validators/creditNoteValidators.js';

/**
 * Phase 5 - Credit Notes API.
 * Static routes are declared before `/:id`.
 */
const router = Router();

router.get('/', authorize('creditnotes.view'), validate({ query: creditNoteListQuerySchema }), ctrl.list);
router.get('/stats', authorize('creditnotes.view'), ctrl.stats);
router.get(
  '/form-options',
  authorize('creditnotes.view'),
  validate({ query: creditNoteFormOptionsQuerySchema }),
  ctrl.formOptions
);
router.get(
  '/export',
  authorize('creditnotes.export'),
  validate({ query: creditNoteListQuerySchema }),
  ctrl.exportXlsx
);

router.post('/', authorize('creditnotes.create'), validate({ body: creditNoteCreateSchema }), ctrl.create);

router.get('/:id/pdf', validate({ params: idParamsSchema }), authorize('creditnotes.view'), ctrl.pdf);

router.post(
  '/:id/issue',
  validate({ params: idParamsSchema, body: creditNoteIssueSchema }),
  authorize('creditnotes.update'),
  ctrl.issue
);
router.post(
  '/:id/cancel',
  validate({ params: idParamsSchema, body: creditNoteCancelSchema }),
  authorize('creditnotes.cancel'),
  ctrl.cancel
);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('creditnotes.view'), ctrl.get)
  .patch(authorize('creditnotes.update'), validate({ body: creditNoteUpdateSchema }), ctrl.update)
  .put(authorize('creditnotes.update'), validate({ body: creditNoteUpdateSchema }), ctrl.update)
  .delete(authorize('creditnotes.delete'), ctrl.remove);

export default router;
