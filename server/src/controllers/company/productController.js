import Product from '../../models/Product.js';
import { AppError } from '../../utils/errors.js';
import { buildCrudController } from './_crud.js';
import { markSetup } from './_helpers.js';
import { checkProduct, ensureCatalog, nextProductCode } from '../../services/catalogService.js';
import { recordMovement, resolveDefaultWarehouse, loadWarehouse } from '../../services/inventoryService.js';
import { findCountry } from '../../services/locationService.js';
import Setting from '../../models/Setting.js';
import Warehouse from '../../models/Warehouse.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS, MOVEMENT_TYPES } from '../../config/constants.js';
import { buildTemplate, importProducts } from '../../services/productImport.js';

// Maintained by the system: the code from the numbering series and stock
// from the inventory ledger.
const SYSTEM_FIELDS = ['sku', 'stock', 'unitType', 'altUnit', 'conversion'];

const isIndiaCompany = async (req) => (await findCountry(req.company?.address?.country))?.code === 'IN';

const failIfErrors = (errors) => {
  if (!errors.length) return;
  throw new AppError(errors[0].message, {
    status: 422,
    code: 'VALIDATION_ERROR',
    errors: errors.map((e) => ({ field: `body.${e.field}`, message: e.message })),
  });
};

const crud = buildCrudController({
  Model: Product,
  entityType: 'Product',
  labelField: 'name',
  searchFields: ['name', 'sku', 'customCode', 'barcode', 'packUnits.barcode', 'category', 'brand', 'hsnCode'],
  filtersSpec: {
    category: { type: 'string' },
    categoryId: { type: 'objectId' },
    classificationId: { type: 'objectId' },
    brand: { type: 'string' },
    isActive: { type: 'bool' },
  },
  sortAllowed: ['createdAt', 'name', 'sku', 'sellingPrice', 'stock', 'mrp'],
  label: 'Product',
  // Re-read after create so the response carries the stock just booked.
  populate: [{ path: 'openingWarehouse', select: 'name code' }],
  listFilter: (req) => {
    const filter = {};
    if (req.query.lowStock === 'true') {
      filter.$expr = { $lte: ['$stock', '$lowStockLevel'] };
    }
    return filter;
  },
  beforeCreate: async (payload, req) => {
    await ensureCatalog();
    SYSTEM_FIELDS.forEach((k) => delete payload[k]);
    const { data, errors } = await checkProduct(payload, { isIndia: await isIndiaCompany(req), creating: true });

    // Opening stock is booked into a warehouse through the stock ledger.
    if (Number(data.openingStock || 0) > 0) {
      const settings = await Setting.forCompany(req.companyId);
      const warehouse = data.openingWarehouse
        ? await loadWarehouse(data.openingWarehouse).catch(() => null)
        : await resolveDefaultWarehouse(settings);
      if (warehouse && !['MAIN', 'SUB'].includes(warehouse.type || 'MAIN')) {
        errors.push({ field: 'openingWarehouse', message: 'Opening stock goes into a main or sub warehouse, not a van' });
      } else if (warehouse) data.openingWarehouse = warehouse._id;
      // No warehouses at all yet: stock is held at company level.
      else if (await Warehouse.exists({})) {
        errors.push({ field: 'openingWarehouse', message: 'Choose the warehouse that holds the opening stock' });
      } else data.openingWarehouse = null;
    }
    failIfErrors(errors);

    data.sku = await nextProductCode(req.companyId);
    data.stock = 0;
    return data;
  },
  beforeUpdate: async (payload, req) => {
    SYSTEM_FIELDS.forEach((k) => delete payload[k]);
    delete payload.openingStock;
    delete payload.openingWarehouse;
    const existing = await Product.findById(req.params.id);
    if (!existing) return payload; // loadDoc reports the 404

    const current = existing.toObject();
    // Changing the base unit would re-interpret the stock already counted in it.
    if (payload.unit && payload.unit.toUpperCase() !== current.unit && Number(current.stock || 0) !== 0) {
      failIfErrors([{ field: 'unit', message: `Base unit cannot change while ${current.stock} ${current.unit} are in stock` }]);
    }
    const merged = { ...current, ...payload };
    if (payload.categoryId === undefined && payload.category === undefined) {
      merged.categoryId = current.categoryId;
    }
    const { data, errors } = await checkProduct(merged, { isIndia: await isIndiaCompany(req), existingId: existing._id });
    failIfErrors(errors);
    [
      'unit',
      'packUnits',
      'customCode',
      'barcode',
      'hsnCode',
      'classification',
      'classificationId',
      'category',
      'categoryId',
      'subCategory',
      'subCategoryId',
    ].forEach((k) => {
      payload[k] = data[k];
    });
    return payload;
  },
  afterCreate: async (doc, req) => {
    const opening = Number(doc.openingStock || 0);
    if (opening > 0) {
      await recordMovement({
        product: doc._id,
        warehouse: doc.openingWarehouse,
        qty: opening,
        type: MOVEMENT_TYPES.OPENING,
        refType: 'MANUAL',
        refNo: doc.sku,
        reason: 'Opening stock',
        unitCost: Number(doc.purchasePrice || 0),
        movedBy: req.user?.id || null,
      });
    }
    await markSetup('products');
  },
});

export const { list, get, create, update, remove } = crud;

/** GET /products/import/template - Excel template for bulk import. */
export const importTemplate = asyncHandler(async (req, res) => {
  const buffer = await buildTemplate({ isIndia: await isIndiaCompany(req) });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.xlsx"');
  res.send(Buffer.from(buffer));
});

/** POST /products/import?dryRun=true|false - validate (and import) an uploaded template. */
export const importFile = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    throw new AppError('Choose the filled-in template (.xlsx) to upload', { status: 422, code: 'FILE_REQUIRED' });
  }
  const result = await importProducts(req.file.buffer, {
    company: req.company,
    isIndia: await isIndiaCompany(req),
    dryRun: req.query.dryRun !== 'false',
    userId: req.user?.id || null,
  });
  if (result.imported) {
    await markSetup('products');
    audit(req, {
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'Product',
      entityLabel: 'Bulk import',
      description: `Imported ${result.imported} products from ${req.file.originalname || 'a file'}`,
    });
  }
  let message = `All ${result.valid} rows are valid`;
  if (result.imported) message = `${result.imported} products imported`;
  else if (result.errors.length) message = `${result.errors.length} problem(s) found, nothing was imported`;
  return success(res, { message, data: result });
});

export default crud;
