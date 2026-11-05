import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import env from '../config/env.js';
import tenantPlugin from './plugins/tenantPlugin.js';
import { COMPANY_ROLES, COMPANY_ROLE_LIST, SALES_TYPES } from '../config/constants.js';

/**
 * User - a member of a company (tenant). Scoped by companyId via tenantPlugin.
 */
const userSchema = new mongoose.Schema(
  {
    // companyId added by tenantPlugin (indexed, required)

    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 120 },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: '',
      // Unique per tenant, handled by compound index below.
    },

    phone: { type: String, trim: true, default: '' },

    // Allows login with email OR phone (plus optional company code).
    loginId: { type: String, lowercase: true, trim: true, default: '', index: true },

    password: { type: String, required: true, minlength: 6, select: false },

    role: { type: String, enum: COMPANY_ROLE_LIST, default: COMPANY_ROLES.SALESMAN, index: true },
    title: { type: String, default: '' },
    /** Field salesmen: PRESALE (orders), VAN_SALE (spot invoices + van) or BOTH. */
    salesType: { type: String, enum: SALES_TYPES, default: 'BOTH' },

    // Custom per-role permission overrides (COMPANY_ADMIN may edit).
    permissionsOverride: { type: Object, default: null },

    reportingManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    teamMembers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },

    territory: { type: String, default: '', index: true },
    routes: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Route' }], default: [] },
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },

    employeeCode: { type: String, default: '', trim: true },
    designation: { type: String, default: '' },

    avatar: { type: String, default: '' },
    gps: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
      updatedAt: { type: Date, default: null },
    },

    isActive: { type: Boolean, default: true, index: true },
    mustChangePassword: { type: Boolean, default: false },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    lastSeenAt: { type: Date, default: null },

    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    passwordChangedAt: { type: Date, default: null },
    passwordResetToken: { type: String, select: false, default: null },
    passwordResetExpires: { type: Date, select: false, default: null },

    refreshTokens: {
      type: [{ jti: String, issuedAt: Date, expiresAt: Date, userAgent: String, ip: String }],
      default: [],
      select: false,
    },

    // Settings/preferences
    preferences: {
      type: {
        theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
        language: { type: String, default: 'en' },
        notifications: { type: Boolean, default: true },
      },
      default: () => ({}),
    },

    // Impersonation bookkeeping (set when platform logs in as this admin)
    impersonatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_d, ret) => {
        delete ret.password;
        delete ret.refreshTokens;
        delete ret.passwordResetToken;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// One email and one phone per tenant.
userSchema.index({ companyId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $exists: true, $type: 'string', $gt: '' } } });
userSchema.index({ companyId: 1, phone: 1 }, { unique: true, partialFilterExpression: { phone: { $exists: true, $type: 'string', $gt: '' } } });
userSchema.index({ companyId: 1, loginId: 1, isActive: 1 });
userSchema.index({ companyId: 1, role: 1, isActive: 1 });
userSchema.index({ companyId: 1, reportingManager: 1 });

userSchema.plugin(tenantPlugin);

userSchema.pre('validate', function (next) {
  if (this.email || this.phone) {
    this.loginId = (this.email || this.phone).toLowerCase();
  }
  next();
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, env.bcryptRounds);
  if (!this.isNew) this.passwordChangedAt = new Date();
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isLocked = function () {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
};

userSchema.methods.incrementFailedLogin = async function () {
  this.failedLoginAttempts += 1;
  const MAX = 5;
  if (this.failedLoginAttempts >= MAX) {
    this.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
  }
  await this.save({ validateBeforeSave: false });
};

userSchema.methods.clearFailedLogin = async function () {
  if (this.failedLoginAttempts > 0 || this.lockedUntil) {
    this.failedLoginAttempts = 0;
    this.lockedUntil = null;
    await this.save({ validateBeforeSave: false });
  }
};

userSchema.methods.isPasswordChangedAfter = function (iat) {
  if (!this.passwordChangedAt) return false;
  const changed = Math.floor(this.passwordChangedAt.getTime() / 1000);
  return changed > iat;
};

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default User;
