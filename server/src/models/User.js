import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import env from '../config/env.js';
import tenantPlugin from './plugins/tenantPlugin.js';
import Counter from './Counter.js';
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

    // Old, never-used field (kept so existing documents still load).
    permissionsOverride: { type: Object, default: null },

    /**
     * This user's own access, over their role (Users -> Access; only a company
     * admin may change it). DENY takes a permission away, ALLOW gives one the
     * role does not have; `until` ends a temporary grant on that date.
     */
    accessOverrides: {
      type: [
        new mongoose.Schema(
          {
            permission: { type: String, required: true, trim: true },
            effect: { type: String, enum: ['ALLOW', 'DENY'], required: true },
            until: { type: Date, default: null },
            note: { type: String, trim: true, maxlength: 200, default: '' },
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
            byName: { type: String, default: '' },
            at: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    /** A shared set of access (Users -> Access profiles); the user's own Allow / Deny win over it. */
    accessProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'AccessProfile', default: null },

    /**
     * Whose records this user sees: OWN (their own), TEAM (theirs and the
     * people who report to them), ALL (the whole company). '' = by role:
     * salesman OWN, manager TEAM, everyone else ALL.
     */
    dataScope: { type: String, enum: ['', 'OWN', 'TEAM', 'ALL'], default: '' },

    /** Ceilings for this user (null = no ceiling). Company admins have none. */
    limits: {
      /** Discount (or price cut below the price list) a user may type by hand, in %. */
      maxDiscountPercent: { type: Number, default: null, min: 0, max: 100 },
      /** Largest order / expense this user may approve. */
      maxApproveAmount: { type: Number, default: null, min: 0 },
    },

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

// Employee code is issued by the system, never typed: EMP-0001, EMP-0002 ...
// per company. A user saved without one (new, or created before codes were
// automatic) gets the next free code; codes already in use are skipped.
userSchema.pre('save', async function (next) {
  if (this.employeeCode || !this.companyId) return next();
  try {
    const key = `${this.companyId}:EMPLOYEE`;
    for (;;) {
      const seq = await Counter.next(key);
      const code = `EMP-${String(seq).padStart(4, '0')}`;
      const taken = await this.constructor
        .exists({ companyId: this.companyId, employeeCode: code, _id: { $ne: this._id } })
        .skipTenant();
      if (!taken) {
        this.employeeCode = code;
        break;
      }
    }
    return next();
  } catch (err) {
    return next(err);
  }
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
