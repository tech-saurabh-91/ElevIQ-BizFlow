import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { AUDIT_ACTIONS } from '../config/constants.js';

/**
 * AuditLog - company-scoped audit trail: who did what, when, IP, before/after.
 */
const auditLogSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    actor: {
      type: {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        name: { type: String, default: '' },
        role: { type: String, default: '' },
        email: { type: String, default: '' },
      },
      default: () => ({}),
    },

    action: { type: String, enum: Object.values(AUDIT_ACTIONS), required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    entityLabel: { type: String, default: '' },

    description: { type: String, default: '' },

    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    changes: { type: mongoose.Schema.Types.Mixed, default: null },

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

    status: { type: String, default: '' },
    channel: { type: String, enum: ['WEB', 'API', 'SYSTEM', 'CRON'], default: 'WEB' },
    severity: { type: String, enum: ['INFO', 'WARN', 'ERROR'], default: 'INFO' },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

auditLogSchema.plugin(tenantPlugin);
auditLogSchema.index({ companyId: 1, occurredAt: -1 });
auditLogSchema.index({ companyId: 1, entityType: 1, occurredAt: -1 });
auditLogSchema.index({ companyId: 1, action: 1, occurredAt: -1 });
auditLogSchema.index({ companyId: 1, 'actor.userId': 1, occurredAt: -1 });

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
