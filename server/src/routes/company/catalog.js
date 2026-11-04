import { Router } from 'express';
import * as ctrl from '../../controllers/company/catalogController.js';
import { validate, z } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import { CATEGORY_LEVELS } from '../../models/ProductCategory.js';

const unitCreate = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(10)
    .regex(/^[A-Za-z][A-Za-z0-9]*$/, 'Letters and digits only, starting with a letter'),
  name: z.string().trim().min(1, 'Name is required').max(40),
  allowDecimals: z.boolean().optional(),
});
const unitUpdate = z
  .object({ name: z.string().trim().min(1).max(40), allowDecimals: z.boolean(), isActive: z.boolean() })
  .partial();

const categoryCreate = z.object({
  level: z.enum(CATEGORY_LEVELS),
  name: z.string().trim().min(1, 'Name is required').max(80),
  parent: z.string().optional().nullable(),
});
const categoryUpdate = z.object({ name: z.string().trim().min(1).max(80), isActive: z.boolean() }).partial();

/** /api/v1/units - units of measure. */
export const units = Router();
units.get('/', authorize('products.view'), ctrl.listUnits);
units.post('/', authorize('products.create'), validate({ body: unitCreate }), ctrl.createUnit);
units.patch('/:id', authorize('products.update'), validate({ params: idParamsSchema, body: unitUpdate }), ctrl.updateUnit);
units.delete('/:id', authorize('products.delete'), validate({ params: idParamsSchema }), ctrl.removeUnit);

/** /api/v1/product-categories - classification / category / sub-category tree. */
export const categories = Router();
categories.get('/', authorize('products.view'), ctrl.listCategories);
categories.post('/', authorize('products.create'), validate({ body: categoryCreate }), ctrl.createCategory);
categories.patch(
  '/:id',
  authorize('products.update'),
  validate({ params: idParamsSchema, body: categoryUpdate }),
  ctrl.updateCategory
);
categories.delete('/:id', authorize('products.delete'), validate({ params: idParamsSchema }), ctrl.removeCategory);
