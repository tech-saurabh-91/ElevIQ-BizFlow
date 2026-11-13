import State from '../models/State.js';
import { ensureLocations, findCountry } from './locationService.js';
import { AppError } from '../utils/errors.js';
import { escapeRegex } from '../utils/query.js';

/**
 * Contact and tax-registration rules for businesses (the company itself and
 * its suppliers). Customers run the same checks inside customerService.
 * The forms check these too, but the API must not trust the browser.
 */

export const PHONE_RX = /^\+?\d[\d\s-]{5,18}\d$/;
export const GSTIN_IN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_IN = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_IN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// GSTIN starts with the GST state code of the registration.
export const GST_STATE_CODES = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', punjab: '03', chandigarh: '04', uttarakhand: '05',
  haryana: '06', delhi: '07', rajasthan: '08', 'uttar pradesh': '09', bihar: '10', sikkim: '11',
  'arunachal pradesh': '12', nagaland: '13', manipur: '14', mizoram: '15', tripura: '16', meghalaya: '17',
  assam: '18', 'west bengal': '19', jharkhand: '20', odisha: '21', chhattisgarh: '22', 'madhya pradesh': '23',
  gujarat: '24', 'dadra and nagar haveli and daman and diu': '26', maharashtra: '27', karnataka: '29', goa: '30',
  lakshadweep: '31', kerala: '32', 'tamil nadu': '33', puducherry: '34', 'andaman and nicobar islands': '35',
  telangana: '36', 'andhra pradesh': '37', ladakh: '38',
};

const digits = (v) => String(v || '').replace(/\D/g, '');
const text = (v) => String(v ?? '').trim();
export const isIndiaCountry = (country) => !text(country) || ['IN', 'IND', 'INDIA'].includes(text(country).toUpperCase());

/** http(s) URL or a bare domain ("example.com/path"); never javascript:, data: etc. */
export const isWebsite = (value) => {
  const v = text(value);
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return /\.[a-z]{2,}$/i.test(u.hostname) || u.hostname === 'localhost';
    } catch {
      return false;
    }
  }
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(v);
};

/**
 * Collect rule violations.
 * @param {object} v       - the values: { phone, phones[], website, gstin, pan, ifsc, account, country, state }
 * @param {object} paths   - error path for each value key (only keys listed here are checked)
 * @param {Set}   [changed]- value keys the request actually changed; cross-field rules run when any input changed
 */
export const identityErrors = async (v, paths, changed) => {
  const errors = [];
  const touched = (...keys) => !changed || keys.some((k) => changed.has(k));
  const add = (key, message) => errors.push({ field: paths[key] || key, message });

  for (const key of Object.keys(paths).filter((k) => k === 'phone' || k.startsWith('phone'))) {
    const value = text(v[key]);
    if (value && touched(key) && (!PHONE_RX.test(value) || digits(value).length < 7 || digits(value).length > 15)) {
      add(key, 'Enter a valid phone number (7-15 digits)');
    }
  }
  if (paths.website && text(v.website) && touched('website') && !isWebsite(v.website)) {
    add('website', 'Enter a valid website, e.g. https://example.com');
  }

  // State must belong to the country.
  let stateName = text(v.state);
  if (paths.state && stateName && touched('state', 'country')) {
    await ensureLocations();
    const country = await findCountry(v.country || 'India');
    if (country) {
      const s = await State.findOne({
        country: country.code,
        $or: [{ name: new RegExp(`^${escapeRegex(stateName)}$`, 'i') }, { code: stateName.toUpperCase() }],
      }).lean();
      if (!s) add('state', `"${stateName}" is not a state of ${country.name}`);
      else stateName = s.name;
    }
  }

  if (!isIndiaCountry(v.country)) return errors;

  const gstin = text(v.gstin).toUpperCase();
  const pan = text(v.pan).toUpperCase();
  if (paths.gstin && gstin && touched('gstin') && !GSTIN_IN.test(gstin)) {
    add('gstin', 'GSTIN must be 15 characters, e.g. 27AAAAA0000A1Z5');
  }
  if (paths.pan && pan && touched('pan') && !PAN_IN.test(pan)) add('pan', 'PAN must look like AAAAA0000A');
  if (paths.pan && gstin && pan && GSTIN_IN.test(gstin) && PAN_IN.test(pan) && touched('gstin', 'pan') && gstin.slice(2, 12) !== pan) {
    add('pan', 'PAN does not match the GSTIN');
  }
  if (paths.gstin && gstin && GSTIN_IN.test(gstin) && stateName && touched('gstin', 'state')) {
    const code = GST_STATE_CODES[stateName.toLowerCase()];
    if (code && gstin.slice(0, 2) !== code) {
      add('gstin', `GSTIN state code ${gstin.slice(0, 2)} does not match ${stateName} (${code})`);
    }
  }
  const ifsc = text(v.ifsc).toUpperCase();
  if (paths.ifsc && ifsc && touched('ifsc') && !IFSC_IN.test(ifsc)) add('ifsc', 'IFSC must look like SBIN0001234');
  const account = text(v.account);
  if (paths.account && account && touched('account') && !/^\d{9,18}$/.test(account)) {
    add('account', 'Account number must be 9-18 digits');
  }
  return errors;
};

export const assertIdentity = async (values, paths, changed) => {
  const errors = await identityErrors(values, paths, changed);
  if (errors.length) throw new AppError(errors[0].message, { status: 422, code: 'VALIDATION_ERROR', errors });
};

/** The PAN is the middle of the GSTIN; fill it when only the GSTIN was given. */
export const panFromGstin = (gstin, pan) => {
  const g = text(gstin).toUpperCase();
  return !text(pan) && GSTIN_IN.test(g) ? g.slice(2, 12) : text(pan).toUpperCase();
};
