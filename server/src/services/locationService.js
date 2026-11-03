import Country from '../models/Country.js';
import State from '../models/State.js';
import City from '../models/City.js';
import logger from '../utils/logger.js';

/**
 * Location master: Country -> State -> City.
 *
 * Seeded once from the bundled `country-state-city` dataset (all countries and
 * states, plus cities for the countries in CITY_SEED_COUNTRIES). Platform admins
 * can edit everything afterwards and import cities for more countries on demand.
 */

const CITY_SEED_COUNTRIES = ['IN'];

// Tax defaults a company inherits when it picks the country. Anything not
// listed falls back to a generic "Tax" at 0% that the company can edit.
const TAX_DEFAULTS = {
  IN: { regime: 'GST', label: 'GST', taxIdLabel: 'GSTIN', defaultRate: 18, maxRate: 28, splitIntraState: true },
  AE: { regime: 'VAT', label: 'VAT', taxIdLabel: 'TRN', defaultRate: 5 },
  SA: { regime: 'VAT', label: 'VAT', taxIdLabel: 'VAT number', defaultRate: 15 },
  OM: { regime: 'VAT', label: 'VAT', taxIdLabel: 'VATIN', defaultRate: 5 },
  BH: { regime: 'VAT', label: 'VAT', taxIdLabel: 'VAT number', defaultRate: 10 },
  QA: { regime: 'NONE', label: 'Tax', taxIdLabel: 'Tax ID', defaultRate: 0 },
  KW: { regime: 'NONE', label: 'Tax', taxIdLabel: 'Tax ID', defaultRate: 0 },
  GB: { regime: 'VAT', label: 'VAT', taxIdLabel: 'VAT number', defaultRate: 20 },
  IE: { regime: 'VAT', label: 'VAT', taxIdLabel: 'VAT number', defaultRate: 23 },
  DE: { regime: 'VAT', label: 'MwSt', taxIdLabel: 'USt-IdNr', defaultRate: 19 },
  FR: { regime: 'VAT', label: 'TVA', taxIdLabel: 'TVA number', defaultRate: 20 },
  IT: { regime: 'VAT', label: 'IVA', taxIdLabel: 'Partita IVA', defaultRate: 22 },
  ES: { regime: 'VAT', label: 'IVA', taxIdLabel: 'NIF', defaultRate: 21 },
  NL: { regime: 'VAT', label: 'BTW', taxIdLabel: 'BTW number', defaultRate: 21 },
  BE: { regime: 'VAT', label: 'BTW', taxIdLabel: 'VAT number', defaultRate: 21 },
  US: { regime: 'SALES_TAX', label: 'Sales tax', taxIdLabel: 'EIN', defaultRate: 0 },
  CA: { regime: 'GST', label: 'GST/HST', taxIdLabel: 'Business number', defaultRate: 5 },
  AU: { regime: 'GST', label: 'GST', taxIdLabel: 'ABN', defaultRate: 10 },
  NZ: { regime: 'GST', label: 'GST', taxIdLabel: 'GST number', defaultRate: 15 },
  SG: { regime: 'GST', label: 'GST', taxIdLabel: 'GST reg. no.', defaultRate: 9 },
  MY: { regime: 'SALES_TAX', label: 'SST', taxIdLabel: 'SST number', defaultRate: 10 },
  ID: { regime: 'VAT', label: 'PPN', taxIdLabel: 'NPWP', defaultRate: 11 },
  PH: { regime: 'VAT', label: 'VAT', taxIdLabel: 'TIN', defaultRate: 12 },
  TH: { regime: 'VAT', label: 'VAT', taxIdLabel: 'Tax ID', defaultRate: 7 },
  VN: { regime: 'VAT', label: 'VAT', taxIdLabel: 'Tax code', defaultRate: 10 },
  BD: { regime: 'VAT', label: 'VAT', taxIdLabel: 'BIN', defaultRate: 15 },
  LK: { regime: 'VAT', label: 'VAT', taxIdLabel: 'VAT number', defaultRate: 18 },
  NP: { regime: 'VAT', label: 'VAT', taxIdLabel: 'PAN', defaultRate: 13 },
  PK: { regime: 'GST', label: 'Sales tax', taxIdLabel: 'NTN', defaultRate: 18 },
  ZA: { regime: 'VAT', label: 'VAT', taxIdLabel: 'VAT number', defaultRate: 15 },
  KE: { regime: 'VAT', label: 'VAT', taxIdLabel: 'KRA PIN', defaultRate: 16 },
  NG: { regime: 'VAT', label: 'VAT', taxIdLabel: 'TIN', defaultRate: 7.5 },
  EG: { regime: 'VAT', label: 'VAT', taxIdLabel: 'Tax ID', defaultRate: 14 },
};

// Postal code formats for countries whose codes are purely numeric.
const NUMERIC_POSTAL = {
  IN: [6, 'PIN code'], US: [5, 'ZIP code'], DE: [5], FR: [5], IT: [5], ES: [5], AU: [4], SG: [6],
  MY: [5], ID: [5], TH: [5], VN: [6], PH: [4], PK: [5], BD: [4], LK: [5], NP: [5], SA: [5],
  CN: [6], RU: [6], JP: [7], ZA: [4], KE: [5], NG: [6], EG: [5], TR: [5], MX: [5], NZ: [4],
  CH: [4], AT: [4], BE: [4], DK: [4], NO: [4], SE: [5], FI: [5], OM: [3], BH: [3],
};
// Countries that do not use postal codes at all.
const NO_POSTAL = ['AE', 'QA', 'HK'];

/** Narrow currency symbol (₹, $, د.إ ...) from Intl, falling back to the code. */
const currencySymbolOf = (currency) => {
  if (!currency) return '';
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value || currency;
  } catch {
    return currency;
  }
};

const postalOf = (code) => {
  if (NO_POSTAL.includes(code)) return { label: 'Postal code', numeric: false, length: null, pattern: '' };
  const numeric = NUMERIC_POSTAL[code];
  if (numeric) return { label: numeric[1] || 'Postal code', numeric: true, length: numeric[0], pattern: '' };
  return { label: 'Postal code', numeric: false, length: null, pattern: '' };
};

// Loaded only when seeding/importing: the dataset is ~17 MB.
const loadDataset = async () => {
  const mod = await import('country-state-city');
  return mod.Country ? mod : mod.default;
};

const dedupeCities = (cities) => {
  const seen = new Set();
  return cities.filter((c) => {
    const key = `${c.stateCode}|${c.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** Import (or top up) the cities of one country from the dataset. */
export const importCities = async (countryCode) => {
  const code = String(countryCode).toUpperCase();
  const { City: CityData } = await loadDataset();
  const rows = dedupeCities(CityData.getCitiesOfCountry(code) || []).map((c) => ({
    country: code,
    state: String(c.stateCode).toUpperCase(),
    name: c.name,
  }));
  if (!rows.length) return { inserted: 0 };
  const ops = rows.map((r) => ({
    updateOne: { filter: r, update: { $setOnInsert: { ...r, isActive: true } }, upsert: true },
  }));
  const res = await City.bulkWrite(ops, { ordered: false });
  return { inserted: res.upsertedCount || 0 };
};

/** Seed countries + states (+ cities for CITY_SEED_COUNTRIES). Idempotent. */
export const seedLocations = async () => {
  const { Country: CountryData, State: StateData } = await loadDataset();

  const countries = CountryData.getAllCountries().map((c) => ({
    code: c.isoCode,
    name: c.name,
    flag: c.flag || '',
    phoneCode: c.phonecode ? String(c.phonecode).replace(/^\+?/, '+') : '',
    currency: c.currency || '',
    currencySymbol: currencySymbolOf(c.currency),
    timezones: (c.timezones || []).map((t) => t.zoneName).filter(Boolean),
    tax: { regime: 'VAT', label: 'Tax', taxIdLabel: 'Tax ID', defaultRate: 0, maxRate: 100, splitIntraState: false, ...(TAX_DEFAULTS[c.isoCode] || {}) },
    postalCode: postalOf(c.isoCode),
  }));

  // $setOnInsert keeps any edits a platform admin has already made.
  await Country.bulkWrite(
    countries.map((c) => ({ updateOne: { filter: { code: c.code }, update: { $setOnInsert: c }, upsert: true } })),
    { ordered: false }
  );

  const states = StateData.getAllStates().map((s) => ({
    country: s.countryCode,
    code: String(s.isoCode).toUpperCase(),
    name: s.name,
  }));
  await State.bulkWrite(
    states.map((s) => ({
      updateOne: { filter: { country: s.country, code: s.code }, update: { $setOnInsert: s }, upsert: true },
    })),
    { ordered: false }
  );

  for (const code of CITY_SEED_COUNTRIES) await importCities(code);

  return { countries: countries.length, states: states.length };
};

let seeding = null;

/** Seed lazily the first time the master is read on an empty database. */
export const ensureLocations = async () => {
  if (await Country.exists({})) return;
  seeding ??= seedLocations()
    .then((r) => logger.info(`Location master seeded: ${r.countries} countries, ${r.states} states`))
    .catch((err) => {
      seeding = null;
      throw err;
    });
  await seeding;
};

export const getCountry = async (code) => {
  if (!code) return null;
  await ensureLocations();
  return Country.findOne({ code: String(code).toUpperCase() }).lean();
};

/**
 * Country lookup by name or code (stored addresses hold the country name).
 * Does not trigger seeding: on an unseeded database it returns null and
 * callers simply skip country-specific validation.
 */
export const findCountry = async (nameOrCode) => {
  if (!nameOrCode) return null;
  const value = String(nameOrCode).trim();
  return Country.findOne({
    $or: [{ code: value.toUpperCase() }, { name: new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }],
  }).lean();
};

/** Validate a postal code against the country's format. Returns an error message or null. */
export const postalCodeError = (country, value) => {
  if (!value || !country?.postalCode) return null;
  const { numeric, length, pattern, label } = country.postalCode;
  const v = String(value).trim();
  if (pattern) {
    try {
      if (!new RegExp(pattern).test(v)) return `${label} format is invalid`;
    } catch {
      /* bad pattern configured: skip */
    }
    return null;
  }
  if (numeric && !/^\d+$/.test(v)) return `${label} must contain digits only`;
  if (length && v.length !== length) return `${label} must be ${length} digits`;
  return null;
};

export default { seedLocations, ensureLocations, importCities, getCountry, findCountry, postalCodeError };

/**
 * Reject an address whose postal code does not match its country's format.
 * `fields` maps payload keys to the error path the client form understands,
 * e.g. { address: 'body.address', shippingAddress: 'body.shippingAddress' }.
 */
export const assertAddresses = async (payload, fields = { address: 'body.address' }) => {
  const errors = [];
  for (const [key, errorPath] of Object.entries(fields)) {
    const address = key ? payload?.[key] : payload;
    if (!address?.pincode) continue;
    const country = await findCountry(address.country);
    const message = postalCodeError(country, address.pincode);
    if (message) errors.push({ field: `${errorPath}.pincode`.replace(/^\./, ''), message });
  }
  if (errors.length) {
    const { AppError } = await import('../utils/errors.js');
    throw new AppError(errors[0].message, { status: 422, code: 'VALIDATION_ERROR', errors });
  }
};
