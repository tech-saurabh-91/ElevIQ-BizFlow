import mongoose from 'mongoose';
import { COMPANY_STATUS, COMPANY_STATUS_LIST, BUSINESS_TYPES } from '../config/constants.js';

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, default: '' },
    line2: { type: String, default: '' },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    country: { type: String, default: 'India', trim: true },
    pincode: { type: String, default: '', trim: true },
    gstin: { type: String, default: '', trim: true, uppercase: true },
    gps: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
  },
  { _id: false }
);

/**
 * Company = tenant root document. It does NOT carry a companyId itself;
 * every other tenant document references this _id as companyId.
 */
const companySchema = new mongoose.Schema(
  {
    // Unique human-facing identifiers
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },

    businessName: { type: String, required: true, trim: true, maxlength: 160 },
    legalName: { type: String, trim: true, default: '', maxlength: 200 },

    businessType: { type: String, enum: BUSINESS_TYPES, default: 'BOTH' },

    // Tax / identity
    gstin: { type: String, trim: true, uppercase: true, default: '', index: true },
    pan: { type: String, trim: true, uppercase: true, default: '' },
    taxId: { type: String, trim: true, default: '' },

    // Contact
    email: { type: String, trim: true, lowercase: true, default: '', index: true },
    phone: { type: String, trim: true, default: '' },
    website: { type: String, trim: true, default: '' },

    address: { type: addressSchema, default: () => ({}) },

    logo: { type: String, default: '' },

    // Localization
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR', maxlength: 8 },
    currencySymbol: { type: String, default: '₹', maxlength: 4 },
    financialYearStartMonth: { type: Number, default: 4, min: 1, max: 12 }, // 4 = April
    locale: { type: String, default: 'en-IN' },

    // Subscription / status
    status: { type: String, enum: COMPANY_STATUS_LIST, default: COMPANY_STATUS.TRIAL, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },
    statusReason: { type: String, default: '' },

    trialEndsAt: { type: Date, default: null },
    subscriptionStart: { type: Date, default: null },
    subscriptionEnd: { type: Date, default: null, index: true },
    graceDays: { type: Number, default: 3 },

    userLimit: { type: Number, default: 5 },
    featureFlags: {
      type: {
        gpsTracking: { type: Boolean, default: true },
        multiWarehouse: { type: Boolean, default: true },
        eInvoice: { type: Boolean, default: false },
        apiAccess: { type: Boolean, default: false },
        fieldForce: { type: Boolean, default: true },
        barcode: { type: Boolean, default: true },
        schemes: { type: Boolean, default: true },
        purchase: { type: Boolean, default: true },
      },
      default: () => ({}),
    },

    // Limits copied from plan at assign time (kept for fast checks)
    limits: {
      maxUsers: { type: Number, default: 5 },
      maxCustomers: { type: Number, default: 500 },
      maxInvoicesPerMonth: { type: Number, default: 500 },
    },

    // First COMPANY_ADMIN reference
    adminUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Platform bookkeeping
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
    lastActivityAt: { type: Date, default: null },
    suspendedAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_d, ret) => {
        delete ret.__v;
        delete ret.isDeleted;
        return ret;
      },
    },
  }
);

companySchema.index({ status: 1, subscriptionEnd: 1 });
companySchema.index({ createdAt: -1 });

/** Company is live (users may log in) when TRIAL or ACTIVE. */
companySchema.methods.isLive = function () {
  return [COMPANY_STATUS.TRIAL, COMPANY_STATUS.ACTIVE].includes(this.status);
};

/** Effective expiry: subscription end, or trial end, whichever applies. */
companySchema.methods.isExpired = function () {
  const now = new Date();
  if (this.status === COMPANY_STATUS.EXPIRED) return true;
  const end = this.subscriptionEnd || this.trialEndsAt;
  if (end && end < now && this.status !== COMPANY_STATUS.SUSPENDED) {
    return true;
  }
  return false;
};

companySchema.methods.isSuspended = function () {
  return this.status === COMPANY_STATUS.SUSPENDED;
};

const Company = mongoose.models.Company || mongoose.model('Company', companySchema);

export default Company;
