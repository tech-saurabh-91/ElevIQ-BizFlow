import Session from '../models/Session.js';
import { withoutTenant } from '../middlewares/tenant.js';
import logger from '../utils/logger.js';

/** Delete sessions whose TTL has passed and clear stale user refresh tokens. */
export const runSessionCleanup = async () => {
  const now = new Date();
  let deleted = 0;

  await withoutTenant(async () => {
    const res = await Session.deleteMany({ expiresAt: { $lt: now } }).skipTenant();
    deleted = res.deletedCount || 0;

    // Prune expired refresh-token entries from user docs (sparse cleanup).
    const { default: User } = await import('../models/User.js');
    await User.updateMany(
      { 'refreshTokens.0': { $exists: true } },
      { $pull: { refreshTokens: { expiresAt: { $lt: now } } } }
    ).skipTenant();

    const { default: PlatformUser } = await import('../models/PlatformUser.js');
    await PlatformUser.updateMany(
      { 'refreshTokens.0': { $exists: true } },
      { $pull: { refreshTokens: { expiresAt: { $lt: now } } } }
    );
  });

  logger.info(`session-cleanup: removed ${deleted} expired sessions`);
  return { deleted };
};

export default runSessionCleanup;
