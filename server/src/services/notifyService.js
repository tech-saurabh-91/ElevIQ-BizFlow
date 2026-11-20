import Notification from '../models/Notification.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import { accessFor } from '../middlewares/rbac.js';
import { withProfiles } from './accessService.js';
import logger from '../utils/logger.js';

/**
 * In-app notifications for workflow events (approval needed, approved,
 * rejected...). One document per recipient so each user keeps their own read
 * flag. A failed notification must never fail the business action, so every
 * helper swallows (and logs) its own errors.
 */

// Accepts ids or populated documents.
const uniq = (ids) => [...new Set(ids.filter(Boolean).map((v) => String(v?._id || v)))];

/** Notify specific users. */
export const notifyUsers = async (userIds, { type = 'SYSTEM', title, body = '', link = '', entityType = '', entityId = null, priority = 'NORMAL', exclude = null }) => {
  try {
    const recipients = uniq(userIds).filter((id) => !exclude || id !== String(exclude));
    if (!recipients.length) return;
    await Notification.insertMany(
      recipients.map((id) => ({
        recipients: [id],
        type,
        title: String(title).slice(0, 160),
        body: String(body).slice(0, 500),
        link,
        entityType,
        entityId,
        priority,
      }))
    );
  } catch (err) {
    logger.warn?.(`Notification failed: ${err.message}`);
  }
};

/**
 * Active users who may do `permission`: the company's role matrix, each
 * user's own Allow / Deny and sales type (see accessFor). Admins always qualify.
 */
export const usersWithPermission = async (companyId, permission) => {
  const settings = await Setting.forCompany(companyId);
  const users = await withProfiles(await User.find({ isActive: true }).select('_id role salesType accessOverrides accessProfile').lean());
  return users.filter((u) => accessFor(u, settings, permission).allowed).map((u) => String(u._id));
};

/** Notify everyone who may act on `permission` (e.g. the approvers). */
export const notifyPermission = async (companyId, permission, message) => {
  try {
    await notifyUsers(await usersWithPermission(companyId, permission), message);
  } catch (err) {
    logger.warn?.(`Notification failed: ${err.message}`);
  }
};

export default { notifyUsers, notifyPermission, usersWithPermission };
