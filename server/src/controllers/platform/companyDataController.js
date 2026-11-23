import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { BadRequestError, ForbiddenError } from '../../utils/errors.js';
import { AUDIT_ACTIONS, PLATFORM_ROLES } from '../../config/constants.js';
import { recordPlatformAudit } from '../../services/companyService.js';
import {
  BACKUP_FRESH_HOURS,
  buildBackup,
  countRecords,
  purgeBlocker,
  purgeCompany,
  restoreBackup,
} from '../../services/companyBackupService.js';
import Company from '../../models/Company.js';

/**
 * Provider tools for a company's data: backup, purge, restore.
 * Every one is for the super admin only - a backup holds every record of the
 * company, password hashes included.
 */

const actorOf = (req) => ({ id: req.user?.id, name: req.user?.name, email: req.user?.email, role: req.user?.role });

export const requireSuperAdmin = (req, _res, next) => {
  if (req.user?.role !== PLATFORM_ROLES.SUPER_ADMIN) {
    return next(new ForbiddenError('Only the super admin can back up, delete or restore company data', 'FORBIDDEN'));
  }
  return next();
};

const label = (c) => `${c.code} · ${c.businessName}`;

/** GET /companies/:id/data - what the company holds and whether it can be purged. */
export const summary = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id).skipTenant().lean();
  if (!company) throw new BadRequestError('Company not found', 'COMPANY_NOT_FOUND');
  const counts = await countRecords(company._id);
  return success(res, {
    data: {
      counts,
      records: Object.values(counts).reduce((s, n) => s + n, 0),
      backup: company.dataBackup || null,
      purgedAt: company.purgedAt || null,
      purgedBy: company.purgedBy || '',
      restoredAt: company.restoredAt || null,
      purgeBlocker: purgeBlocker(company),
      freshHours: BACKUP_FRESH_HOURS,
    },
  });
});

/** GET /companies/:id/backup - download the backup file (.json.gz). */
export const backup = asyncHandler(async (req, res) => {
  const result = await buildBackup(req.params.id, actorOf(req));
  await recordPlatformAudit(actorOf(req), {
    action: AUDIT_ACTIONS.BACKUP,
    entityType: 'Company',
    entityId: result.company._id,
    entityLabel: label(result.company),
    targetCompanyId: result.company._id,
    severity: 'WARN',
    description: `Downloaded a full data backup of ${result.company.businessName}: ${result.records} records, ${result.buffer.length} bytes, sha256 ${result.sha256.slice(0, 12)}…`,
  });
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.setHeader('X-Backup-Sha256', result.sha256);
  res.setHeader('X-Backup-Records', String(result.records));
  return res.send(result.buffer);
});

/** POST /companies/:id/purge { confirmCode, reason } - delete every record after a backup. */
export const purge = asyncHandler(async (req, res) => {
  const result = await purgeCompany(req.params.id, req.body, actorOf(req));
  await recordPlatformAudit(actorOf(req), {
    action: AUDIT_ACTIONS.PURGE,
    entityType: 'Company',
    entityId: result.company._id,
    entityLabel: label(result.company),
    targetCompanyId: result.company._id,
    severity: 'WARN',
    description: `Deleted all data of ${result.company.businessName} (${result.records} records) after a backup taken ${result.company.dataBackup?.lastAt?.toISOString?.() || ''}. Reason: ${req.body.reason}`,
    after: { removed: result.removed },
  });
  return success(res, {
    message: `All data of ${result.company.businessName} was deleted (${result.records} records). Keep the backup file safe.`,
    data: { removed: result.removed, records: result.records },
  });
});

/** POST /companies/restore?apply=true (multipart "file") - check, then load a backup. */
export const restore = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) throw new BadRequestError('Choose the backup file (.json.gz)', 'FILE_REQUIRED');
  const apply = String(req.query.apply) === 'true';
  const result = await restoreBackup(req.file.buffer, { apply });
  if (apply) {
    await recordPlatformAudit(actorOf(req), {
      action: AUDIT_ACTIONS.RESTORE,
      entityType: 'Company',
      entityId: result.company.id,
      entityLabel: `${result.company.code} · ${result.company.name}`,
      targetCompanyId: result.company.id,
      severity: 'WARN',
      description: `Restored ${result.company.name} from a backup of ${result.header.createdAt}: ${result.inserted} records loaded, ${result.skipped} already present`,
    });
  }
  return success(res, {
    message: apply ? `${result.company.name} restored: ${result.inserted} records loaded` : 'Backup checked',
    data: result,
  });
});

export default { requireSuperAdmin, summary, backup, purge, restore };
