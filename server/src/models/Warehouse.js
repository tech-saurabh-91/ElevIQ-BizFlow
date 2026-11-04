import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { addressSchema } from './common.js';

/**
 * Warehouse types (Phase A - hierarchy + van tracking):
 *  - MAIN    : company root warehouse. Parentless, may be the default.
 *  - SUB     : child of a MAIN (a branch/counter). Never a parent itself,
 *              keeping the hierarchy a flat MAIN -> {SUB|VAN|...} star.
 *  - VAN     : mobile stock on wheels. Child of MAIN or SUB; never a parent.
 *  - TRANSIT : stock physically between locations.
 *  - DAMAGED : quarantined / write-off holding location.
 *
 * BRANCH was folded into SUB (old tenants are migrated by
 * scripts/migrate-warehouse-hierarchy.js).
 */
export const WAREHOUSE_TYPES = Object.freeze(['MAIN', 'SUB', 'VAN', 'TRANSIT', 'DAMAGED']);

/** Types that must sit under a MAIN warehouse. */
export const CHILD_TYPES = Object.freeze(['SUB', 'TRANSIT', 'DAMAGED']);

/** Types that may sit under a MAIN *or* a SUB warehouse. */
export const VAN_LIKE_TYPES = Object.freeze(['VAN']);

/** True when `type` can hold children (only MAIN does, up to 3 levels). */
export const canHaveChildren = (type) => type === 'MAIN';

/**
 * Warehouse / stock location. Every tenant starts with one MAIN warehouse.
 *
 * Hierarchy: MAIN (parentless) -> SUB / TRANSIT / DAMAGED, and
 * MAIN|SUB -> VAN. The `parent` field drives both the pickers in the UI and
 * the roll-up reports (a MAIN reports its own stock plus its children's).
 */
const warehouseSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Warehouse name is required'], trim: true, maxlength: 120 },
    code: { type: String, required: [true, 'Warehouse code is required'], trim: true, uppercase: true, maxlength: 20 },
    type: { type: String, enum: WAREHOUSE_TYPES, default: 'MAIN', index: true },

    /** Parent warehouse (null for MAIN). Enforced by the controller guards. */
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null, index: true },

    /** Van-only fields (ignored for the other types). */
    vehicleNumber: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 20,
      default: '',
      // Registration plates are stored tight: no spaces, always upper-case.
      set: (v) => (v == null ? '' : String(v).replace(/\s+/g, '').toUpperCase()),
    },
    vehicleType: { type: String, trim: true, default: '', maxlength: 40 },

    /** Optional warehouse photo / logo (uploaded via the uploads endpoint). */
    image: { type: String, default: '', maxlength: 500 },

    address: { type: addressSchema, default: () => ({}) },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },

    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    capacity: { type: Number, default: 0, min: 0 },
    isDefault: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

warehouseSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
warehouseSchema.index({ companyId: 1, name: 1 });

// One live vehicle registration per company (blank vehicle numbers are exempt).
warehouseSchema.index(
  { companyId: 1, vehicleNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false, vehicleNumber: { $type: 'string', $gt: '' } },
  }
);
warehouseSchema.index({ companyId: 1, parent: 1 });

warehouseSchema.plugin(tenantPlugin);

const Warehouse = mongoose.models.Warehouse || mongoose.model('Warehouse', warehouseSchema);
export default Warehouse;
