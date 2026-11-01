import mongoose from 'mongoose';
import { success, created, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { toPlain, loadDoc } from './_helpers.js';

/** True for plain JSON objects (not arrays, dates or ObjectIds). */
const isPlainObject = (value) =>
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !(value instanceof mongoose.Types.ObjectId) &&
  !value._bsontype;

/**
 * Shared CRUD controller factory for Phase 3 master data.
 *
 * Each module supplies its model, search/filter/sort whitelists, populate list
 * and optional hooks. Tenant scoping, soft delete, audit + response shape stay
 * consistent across every module.
 */
export const buildCrudController = (config) => {
  const {
    Model,
    entityType,
    labelField = 'name',
    searchFields = [],
    filtersSpec = {},
    sortAllowed = [],
    defaultSort = '-createdAt',
    populate = [],
    listFilter = () => ({}),
    detailFilter = () => ({}),
    beforeCreate,
    beforeUpdate,
    beforeDelete,
    afterCreate,
    afterUpdate,
    serialize = (doc) => toPlain(doc),
    label = entityType,
  } = config;

  const labelOf = (doc) => (doc ? String(doc[labelField] ?? doc.code ?? doc._id) : '');

  /** Re-read a saved doc with its configured refs populated for the response. */
  const hydrate = async (doc) => {
    if (!populate.length) return doc;
    try {
      return await loadDoc(Model, doc._id, { populate, label });
    } catch {
      return doc;
    }
  };

  const list = asyncHandler(async (req, res) => {
    const result = await listDocuments(Model, {
      filter: listFilter(req),
      query: req.query,
      searchFields,
      filtersSpec,
      sortAllowed,
      defaultSort,
      populate,
    });

    return paginated(res, {
      data: result.data.map((d) => serialize(d, req)),
      ...result.meta,
    });
  });

  const get = asyncHandler(async (req, res) => {
    const doc = await loadDoc(Model, req.params.id, { populate, filter: detailFilter(req), label });
    return success(res, { data: serialize(doc, req) });
  });

  const create = asyncHandler(async (req, res) => {
    let payload = { ...req.body };
    if (beforeCreate) payload = (await beforeCreate(payload, req)) || payload;

    const doc = await Model.create(payload);

    audit(req, {
      action: AUDIT_ACTIONS.CREATE,
      entityType,
      entityId: doc._id,
      entityLabel: labelOf(doc),
      after: toPlain(doc),
      description: `${entityType} "${labelOf(doc)}" created`,
    });

    if (afterCreate) await afterCreate(doc, req);
    const full = await hydrate(doc);
    return created(res, { message: `${entityType} created`, data: serialize(full, req) });
  });

  const update = asyncHandler(async (req, res) => {
    let payload = { ...req.body };
    if (beforeUpdate) payload = (await beforeUpdate(payload, req)) || payload;

    const doc = await loadDoc(Model, req.params.id, { filter: detailFilter(req), label });
    const before = toPlain(doc);

    // Apply only the fields the client actually sent. Nested objects
    // (address / shippingAddress / bank) merge so a partial update never
    // wipes sibling fields the form did not include.
    Object.entries(payload).forEach(([key, value]) => {
      if (value === undefined) return;
      if (isPlainObject(value)) {
        const current = doc.get(key);
        const currentPlain =
          typeof current?.toObject === 'function' ? current.toObject() : current || {};
        doc.set(key, { ...currentPlain, ...value });
        return;
      }
      doc.set(key, value);
    });
    await doc.save();

    const after = toPlain(doc);
    audit(req, {
      action: AUDIT_ACTIONS.UPDATE,
      entityType,
      entityId: doc._id,
      entityLabel: labelOf(doc),
      before,
      after,
      changes: diff(before, after),
      description: `${entityType} "${labelOf(doc)}" updated`,
    });

    if (afterUpdate) await afterUpdate(doc, req);
    const full = await hydrate(doc);
    return success(res, { message: `${entityType} updated`, data: serialize(full, req) });
  });

  const remove = asyncHandler(async (req, res) => {
    const doc = await loadDoc(Model, req.params.id, { filter: detailFilter(req), label });
    if (beforeDelete) await beforeDelete(doc, req);
    const snapshot = toPlain(doc);

    await doc.softDelete();

    audit(req, {
      action: AUDIT_ACTIONS.DELETE,
      entityType,
      entityId: doc._id,
      entityLabel: labelOf(doc),
      before: snapshot,
      description: `${entityType} "${labelOf(doc)}" deleted`,
    });

    return success(res, { message: `${entityType} deleted`, data: { id: String(doc._id) } });
  });

  return { list, get, create, update, remove };
};

/** Shallow diff used for audit change capture. */
export const diff = (before, after) => {
  if (!before || !after) return null;
  const changes = {};
  for (const key of Object.keys(after)) {
    if (['updatedAt', 'updatedBy', 'id', '_id'].includes(key)) continue;
    const a = JSON.stringify(before[key]);
    const b = JSON.stringify(after[key]);
    if (a !== b) changes[key] = { from: before[key], to: after[key] };
  }
  return Object.keys(changes).length ? changes : null;
};

export default buildCrudController;
