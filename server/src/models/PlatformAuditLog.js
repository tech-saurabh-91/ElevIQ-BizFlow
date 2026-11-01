import mongoose from 'mongoose';
import { AUDIT_ACTIONS } from '../config/constants.js';

/**
 * PlatformAuditLog - platform (service provider) level audit trail.
 * Non-tenant. Records platform admin actions, impersonation, company changes.
 */
const platformAuditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
        name: { type: String, default: '' },
        email: { type: String, default: '' },
        role: { type: String, default: '' },
      },
      default: () => ({}),
    },

    action: { type: String, enum: Object.values(AUDIT_ACTIONS), required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    entityLabel: { type: String, default: '' },

    targetCompanyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null, index: true },

    description: { type: String, default: '' },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },

    meta: {
      type: {
        ip: { type: String, default: '' },
        userAgent: { type: String, default: '' },
        requestId: { type: String, default: '' },
        method: { type: String, default: '' },
        path: { type: String, default: '' },
      },
      default: () => ({}),
    },

    channel: { type: String, enum: ['WEB', 'API', 'SYSTEM', 'CRON'], default: 'WEB' },
    severity: { type: String, enum: ['INFO', 'WARN', 'ERROR'], default: 'INFO' },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

platformAuditLogSchema.index({ occurredAt: -1 });
platformAuditLogSchema.index({ action: 1, occurredAt: -1 });
platformAuditLogSchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });

const PlatformAuditLog =
  mongoose.models.PlatformAuditLog || mongoose.model('PlatformAuditLog', platformAuditLogSchema);
export default PlatformAuditLog;
