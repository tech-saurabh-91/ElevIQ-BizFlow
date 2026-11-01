import mongoose from 'mongoose';

/**
 * Query-level helpers available on EVERY model (including non-tenant platform
 * models like Company / Plan / Subscription).
 *
 *   Model.find().skipTenant()      -> ignore the ALS tenant scope entirely
 *   Model.deleteOne().hardDelete() -> irreversible purge (tenant models block
 *                                     soft-delete-bypassing deletes by default)
 *
 * Registering these once on the Query prototype means callers never have to
 * care whether a particular model uses the tenant plugin.
 */
const proto = mongoose.Query.prototype;

if (!proto.skipTenant) {
  proto.skipTenant = function skipTenant() {
    this._skipTenant = true;
    this._allowMissingTenant = true;
    return this;
  };
}

if (!proto.hardDelete) {
  proto.hardDelete = function hardDelete() {
    this._hardDelete = true;
    this._skipTenant = true;
    this._allowMissingTenant = true;
    return this;
  };
}

/** Opt back into including soft-deleted documents. */
if (!proto.withDeleted) {
  proto.withDeleted = function withDeleted() {
    this._mongooseOptions.includeSoftDeleted = true;
    return this;
  };
}

export default proto;
