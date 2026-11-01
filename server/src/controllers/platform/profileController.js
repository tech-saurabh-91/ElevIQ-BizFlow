import PlatformUser from '../../models/PlatformUser.js';
import PlatformAuditLog from '../../models/PlatformAuditLog.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { NotFoundError } from '../../utils/errors.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';

const serialize = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  phone: u.phone || '',
  role: u.role,
  permissions: u.permissions || [],
  isActive: Boolean(u.isActive),
  lastLoginAt: u.lastLoginAt,
  twoFactorEnabled: Boolean(u.twoFactorEnabled),
  createdAt: u.createdAt,
});

/**
 * PATCH /api/platform/profile
 * Platform admins edit their own name/phone (email + role are protected).
 */
export const updateProfile = asyncHandler(async (req, res) => {
  const user = await PlatformUser.findById(req.user.id);
  if (!user || user.isDeleted) throw new NotFoundError('Account not found', 'NOT_FOUND');

  const before = { name: user.name, phone: user.phone };

  if (req.body.name !== undefined) user.name = req.body.name;
  if (req.body.phone !== undefined) user.phone = req.body.phone || null;

  await user.save();

  await PlatformAuditLog.create({
    actor: { userId: user._id, name: user.name, email: user.email, role: user.role },
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'PlatformUser',
    entityId: user._id,
    entityLabel: user.email,
    description: 'Updated platform profile',
    before,
    after: { name: user.name, phone: user.phone },
    channel: 'WEB',
    severity: 'INFO',
    occurredAt: new Date(),
  }).catch(() => {});

  return success(res, { message: 'Profile updated', data: { user: serialize(user) } });
});

/**
 * GET /api/platform/profile — full profile (richer than /auth/me).
 */
export const getProfile = asyncHandler(async (req, res) => {
  const user = await PlatformUser.findById(req.user.id).lean();
  if (!user || user.isDeleted) throw new NotFoundError('Account not found', 'NOT_FOUND');
  return success(res, { message: 'OK', data: { user: serialize(user) } });
});

export default { getProfile, updateProfile };
