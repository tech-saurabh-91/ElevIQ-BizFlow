import Country from '../models/Country.js';
import State from '../models/State.js';
import City from '../models/City.js';
import PlatformAuditLog from '../models/PlatformAuditLog.js';
import { success, created } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import { ensureLocations, importCities } from '../services/locationService.js';

/**
 * Location master (Country -> State -> City).
 *
 * Read endpoints serve every signed-in user (address pickers). Write endpoints
 * are mounted under /api/platform/locations for platform admins only.
 */

const isPlatform = (req) => req.user?.scope === 'platform';
// Platform admins may list inactive rows (`?all=true`) to re-enable them.
const activeFilter = (req) => (isPlatform(req) && req.query.all === 'true' ? {} : { isActive: true });

const record = (req, entry) =>
  PlatformAuditLog.create({
    actor: {
      userId: req.user?.id || null,
      name: req.user?.name || 'system',
      email: req.user?.email || '',
      role: req.user?.role || 'SYSTEM',
    },
    channel: 'WEB',
    severity: 'INFO',
    occurredAt: new Date(),
    ...entry,
  }).catch(() => {});

const countryOut = (c) => ({
  code: c.code,
  name: c.name,
  flag: c.flag || '',
  phoneCode: c.phoneCode || '',
  currency: c.currency || '',
  currencySymbol: c.currencySymbol || '',
  timezones: c.timezones || [],
  locale: c.locale || 'en',
  tax: c.tax || {},
  postalCode: c.postalCode || {},
  isActive: c.isActive !== false,
});

const stateOut = (s) => ({ id: String(s._id), country: s.country, code: s.code, name: s.name, isActive: s.isActive !== false });
const cityOut = (c) => ({ id: String(c._id), country: c.country, state: c.state, name: c.name, isActive: c.isActive !== false });

const loadCountry = async (code) => {
  const country = await Country.findOne({ code: String(code).toUpperCase() });
  if (!country) throw new NotFoundError('Country not found');
  return country;
};

// ---- read --------------------------------------------------------------------

export const listCountries = asyncHandler(async (req, res) => {
  await ensureLocations();
  const rows = await Country.find(activeFilter(req)).sort({ name: 1 }).lean();
  let data = rows.map(countryOut);

  if (isPlatform(req) && req.query.counts === 'true') {
    const [states, cities] = await Promise.all([
      State.aggregate([{ $group: { _id: '$country', n: { $sum: 1 } } }]),
      City.aggregate([{ $group: { _id: '$country', n: { $sum: 1 } } }]),
    ]);
    const s = Object.fromEntries(states.map((r) => [r._id, r.n]));
    const c = Object.fromEntries(cities.map((r) => [r._id, r.n]));
    data = data.map((row) => ({ ...row, stateCount: s[row.code] || 0, cityCount: c[row.code] || 0 }));
  }
  return success(res, { data });
});

export const getCountry = asyncHandler(async (req, res) => {
  await ensureLocations();
  const country = await Country.findOne({ code: String(req.params.code).toUpperCase() }).lean();
  if (!country) throw new NotFoundError('Country not found');
  return success(res, { data: countryOut(country) });
});

export const listStates = asyncHandler(async (req, res) => {
  await ensureLocations();
  const rows = await State.find({ country: String(req.params.code).toUpperCase(), ...activeFilter(req) })
    .sort({ name: 1 })
    .lean();
  return success(res, { data: rows.map(stateOut) });
});

export const listCities = asyncHandler(async (req, res) => {
  await ensureLocations();
  const rows = await City.find({
    country: String(req.params.code).toUpperCase(),
    state: String(req.params.state).toUpperCase(),
    ...activeFilter(req),
  })
    .sort({ name: 1 })
    .lean();
  return success(res, { data: rows.map(cityOut) });
});

// ---- platform write ------------------------------------------------------------

export const createCountry = asyncHandler(async (req, res) => {
  const code = req.body.code.toUpperCase();
  if (await Country.exists({ code })) throw new ConflictError(`Country ${code} already exists`);
  const doc = await Country.create({ ...req.body, code });
  record(req, { action: AUDIT_ACTIONS.CREATE, entityType: 'Country', entityId: doc._id, description: `Country ${code} added` });
  return created(res, { message: 'Country added', data: countryOut(doc) });
});

export const updateCountry = asyncHandler(async (req, res) => {
  const country = await loadCountry(req.params.code);
  const { tax, postalCode, ...rest } = req.body;
  Object.entries(rest).forEach(([k, v]) => v !== undefined && country.set(k, v));
  if (tax) country.set('tax', { ...country.tax.toObject(), ...tax });
  if (postalCode) country.set('postalCode', { ...country.postalCode.toObject(), ...postalCode });
  await country.save();
  record(req, { action: AUDIT_ACTIONS.UPDATE, entityType: 'Country', entityId: country._id, description: `Country ${country.code} updated` });
  return success(res, { message: 'Country updated', data: countryOut(country) });
});

export const createState = asyncHandler(async (req, res) => {
  const country = await loadCountry(req.params.code);
  const code = req.body.code.toUpperCase();
  if (await State.exists({ country: country.code, code })) throw new ConflictError(`State code ${code} already exists`);
  const doc = await State.create({ country: country.code, code, name: req.body.name });
  return created(res, { message: 'State added', data: stateOut(doc) });
});

export const updateState = asyncHandler(async (req, res) => {
  const doc = await State.findOne({ _id: req.params.id, country: String(req.params.code).toUpperCase() });
  if (!doc) throw new NotFoundError('State not found');
  if (req.body.name !== undefined) doc.name = req.body.name;
  if (req.body.isActive !== undefined) doc.isActive = req.body.isActive;
  await doc.save();
  return success(res, { message: 'State updated', data: stateOut(doc) });
});

export const createCity = asyncHandler(async (req, res) => {
  const country = String(req.params.code).toUpperCase();
  const state = String(req.params.state).toUpperCase();
  if (!(await State.exists({ country, code: state }))) throw new NotFoundError('State not found');
  const name = req.body.name.trim();
  const dup = await City.exists({ country, state, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (dup) throw new ConflictError(`${name} already exists in this state`);
  const doc = await City.create({ country, state, name });
  return created(res, { message: 'City added', data: cityOut(doc) });
});

export const updateCity = asyncHandler(async (req, res) => {
  const doc = await City.findOne({ _id: req.params.id, country: String(req.params.code).toUpperCase() });
  if (!doc) throw new NotFoundError('City not found');
  if (req.body.name !== undefined) doc.name = req.body.name;
  if (req.body.isActive !== undefined) doc.isActive = req.body.isActive;
  await doc.save();
  return success(res, { message: 'City updated', data: cityOut(doc) });
});

export const importCountryCities = asyncHandler(async (req, res) => {
  const country = await loadCountry(req.params.code);
  const result = await importCities(country.code);
  record(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Country',
    entityId: country._id,
    description: `Imported ${result.inserted} cities for ${country.code}`,
  });
  return success(res, { message: `${result.inserted} cities imported`, data: result });
});

export default {
  listCountries,
  getCountry,
  listStates,
  listCities,
  createCountry,
  updateCountry,
  createState,
  updateState,
  createCity,
  updateCity,
  importCountryCities,
};
