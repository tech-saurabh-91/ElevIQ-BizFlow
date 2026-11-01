import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { addressSchema, bankDetailsSchema } from './common.js';
import { PAYMENT_TERMS } from '../config/constants.js';

/**
 * Supplier / vendor master (purchases arrive in a later phase).
 */
const supplierSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, uppercase: true, maxlength: 24, default: '' },
    name: { type: String, required: [true, 'Supplier name is required'], trim: true, maxlength: 160 },
    contactPerson: { type: String, default: '', trim: true, maxlength: 120 },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    website: { type: String, default: '', trim: true },

    gstin: { type: String, default: '', trim: true, uppercase: true },
    pan: { type: String, default: '', trim: true, uppercase: true },

    address: { type: addressSchema, default: () => ({}) },
    bank: { type: bankDetailsSchema, default: () => ({}) },

    paymentTerms: { type: String, enum: PAYMENT_TERMS, default: 'IMMEDIATE' },
    creditDays: { type: Number, default: 0, min: 0, max: 365 },
    openingBalance: money(),
    outstanding: money(),

    categories: { type: [String], default: [] },
    notes: { type: String, default: '', maxlength: 1000 },
    isActive: { type: Boolean, default: true, index: true },
    lastPurchaseAt: { type: Date, default: null },
  },
  { timestamps: true }
);

supplierSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
supplierSchema.index({ companyId: 1, name: 1 });
supplierSchema.index({ companyId: 1, phone: 1 });

supplierSchema.plugin(tenantPlugin);

const Supplier = mongoose.models.Supplier || mongoose.model('Supplier', supplierSchema);
export default Supplier;
