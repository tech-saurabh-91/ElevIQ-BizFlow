import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { addressSchema, geoPointSchema } from './common.js';
import { CUSTOMER_TYPES, PAYMENT_TERMS } from '../config/constants.js';

/**
 * Customer master (outlet / distributor / dealer).
 * `outstanding` is a running balance maintained by invoices/payments in later
 * phases; Phase 3 only stores/edits opening balances.
 */
const customerSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, uppercase: true, maxlength: 24, default: '' },
    name: { type: String, required: [true, 'Customer name is required'], trim: true, maxlength: 160 },
    type: { type: String, enum: CUSTOMER_TYPES, default: 'RETAIL', index: true },

    contactPerson: { type: String, default: '', trim: true, maxlength: 120 },
    phone: { type: String, default: '', trim: true },
    alternatePhone: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },

    gstin: { type: String, default: '', trim: true, uppercase: true },
    pan: { type: String, default: '', trim: true, uppercase: true },
    taxId: { type: String, default: '', trim: true },

    address: { type: addressSchema, default: () => ({}) },
    shippingAddress: { type: addressSchema, default: () => ({}) },
    gps: { type: geoPointSchema, default: () => ({}) },

    // Credit control
    creditLimit: money(),
    creditDays: { type: Number, default: 0, min: 0, max: 365 },
    paymentTerms: { type: String, enum: PAYMENT_TERMS, default: 'IMMEDIATE' },
    openingBalance: money(),
    outstanding: money(),

    // Relationships (all tenant-scoped)
    priceList: { type: mongoose.Schema.Types.ObjectId, ref: 'PriceList', default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: null, index: true },
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    territory: { type: String, default: '', trim: true, index: true },

    tags: { type: [String], default: [] },
    notes: { type: String, default: '', maxlength: 1000 },

    isActive: { type: Boolean, default: true, index: true },
    lastOrderAt: { type: Date, default: null },
    totalOrders: { type: Number, default: 0, min: 0 },
    totalSales: money(),
  },
  { timestamps: true }
);

customerSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
customerSchema.index({ companyId: 1, name: 1 });
customerSchema.index({ companyId: 1, phone: 1 });
customerSchema.index({ companyId: 1, type: 1, isActive: 1 });
customerSchema.index({ companyId: 1, territory: 1 });

customerSchema.plugin(tenantPlugin);

const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);
export default Customer;
