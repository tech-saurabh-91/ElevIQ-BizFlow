import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import env from '../config/env.js';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * CustomerAccount - a customer's (shop's) login to the customer portal.
 *
 * Kept apart from staff `User`s on purpose: a portal login has no role, no
 * permissions and sees only its own customer's records. It signs in on its
 * company's link (/portal/<CODE>) with mobile + PIN.
 *
 * Phase 1: one login per customer, one customer per mobile in a company.
 */
export const PIN_PATTERN = /^\d{4,6}$/;
export const MAX_FAILED_PINS = 5;
export const PIN_LOCK_MINUTES = 15;

const customerAccountSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    mobile: { type: String, required: true, trim: true },
    pin: { type: String, required: true, select: false },

    isActive: { type: Boolean, default: true },
    // Set when staff create or reset the PIN: the customer picks their own.
    mustChangePin: { type: Boolean, default: true },
    pinChangedAt: { type: Date, default: null },

    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },

    // One-time sign-in code (hashed), when the company allows OTP login.
    otpHash: { type: String, default: null, select: false },
    otpExpiresAt: { type: Date, default: null },
    otpSentAt: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

customerAccountSchema.plugin(tenantPlugin);

customerAccountSchema.index(
  { companyId: 1, customer: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
customerAccountSchema.index(
  { companyId: 1, mobile: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

customerAccountSchema.pre('save', async function (next) {
  if (!this.isModified('pin')) return next();
  this.pin = await bcrypt.hash(this.pin, env.bcryptRounds);
  this.pinChangedAt = new Date();
  next();
});

/** Digits only, so "+91 98765-43210" and "9876543210" match the same login. */
export const normalizeMobile = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  // Keep the last 10 digits for Indian numbers written with 91 / 0 in front.
  return digits.length > 10 && (digits.startsWith('91') || digits.startsWith('0')) ? digits.slice(-10) : digits;
};

const CustomerAccount =
  mongoose.models.CustomerAccount || mongoose.model('CustomerAccount', customerAccountSchema);
export default CustomerAccount;
