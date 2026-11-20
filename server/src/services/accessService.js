import AccessProfile from '../models/AccessProfile.js';

/**
 * Attach each user's access profile (as `profile`) so accessFor /
 * dataScopeFor / limitsFor can read it. Works on lean users or documents.
 */
export const withProfiles = async (users) => {
  const ids = [...new Set(users.map((u) => (u.accessProfile ? String(u.accessProfile?._id || u.accessProfile) : null)).filter(Boolean))];
  if (!ids.length) return users.map((u) => Object.assign(plain(u), { profile: null }));
  const profiles = await AccessProfile.find({ _id: { $in: ids } }).lean();
  const byId = new Map(profiles.map((p) => [String(p._id), p]));
  return users.map((u) => Object.assign(plain(u), { profile: byId.get(String(u.accessProfile?._id || u.accessProfile)) || null }));
};

const plain = (u) => (typeof u?.toObject === 'function' ? u.toObject() : { ...u });

export default { withProfiles };
