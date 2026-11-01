import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import env from '../config/env.js';
import { PLATFORM_ROLES } from '../config/constants.js';

/**
 * PlatformUser - a Service Provider (SaaS owner) account.
 * NOT a tenant model: no companyId. Platform routes use scope='platform'.
 */
const platformUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 120 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: { type: String, trim: true, default: null },
    password: { type: String, required: true, minlength: 8, select: false },

    role: { type: String, enum: Object.values(PLATFORM_ROLES), default: PLATFORM_ROLES.SUPER_ADMIN },
    permissions: { type: [String], default: [] },

    isActive: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },

    // 2FA (optional)
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false, default: null },

    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    // Refresh-token rotation: keep active hashed refresh tokens (JTI list).
    refreshTokens: {
      type: [{ jti: String, issuedAt: Date, expiresAt: Date, userAgent: String, ip: String }],
      default: [],
      select: false,
    },
    passwordChangedAt: { type: Date, default: null },
    passwordResetToken: { type: String, select: false, default: null },
    passwordResetExpires: { type: Date, select: false, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_d, ret) => {
        delete ret.password;
        delete ret.refreshTokens;
        delete ret.twoFactorSecret;
        delete ret.passwordResetToken;
        delete ret.__v;
        return ret;
      },
    },
  }
);

platformUserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, env.bcryptRounds);
  if (!this.isNew) this.passwordChangedAt = new Date();
  next();
});

platformUserSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

platformUserSchema.methods.isLocked = function () {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
};

platformUserSchema.methods.incrementFailedLogin = async function () {
  this.failedLoginAttempts += 1;
  const MAX = 5;
  if (this.failedLoginAttempts >= MAX) {
    this.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lockout
  }
  await this.save({ validateBeforeSave: false });
};

platformUserSchema.methods.clearFailedLogin = async function () {
  if (this.failedLoginAttempts > 0 || this.lockedUntil) {
    this.failedLoginAttempts = 0;
    this.lockedUntil = null;
    await this.save({ validateBeforeSave: false });
  }
};

const PlatformUser = mongoose.models.PlatformUser || mongoose.model('PlatformUser', platformUserSchema);

export default PlatformUser;
