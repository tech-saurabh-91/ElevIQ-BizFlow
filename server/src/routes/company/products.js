import { Router } from 'express';
import * as ctrl from '../../controllers/company/productController.js';
import { validate } from '../../middlewares/validate.js';
import { authorize } from '../../middlewares/rbac.js';
import { spreadsheetUpload } from '../../middlewares/upload.js';
import {
  idParamsSchema,
  productCreateSchema,
  productUpdateSchema,
  productListQuerySchema,
} from '../../validators/companyValidators.js';

const router = Router();

router.get('/', authorize('products.view'), validate({ query: productListQuerySchema }), ctrl.list);

router.post('/', authorize('products.create'), validate({ body: productCreateSchema }), ctrl.create);

// Bulk import: download the template, then upload it (dryRun=true validates only).
router.get('/import/template', authorize('products.create'), ctrl.importTemplate);
router.post('/import', authorize('products.create'), spreadsheetUpload.single('file'), ctrl.importFile);

router
  .route('/:id')
  .all(validate({ params: idParamsSchema }))
  .get(authorize('products.view'), ctrl.get)
  .patch(authorize('products.update'), validate({ body: productUpdateSchema }), ctrl.update)
  .put(authorize('products.update'), validate({ body: productUpdateSchema }), ctrl.update)
  .delete(authorize('products.delete'), ctrl.remove);

export default router;
