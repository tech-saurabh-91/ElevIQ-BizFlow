import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * Session - one row per issued refresh token so users can list & revoke sessions.
 * (Complements the denormalised list on the user doc.)
 */
const sessionSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    platformUser: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null, index: true },

    scope: { type: String, enum: ['company', 'platform'], default: 'company', index: true },

    jti: { type: String, required: true, unique: true, index: true },
    refreshTokenHash: { type: String, required: true, select: false },

    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },

    issuedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }, // TTL index declared below
    lastUsedAt: { type: Date, default: Date.now },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: '' },
    isCurrent: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Sessions are NOT tenant-scoped automatically: platform must be able to list
// sessions for support. Company queries filter by companyId explicitly.
sessionSchema.index({ companyId: 1, user: 1, revokedAt: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup

const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);
export default Session;
