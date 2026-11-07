import { Router } from 'express';
import { discounts, schemes, preview } from '../../controllers/company/pricingController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { idParamsSchema } from '../../validators/companyValidators.js';
import {
  discountCreateSchema,
  discountUpdateSchema,
  discountListQuerySchema,
  schemeCreateSchema,
  schemeUpdateSchema,
  schemeListQuerySchema,
  pricingPreviewSchema,
} from '../../validators/pricingValidators.js';

/** CRUD routes for one master (list / create / get / update / delete). */
const crudRouter = (ctrl, prefix, { create, update, list }) => {
  const router = Router();
  router.get('/', authorize(`${prefix}.view`), validate({ query: list }), ctrl.list);
  router.post('/', authorize(`${prefix}.create`), validate({ body: create }), ctrl.create);
  router
    .route('/:id')
    .all(validate({ params: idParamsSchema }))
    .get(authorize(`${prefix}.view`), ctrl.get)
    .patch(authorize(`${prefix}.update`), validate({ body: update }), ctrl.update)
    .put(authorize(`${prefix}.update`), validate({ body: update }), ctrl.update)
    .delete(authorize(`${prefix}.delete`), ctrl.remove);
  return router;
};

export const discountRoutes = crudRouter(discounts, 'discounts', {
  create: discountCreateSchema,
  update: discountUpdateSchema,
  list: discountListQuerySchema,
});

export const schemeRoutes = crudRouter(schemes, 'schemes', {
  create: schemeCreateSchema,
  update: schemeUpdateSchema,
  list: schemeListQuerySchema,
});

/** Pricing preview for the order / invoice editors. */
export const pricingRoutes = Router();
pricingRoutes.post(
  '/preview',
  authorize('orders.create || orders.update || invoices.create || invoices.update'),
  validate({ body: pricingPreviewSchema }),
  preview
);
