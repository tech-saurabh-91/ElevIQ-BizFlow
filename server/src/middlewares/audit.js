import AuditLog from '../models/AuditLog.js';
import PlatformAuditLog from '../models/PlatformAuditLog.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import logger from '../utils/logger.js';

const sanitize = (obj) => {
  if (obj == null) return null;
  const sensitive = /password|secret|token|refresh|hash|otp/i;
  try {
    const clone = JSON.parse(JSON.stringify(obj));
    const walk = (o) => {
      if (!o || typeof o !== 'object') return o;
      for (const k of Object.keys(o)) {
        if (sensitive.test(k)) o[k] = '[REDACTED]';
        else if (o[k] && typeof o[k] === 'object') walk(o[k]);
      }
      return o;
    };
    return walk(clone);
  } catch {
    return null;
  }
};

/**
 * Fire-and-forget company audit write. Never throws.
 *
 * Usage: audit(req, { action:'CREATE', entityType:'Customer', entityId: doc._id,
 *                     entityLabel: doc.name, before, after, description })
 */
export const audit = (req, entry = {}) => {
  try {
    const scope = entry.scope || (req.user?.scope === 'platform' ? 'platform' : 'company');
    const base = {
      action: entry.action || AUDIT_ACTIONS.UPDATE,
      entityType: entry.entityType || 'Unknown',
      entityId: entry.entityId ?? null,
      entityLabel: entry.entityLabel ?? '',
      description: entry.description || '',
      before: sanitize(entry.before),
      after: sanitize(entry.after),
      changes: sanitize(entry.changes),
      meta: {
        ip: req.ip || '',
        userAgent: req.headers['user-agent'] || '',
        requestId: req.id || '',
        method: req.method,
        path: req.originalUrl,
      },
      channel: entry.channel || (req.user?.scope === 'platform' ? 'WEB' : 'WEB'),
      severity: entry.severity || 'INFO',
      occurredAt: new Date(),
    };

    if (scope === 'platform') {
      PlatformAuditLog.create({
        ...base,
        actor: {
          userId: req.user?.id || null,
          name: req.user?.name || '',
          email: req.user?.email || '',
          role: req.user?.role || '',
        },
        targetCompanyId: entry.targetCompanyId || req.companyId || null,
      }).catch((e) => logger.error('Platform audit write failed', e.message));
    } else {
      const companyId = entry.companyId || req.companyId;
      if (!companyId) return; // nothing to attach to
      AuditLog.create({
        ...base,
        companyId,
        actor: {
          userId: entry.actor?.userId || req.user?.id || null,
          name: entry.actor?.name || req.user?.name || '',
          role: entry.actor?.role || req.user?.role || '',
          email: entry.actor?.email || req.user?.email || '',
        },
        status: entry.status || '',
      }).catch((e) => logger.error('Audit write failed', e.message));
    }
  } catch (e) {
    logger.error('audit() threw', e.message);
  }
};

/** Compute a shallow before/after diff for update audits. */
export const diff = (before, after) => {
  if (!before || !after) return null;
  const changes = {};
  for (const key of Object.keys(after)) {
    if (key === 'updatedAt' || key === 'updatedBy') continue;
    const a = JSON.stringify(before[key]);
    const b = JSON.stringify(after[key]);
    if (a !== b) changes[key] = { from: before[key], to: after[key] };
  }
  return Object.keys(changes).length ? changes : null;
};

/**
 * Express middleware that captures `req.audit` for downstream handlers.
 * (Convenience wrapper so routes can just call req.audit({...}).)
 */
export const auditContext = (req, _res, next) => {
  req.audit = (entry) => audit(req, entry);
  next();
};

export default audit;
