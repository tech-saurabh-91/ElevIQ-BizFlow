import { hasPermission } from './rbac.js';

/**
 * Purchase rates, average cost and margins are business-sensitive: users
 * without "products.cost.view" (salesmen by default) never receive them.
 * Instead of every controller remembering to drop them, this wraps res.json
 * and strips the cost fields from any response for such users.
 */
export const COST_FIELDS = ['purchasePrice', 'avgCost', 'costPrice', 'lastCost', 'unitCost', 'grossProfit', 'marginPercent'];
const HIDE = new Set(COST_FIELDS);

const strip = (value, done = new Map()) => {
  if (Array.isArray(value)) return value.map((v) => strip(v, done));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  if (done.has(value)) return done.get(value);
  const source = typeof value.toJSON === 'function' ? value.toJSON() : value;
  if (!source || typeof source !== 'object') return source; // ObjectId -> string, etc.
  const out = {};
  done.set(value, out);
  for (const [k, v] of Object.entries(source)) {
    if (!HIDE.has(k)) out[k] = strip(v, done);
  }
  return out;
};

export const hideCostsUnlessAllowed = (req, res, next) => {
  if (hasPermission(req, 'products.cost.view')) return next();
  const json = res.json.bind(res);
  res.json = (body) => json(strip(body));
  return next();
};

export default hideCostsUnlessAllowed;
