/**
 * List-query helper: pagination, sorting, full-text-ish search, filters.
 * Keeps every list endpoint consistent: { page, limit, sort, order, search, ...filters }
 */

/** Build a case-insensitive "contains" regex from a search string. */
export const escapeRegex = (s = '') => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const searchRegex = (s) => new RegExp(escapeRegex(String(s).trim()), 'i');

/**
 * Apply `search` across the given fields (OR of case-insensitive regexes).
 * Skips ObjectId fields unless the value looks like an id.
 */
export const applySearch = (filter, search, fields = []) => {
  if (!search || !fields.length) return filter;
  const rx = searchRegex(search);
  const or = fields.map((f) => ({ [f]: rx }));
  filter.$or = filter.$or ? [...filter.$or, ...or] : or;
  return filter;
};

/** Whitelist-based filter application (never allow arbitrary keys). */
export const applyFilters = (filter, query, spec = {}) => {
  for (const [key, def] of Object.entries(spec)) {
    const value = query[key];
    if (value === undefined || value === null || value === '') continue;

    if (def.type === 'date' || def.type === 'dateRange') {
      // expects query[key + 'From'] / query[key + 'To'] handled separately
      continue;
    }
    if (def.type === 'in') {
      const arr = Array.isArray(value) ? value : String(value).split(',').map((v) => v.trim()).filter(Boolean);
      if (arr.length) filter[key] = { $in: def.cast ? arr.map(def.cast) : arr };
      continue;
    }
    if (def.type === 'range') {
      filter[key] = filter[key] || {};
      if (query[`${key}Min`] != null && query[`${key}Min`] !== '') filter[key].$gte = Number(query[`${key}Min`]);
      if (query[`${key}Max`] != null && query[`${key}Max`] !== '') filter[key].$lte = Number(query[`${key}Max`]);
      if (!Object.keys(filter[key]).length) delete filter[key];
      continue;
    }
    if (def.type === 'gte') {
      filter[key] = { ...(filter[key] || {}), $gte: new Date(value) };
      continue;
    }
    if (def.type === 'lte') {
      filter[key] = { ...(filter[key] || {}), $lte: new Date(value) };
      continue;
    }
    if (def.type === 'bool') {
      filter[key] = value === true || value === 'true' || value === '1';
      continue;
    }
    if (def.type === 'objectId') {
      filter[key] = value;
      continue;
    }
    // default: exact match (string/number)
    filter[key] = def.type === 'number' ? Number(value) : value;
  }
  return filter;
};

/**
 * Parse a date-range pair from the query.
 * usage: applyDateRange(filter, query, 'createdAt', 'from', 'to')
 * Also supports generic `dateFrom`/`dateTo` mapped to a target field.
 */
export const applyDateRange = (filter, query, field, fromKey = 'dateFrom', toKey = 'dateTo') => {
  const from = query[fromKey];
  const to = query[toKey];
  if (!from && !to) return filter;
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    const d = new Date(to);
    // inclusive end-of-day when only a date is provided (no time component)
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) d.setHours(23, 59, 59, 999);
    range.$lte = d;
  }
  filter[field] = { ...(filter[field] || {}), ...range };
  return filter;
};

/** Parse sort input against a whitelist; returns mongoose sort string. */
export const parseSort = (query, allowed = [], defaultSort = '-createdAt') => {
  const { sort, order } = query;
  if (!sort) return defaultSort;
  const dir = String(order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  const field = String(sort);
  if (allowed.length && !allowed.includes(field)) return defaultSort;
  return `${dir === 1 ? '' : '-'}${field}`;
};

/** Build the standard paginated result. */
export const paginateResult = (docs, page, limit, total) => ({
  data: docs,
  meta: {
    page: Number(page),
    limit: Number(limit),
    total: Number(total),
    pages: Math.max(1, Math.ceil((Number(total) || 0) / (Number(limit) || 1))),
  },
});

/**
 * All-in-one list executor.
 *
 * @param {Model} Model - mongoose model
 * @param {object} options
 * @param {object} [options.filter]      - base filter (include companyId if needed; ALS adds it)
 * @param {object} [options.query]       - raw req.query
 * @param {string[]} [options.searchFields]
 * @param {object} [options.filtersSpec] - whitelist spec for applyFilters
 * @param {string[]} [options.sortAllowed]
 * @param {string} [options.populate]
 * @param {string} [options.defaultSort]
 */
export const listDocuments = async (Model, options = {}) => {
  const {
    filter = {},
    query = {},
    searchFields = [],
    filtersSpec = {},
    sortAllowed = [],
    populate = '',
    defaultSort = '-createdAt',
    dateField = 'createdAt',
    lean = true,
  } = options;

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const finalFilter = { ...filter };
  applySearch(finalFilter, query.search, searchFields);
  applyFilters(finalFilter, query, filtersSpec);
  if (query.dateFrom || query.dateTo) applyDateRange(finalFilter, query, dateField);

  const sort = parseSort(query, sortAllowed, defaultSort);

  const q = Model.find(finalFilter).sort(sort).skip(skip).limit(limit);
  if (populate) {
    (Array.isArray(populate) ? populate : [populate]).forEach((p) => q.populate(p));
  }
  if (lean) q.lean();

  const [docs, total] = await Promise.all([q, Model.countDocuments(finalFilter)]);

  return { data: docs, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
};

export default listDocuments;
