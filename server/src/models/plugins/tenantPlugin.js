import mongoose from 'mongoose';
import './queryHelpers.js'; // installs .skipTenant()/.hardDelete() on Query.prototype
import { getCompanyId, getUserId } from '../../middlewares/tenantContext.js';

/**
 * TACTICAL TENANT ISOLATION PLUGIN (shared collections, single DB).
 *
 * What it does:
 *  1. Adds `companyId` (indexed), `createdBy`, `updatedBy`, `isDeleted` to every
 *     tenant document, plus timestamps.
 *  2. Automatically injects `companyId` into find / update / delete queries from
 *     the AsyncLocalStorage request context, so a company can NEVER read or
 *     mutate another company's data even if a developer forgets a filter.
 *  3. Auto-fills `createdBy` on save and `updatedBy` on update.
 *  4. Enforces SOFT deletes on tenant models: raw deleteOne/deleteMany are
 *     blocked (throws HARD_DELETE_BLOCKED). Use:
 *        Model.softDeleteOne(filter) / Model.softDeleteMany(filter)
 *        doc.softDelete()
 *        Model.restore(filter)
 *        Model.deleteOne(filter).hardDelete()   // irreversible, platform only
 *
 * Escape hatches (platform / cross-tenant jobs must opt in explicitly):
 *    Model.find().setOptions({ skipTenant: true })
 *    Model.find().skipTenant()      (helper added below)
 *    Model.deleteOne(filter).hardDelete()
 */

const QUERY_METHODS = [
  'find',
  'findOne',
  'count',
  'countDocuments',
  'distinct',
  'update',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
  // NOTE: deleteOne / deleteMany / findOneAndDelete are intentionally NOT in
  // this list — they are governed by the hard-delete block below instead.
];

const wantsSkip = (query) =>
  Boolean(query?._skipTenant) || query?.getOptions?.()?.skipTenant === true;

export const tenantPlugin = function tenantPlugin(schema, options = {}) {
  const { companyField = 'companyId', requireCompany = true } = options;

  // ---- 1. fields ----------------------------------------------------------
  schema.add({
    [companyField]: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: requireCompany,
      // index is declared once (unique or plain) right after, to avoid
      // mongoose's "duplicate schema index" warning.
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  });

  // Single index declaration for the tenant key.
  if (options.uniqueCompany) {
    schema.index({ [companyField]: 1 }, { unique: true });
  } else {
    schema.index({ [companyField]: 1 });
  }

  // Is the tenant key already present in this filter? If so the developer has
  // made an explicit scoping decision and we honour it as-is.
  const hasExplicitCompany = (filter) =>
    Boolean(filter) && filter[companyField] !== undefined && filter[companyField] !== null;

  const missingScopeError = (model, op) => {
    const err = new Error(
      `Tenant scope missing for ${op} on "${model}". Either run it inside a request ` +
        `context, add an explicit { ${companyField} } filter, or call .skipTenant() ` +
        `for deliberate cross-tenant access.`
    );
    err.status = 500;
    err.code = 'TENANT_SCOPE_MISSING';
    return err;
  };

  // Default list query should hide soft-deleted docs.
  schema.pre(/^find/, function (next) {
    if (wantsSkip(this)) return next();
    if (this._mongooseOptions?.includeSoftDeleted) return next();

    const filter = this.getFilter() || {};
    const companyId = getCompanyId();

    if (!hasExplicitCompany(filter)) {
      if (companyId) {
        filter[companyField] = companyId;
        this.setQuery(filter);
      } else if (requireCompany && !this._allowMissingTenant) {
        // A tenant model queried with no context and no explicit company is a
        // programming error -> refuse rather than leak across tenants.
        return next(missingScopeError(this.model.modelName, 'query'));
      }
    }

    // Default soft-delete filter.
    if (!('isDeleted' in (this.getFilter() || {}))) {
      const f = this.getFilter() || {};
      f.isDeleted = { $ne: true };
      this.setQuery(f);
    }
    next();
  });

  // ---- update / delete hooks --------------------------------------------
  const scopeUpdate = function (next) {
    if (wantsSkip(this)) return next();

    const filter = this.getFilter() || {};
    const companyId = getCompanyId();

    if (!hasExplicitCompany(filter)) {
      if (companyId) {
        filter[companyField] = companyId;
        this.setQuery(filter);
      } else if (requireCompany && !this._allowMissingTenant) {
        // Writing without a tenant scope would hit every tenant's documents.
        return next(missingScopeError(this.model.modelName, `${this.op}`));
      }
    }

    // Stamp updatedBy when the caller is known.
    const userId = getUserId();
    if (userId) {
      const update = this.getUpdate() || {};
      if (!update.$set) update.$set = {};
      if (!update.$set.updatedBy && !('updatedBy' in update)) {
        update.$set.updatedBy = userId;
      }
      // Avoid clobbering an immutable _id.
      delete update._id;
      this.setUpdate(update);
    }
    next();
  };

  QUERY_METHODS.forEach((m) => schema.pre(m, scopeUpdate));

  // Counts do not match /^find/, so they need their own soft-delete filter.
  // Without it, `countDocuments()` keeps counting soft-deleted rows, which
  // inflates list pagination totals, dashboard stats and plan-limit checks.
  const scopeCount = function (next) {
    if (wantsSkip(this)) return next();
    if (this._mongooseOptions?.includeSoftDeleted) return next();

    const filter = this.getFilter() || {};
    const companyId = getCompanyId();

    if (!hasExplicitCompany(filter)) {
      if (companyId) {
        filter[companyField] = companyId;
      } else if (requireCompany && !this._allowMissingTenant) {
        return next(missingScopeError(this.model.modelName, this.op));
      }
    }

    if (!('isDeleted' in filter)) filter.isDeleted = { $ne: true };
    this.setQuery(filter);
    next();
  };
  schema.pre('count', scopeCount);
  schema.pre('countDocuments', scopeCount);

  // ---- soft-delete policy -------------------------------------------------
  // Hard deletes on tenant models are blocked by default: we keep an audit
  // trail, so deletions are soft (`isDeleted = true`). Callers must be explicit:
  //
  //   Model.softDeleteOne(filter)      -> soft delete one (tenant-scoped)
  //   Model.softDeleteMany(filter)     -> soft delete many (tenant-scoped)
  //   Model.deleteOne(filter).hardDelete()  -> irreversible purge (platform only)
  //   Model.restore(filter)            -> undo a soft delete
  //
  const blockHardDelete = function (next) {
    if (wantsSkip(this) || this._hardDelete) return next();
    const err = new Error(
      `Hard delete blocked on "${this.model.modelName}". ` +
        `Use Model.softDeleteOne()/softDeleteMany() for soft delete, ` +
        `or append .hardDelete() to purge permanently.`
    );
    err.status = 500;
    err.code = 'HARD_DELETE_BLOCKED';
    err.isOperational = false;
    return next(err);
  };
  schema.pre('deleteOne', { document: false, query: true }, blockHardDelete);
  schema.pre('deleteMany', { document: false, query: true }, blockHardDelete);
  schema.pre('findOneAndDelete', { document: false, query: true }, blockHardDelete);
  // (.hardDelete() opt-in helper is installed globally in queryHelpers.js)

  // ---- 3. stamp tenant/user before validation ----------------------------
  // Mongoose runs `validate` before `save`, so the tenant key must be present
  // here or `required: true` fails on Model.create()/new Model().save().
  schema.pre('validate', function (next) {
    if (!this[companyField]) {
      const companyId = getCompanyId();
      if (companyId) this[companyField] = companyId;
      else if (requireCompany) {
        return next(missingScopeError(this.constructor.modelName, 'save'));
      }
    }
    const userId = getUserId();
    if (userId) {
      if (!this.createdBy) this.createdBy = userId;
      this.updatedBy = userId;
    }
    next();
  });

  // ---- 3b. auto-fill createdBy/companyId on save (idempotent) ------------
  schema.pre('save', function (next) {
    const userId = getUserId();
    if (userId) {
      if (!this.createdBy) this.createdBy = userId;
      this.updatedBy = userId;
    }
    if (!this[companyField]) {
      const companyId = getCompanyId();
      if (companyId) this[companyField] = companyId;
      else if (requireCompany) {
        const err = new Error(
          `companyId is required for model "${this.constructor.modelName}"`
        );
        err.status = 500;
        err.code = 'TENANT_SCOPE_MISSING';
        return next(err);
      }
    }
    next();
  });

  // ---- 4. helpers ---------------------------------------------------------
  // .skipTenant() / .hardDelete() come from queryHelpers.js (global prototype).

  // ---- 4b. soft-delete statics (tenant-scoped, returns real counts) -------
  const buildSoftFilter = (filter = {}) => {
    const companyId = getCompanyId();
    const f = { ...filter, isDeleted: { $ne: true } };
    if (companyId && !f[companyField]) f[companyField] = companyId;
    return f;
  };

  const softSet = () => {
    const userId = getUserId();
    return { isDeleted: true, updatedAt: new Date(), ...(userId ? { updatedBy: userId } : {}) };
  };

  schema.statics.softDeleteOne = function softDeleteOne(filter = {}) {
    return this.updateOne(buildSoftFilter(filter), { $set: softSet() }).skipTenant();
  };

  schema.statics.softDeleteMany = function softDeleteMany(filter = {}) {
    return this.updateMany(buildSoftFilter(filter), { $set: softSet() }).skipTenant();
  };

  schema.statics.restore = function restore(filter = {}) {
    const companyId = getCompanyId();
    const f = { ...filter, isDeleted: true };
    if (companyId && !f[companyField]) f[companyField] = companyId;
    return this.updateMany(f, { $set: { isDeleted: false, updatedAt: new Date() } }).skipTenant();
  };

  // Instance-level soft delete (document middleware).
  schema.methods.softDelete = async function softDelete() {
    this.isDeleted = true;
    this.updatedBy = getUserId() || this.updatedBy;
    await this.save({ validateBeforeSave: false });
    return this;
  };

  // ---- 5. toJSON transform: strip internal flags --------------------------
  const baseTransform = schema.options?.toJSON?.transform;
  schema.set('toJSON', {
    virtuals: true,
    transform: (_doc, ret) => {
      delete ret.__v;
      // Keep isDeleted out of API payloads by default.
      delete ret.isDeleted;
      if (typeof baseTransform === 'function') return baseTransform(_doc, ret);
      return ret;
    },
  });
};

export default tenantPlugin;
