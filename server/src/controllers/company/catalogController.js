import Unit from '../../models/Unit.js';
import ProductCategory from '../../models/ProductCategory.js';
import Product from '../../models/Product.js';
import { success, created } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';
import { escapeRegex } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { ensureCatalog } from '../../services/catalogService.js';

/**
 * Catalogue masters: units of measure and the
 * Classification -> Category -> Sub-category tree.
 */

const ci = (v) => new RegExp(`^${escapeRegex(String(v).trim())}$`, 'i');
const PARENT_LEVEL = { CATEGORY: 'CLASSIFICATION', SUBCATEGORY: 'CATEGORY' };
const NAME_FIELD = { CLASSIFICATION: 'classification', CATEGORY: 'category', SUBCATEGORY: 'subCategory' };
const ID_FIELD = { CLASSIFICATION: 'classificationId', CATEGORY: 'categoryId', SUBCATEGORY: 'subCategoryId' };

const unitOut = (u, used = 0) => ({
  id: String(u._id),
  code: u.code,
  name: u.name,
  allowDecimals: Boolean(u.allowDecimals),
  isActive: u.isActive !== false,
  productCount: used,
});

const unitUsage = (code) => Product.countDocuments({ $or: [{ unit: code }, { 'packUnits.unit': code }] });

// ---- units ---------------------------------------------------------------------

export const listUnits = asyncHandler(async (req, res) => {
  await ensureCatalog();
  const units = await Unit.find({}).sort({ code: 1 }).lean();
  const counts = await Promise.all(units.map((u) => unitUsage(u.code)));
  return success(res, { data: units.map((u, i) => unitOut(u, counts[i])) });
});

export const createUnit = asyncHandler(async (req, res) => {
  const code = req.body.code.trim().toUpperCase();
  if (await Unit.exists({ code })) throw new ConflictError(`Unit ${code} already exists`, 'DUPLICATE');
  const doc = await Unit.create({ code, name: req.body.name, allowDecimals: Boolean(req.body.allowDecimals) });
  audit(req, { action: AUDIT_ACTIONS.CREATE, entityType: 'Unit', entityId: doc._id, entityLabel: code, description: `Unit ${code} added` });
  return created(res, { message: 'Unit added', data: unitOut(doc) });
});

export const updateUnit = asyncHandler(async (req, res) => {
  const doc = await Unit.findById(req.params.id);
  if (!doc) throw new NotFoundError('Unit not found');
  const used = await unitUsage(doc.code);
  // Switching a used unit to whole numbers could strand fractional stock.
  if (req.body.allowDecimals === false && doc.allowDecimals && used) {
    throw new BadRequestError(`${doc.code} is used by ${used} product(s); it must keep allowing decimals`, 'UNIT_IN_USE');
  }
  ['name', 'allowDecimals', 'isActive'].forEach((k) => {
    if (req.body[k] !== undefined) doc[k] = req.body[k];
  });
  await doc.save();
  return success(res, { message: 'Unit updated', data: unitOut(doc, used) });
});

export const removeUnit = asyncHandler(async (req, res) => {
  const doc = await Unit.findById(req.params.id);
  if (!doc) throw new NotFoundError('Unit not found');
  const used = await unitUsage(doc.code);
  if (used) throw new BadRequestError(`${doc.code} is used by ${used} product(s). Make it inactive instead.`, 'UNIT_IN_USE');
  await doc.softDelete();
  return success(res, { message: 'Unit deleted' });
});

// ---- categories ------------------------------------------------------------------

const nodeOut = (n, products = 0) => ({
  id: String(n._id),
  level: n.level,
  name: n.name,
  parent: n.parent ? String(n.parent) : null,
  isActive: n.isActive !== false,
  productCount: products,
});

/** GET /product-categories - every node (flat; the client builds the tree). */
export const listCategories = asyncHandler(async (req, res) => {
  await ensureCatalog();
  const nodes = await ProductCategory.find({}).sort({ name: 1 }).lean();
  const counts = await Product.aggregate([
    { $match: { companyId: req.company._id, isDeleted: { $ne: true } } },
    {
      $facet: {
        classificationId: [{ $group: { _id: '$classificationId', n: { $sum: 1 } } }],
        categoryId: [{ $group: { _id: '$categoryId', n: { $sum: 1 } } }],
        subCategoryId: [{ $group: { _id: '$subCategoryId', n: { $sum: 1 } } }],
      },
    },
  ]);
  const count = {};
  Object.values(counts[0] || {}).forEach((rows) =>
    rows.forEach((r) => {
      if (r._id) count[String(r._id)] = r.n;
    })
  );
  return success(res, { data: nodes.map((n) => nodeOut(n, count[String(n._id)] || 0)) });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { level, name } = req.body;
  let parent = null;
  if (PARENT_LEVEL[level]) {
    parent = await ProductCategory.findOne({ _id: req.body.parent, level: PARENT_LEVEL[level] }).lean();
    if (!parent) throw new BadRequestError(`Choose the ${PARENT_LEVEL[level].toLowerCase()} it belongs to`, 'INVALID_REFERENCE');
  }
  if (await ProductCategory.exists({ level, parent: parent?._id || null, name: ci(name) })) {
    throw new ConflictError(`"${name}" already exists here`, 'DUPLICATE');
  }
  const doc = await ProductCategory.create({ level, name: name.trim(), parent: parent?._id || null });
  audit(req, { action: AUDIT_ACTIONS.CREATE, entityType: 'ProductCategory', entityId: doc._id, entityLabel: doc.name, description: `${level.toLowerCase()} "${doc.name}" added` });
  return created(res, { message: 'Saved', data: nodeOut(doc) });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const doc = await ProductCategory.findById(req.params.id);
  if (!doc) throw new NotFoundError('Not found');
  if (req.body.name !== undefined && req.body.name.trim() !== doc.name) {
    if (await ProductCategory.exists({ _id: { $ne: doc._id }, level: doc.level, parent: doc.parent, name: ci(req.body.name) })) {
      throw new ConflictError(`"${req.body.name}" already exists here`, 'DUPLICATE');
    }
    doc.name = req.body.name.trim();
    // Products keep the name next to the id: rename them too.
    await Product.updateMany({ [ID_FIELD[doc.level]]: doc._id }, { $set: { [NAME_FIELD[doc.level]]: doc.name } });
  }
  if (req.body.isActive !== undefined) doc.isActive = req.body.isActive;
  await doc.save();
  return success(res, { message: 'Saved', data: nodeOut(doc) });
});

export const removeCategory = asyncHandler(async (req, res) => {
  const doc = await ProductCategory.findById(req.params.id);
  if (!doc) throw new NotFoundError('Not found');
  if (await ProductCategory.exists({ parent: doc._id })) {
    throw new BadRequestError(`Remove what is under "${doc.name}" first`, 'HAS_CHILDREN');
  }
  const used = await Product.countDocuments({ [ID_FIELD[doc.level]]: doc._id });
  if (used) throw new BadRequestError(`${used} product(s) use "${doc.name}". Make it inactive instead.`, 'IN_USE');
  await doc.softDelete();
  return success(res, { message: 'Deleted' });
});

export default { listUnits, createUnit, updateUnit, removeUnit, listCategories, createCategory, updateCategory, removeCategory };
