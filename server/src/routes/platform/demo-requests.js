import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../../controllers/platform/demoRequestController.js';
import { validate, paginationSchema, objectIdSchema } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { DEMO_REQUEST_STATUSES } from '../../models/DemoRequest.js';

/**
 * /api/platform/demo-requests
 * Leads from the public "Book a demo" form. `authorize()` keeps
 * PLATFORM_SUPPORT read-only.
 */
const router = Router();
router.use(authorize());

const listQuery = paginationSchema.extend({
  status: z.enum([...DEMO_REQUEST_STATUSES, 'OPEN']).optional(),
  followUp: z.enum(['due']).optional(),
});

const params = z.object({ id: objectIdSchema });

const updateBody = z
  .object({
    status: z.enum(DEMO_REQUEST_STATUSES).optional(),
    followUpAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional(),
    convertedCompany: objectIdSchema.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });

const noteBody = z.object({
  text: z.string().trim().min(1, 'Write a note').max(2000),
  markContacted: z.boolean().optional(),
});

router.get('/', validate({ query: listQuery }), ctrl.list);
router.get('/new-count', ctrl.newCount);
router.get('/:id', validate({ params }), ctrl.get);
router.patch('/:id', validate({ params, body: updateBody }), ctrl.update);
router.post('/:id/notes', validate({ params, body: noteBody }), ctrl.addNote);
router.delete('/:id', validate({ params }), ctrl.remove);

export default router;
