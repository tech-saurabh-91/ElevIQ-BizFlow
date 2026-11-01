import PlatformAuditLog from '../../models/PlatformAuditLog.js';
import AuditLog from '../../models/AuditLog.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ForbiddenError } from '../../utils/errors.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { runWithContext } from '../../middlewares/tenantContext.js';
import logger from '../../utils/logger.js';

/**
 * POST /api/platform/impersonation/exit
 *
 * Reached with an IMPERSONATION token (scope='impersonate'), which is why this
 * router is mounted BEFORE the platform-scope guard in routes/platform/index.js.
 *
 * Idempotent: a platform token is also accepted so the client can safely retry
 * if the short-lived impersonation token already expired on the way out.
 */
export const exit = asyncHandler(async (req, res) => {
  const user = req.user;
  if (!user || (user.scope !== 'impersonate' && user.scope !== 'platform')) {
    throw new ForbiddenError('Impersonation session required', 'FORBIDDEN');
  }

  const companyId = req.companyId;
  const companyLabel = user.companyName || '';

  const entry = {
    action: AUDIT_ACTIONS.IMPERSONATE,
    entityType: 'Company',
    entityId: companyId || null,
    entityLabel: companyLabel,
    targetCompanyId: companyId || null,
    severity: 'WARN',
    description:
      user.scope === 'impersonate'
        ? `Exited impersonation of ${user.name} in ${companyLabel}`
        : `Closed impersonation session for ${companyLabel}`,
    before: null,
    after: { phase: 'exit' },
    channel: 'WEB',
    occurredAt: new Date(),
  };

  await Promise.all([
    PlatformAuditLog.create({
      actor: {
        userId: user.impersonatedBy?.id || user.id || null,
        name: user.impersonatedBy?.name || user.name || 'system',
        email: user.impersonatedBy?.email || user.email || '',
        role: user.impersonatedBy?.role || user.role || 'SYSTEM',
      },
      ...entry,
    }).catch((e) => logger.warn(`impersonation exit audit failed: ${e.message}`)),
    companyId
      ? runWithContext({ scope: 'company', companyId: String(companyId) }, () =>
          AuditLog.create({
            companyId,
            actor: {
              userId: user.impersonatedBy?.id || user.id || null,
              name: user.impersonatedBy?.name || user.name || 'system',
              email: user.impersonatedBy?.email || user.email || '',
              role: user.impersonatedBy?.role || user.role || 'SYSTEM',
            },
            action: AUDIT_ACTIONS.IMPERSONATE,
            entityType: 'Company',
            entityId: companyId,
            entityLabel: companyLabel,
            description: `${user.impersonatedBy?.name || 'Support'} left this workspace`,
            severity: 'WARN',
            channel: 'WEB',
            status: '',
            occurredAt: new Date(),
          })
        ).catch((e) => logger.warn(`tenant exit audit failed: ${e.message}`))
      : Promise.resolve(),
  ]);

  return success(res, {
    message: 'Impersonation ended',
    data: { exited: true, companyId: companyId || null },
  });
});

export default { exit };
