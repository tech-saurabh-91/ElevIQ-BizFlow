import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { addressSchema } from './common.js';

export const WAREHOUSE_TYPES = Object.freeze(['MAIN', 'BRANCH', 'TRANSIT', 'DAMAGED']);

/**
 * Warehouse / stock location. Every tenant starts with one MAIN warehouse.
 */
const warehouseSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Warehouse name is required'], trim: true, maxlength: 120 },
    code: { type: String, required: [true, 'Warehouse code is required'], trim: true, uppercase: true, maxlength: 20 },
    type: { type: String, enum: WAREHOUSE_TYPES, default: 'MAIN', index: true },

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

warehouseSchema.plugin(tenantPlugin);

const Warehouse = mongoose.models.Warehouse || mongoose.model('Warehouse', warehouseSchema);
export default Warehouse;
