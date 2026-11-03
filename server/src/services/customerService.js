import Customer from '../models/Customer.js';
import State from '../models/State.js';
import Setting from '../models/Setting.js';
import { nextSeries } from '../utils/numberSeries.js';
import { ensureLocations, findCountry, postalCodeError } from './locationService.js';
import { escapeRegex } from '../utils/query.js';

/**
 * Customer master rules shared by the form API and the bulk import, so a
 * customer is validated the same way however it arrives.
 */

const PHONE = /^\+?\d[\d\s-]{5,18}\d$/;
const GSTIN_IN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_IN = /^[A-Z]{5}\d{4}[A-Z]$/;

// GSTIN starts with the GST state code of the registration.
const GST_STATE_CODES = {
  'jammu and kashmir': '01', 'himachal pradesh': '02', punjab: '03', chandigarh: '04', uttarakhand: '05',
  haryana: '06', delhi: '07', rajasthan: '08', 'uttar pradesh': '09', bihar: '10', sikkim: '11',
  'arunachal pradesh': '12', nagaland: '13', manipur: '14', mizoram: '15', tripura: '16', meghalaya: '17',
  assam: '18', 'west bengal': '19', jharkhand: '20', odisha: '21', chhattisgarh: '22', 'madhya pradesh': '23',
  gujarat: '24', 'dadra and nagar haveli and daman and diu': '26', maharashtra: '27', karnataka: '29', goa: '30',
  lakshadweep: '31', kerala: '32', 'tamil nadu': '33', puducherry: '34', 'andaman and nicobar islands': '35',
  telangana: '36', 'andhra pradesh': '37', ladakh: '38',
};

const digits = (v) => String(v || '').replace(/\D/g, '');
const blank = (a = {}) => !a.line1 && !a.line2 && !a.city && !a.state && !a.pincode;

/** Credit days implied by the payment terms (CUSTOM keeps what was entered). */
export const creditDaysFor = (terms, entered) => {
  if (terms === 'IMMEDIATE') return 0;
  const m = /^NET_(\d+)$/.exec(terms || '');
  return m ? Number(m[1]) : Number(entered || 0);
};

/** Next customer code from the company's numbering settings (Settings -> Document numbering). */
export const nextCustomerCode = async (companyId) => {
  const settings = await Setting.forCompany(companyId);
  const series = settings?.series?.customer || {};
  return nextSeries(companyId, 'CUSTOMER', { prefix: series.prefix || 'CUS', pad: Number(series.pad) || 5 });
};

/**
 * Check an address against the location master: known country, a state of
 * that country, a city and a postal code in the country's format. Returns the
 * address with canonical country/state names.
 */
const checkAddress = async (address = {}, path, errors) => {
  const out = { ...address };
  const country = await findCountry(address.country);
  if (!address.country) errors.push({ field: `${path}.country`, message: 'Country is required' });
  else if (!country) errors.push({ field: `${path}.country`, message: `Unknown country "${address.country}"` });
  else out.country = country.name;

  if (!address.state) errors.push({ field: `${path}.state`, message: 'State is required' });
  else if (country) {
    const state = await State.findOne({
      country: country.code,
      $or: [{ name: new RegExp(`^${escapeRegex(String(address.state).trim())}$`, 'i') }, { code: String(address.state).toUpperCase() }],
    }).lean();
    if (!state) errors.push({ field: `${path}.state`, message: `"${address.state}" is not a state of ${country.name}` });
    else out.state = state.name;
  }
  if (!String(address.city || '').trim()) errors.push({ field: `${path}.city`, message: 'City is required' });

  const pin = postalCodeError(country, address.pincode);
  if (pin) errors.push({ field: `${path}.pincode`, message: pin });
  return out;
};

/**
 * Validate and normalise one customer payload.
 * @param {object} input   - already schema-validated payload (create, or merged update)
 * @param {object} opts    - { isIndia, existingId }
 * @returns {{ data: object, errors: {field: string, message: string}[] }}
 */
export const checkCustomer = async (input, { isIndia = false, existingId = null } = {}) => {
  await ensureLocations();
  const errors = [];
  const data = { ...input };

  // ---- contact ----------------------------------------------------------------
  if (!data.phone) errors.push({ field: 'phone', message: 'Phone is required' });
  else if (!PHONE.test(data.phone) || digits(data.phone).length < 7 || digits(data.phone).length > 15) {
    errors.push({ field: 'phone', message: 'Enter a valid phone number (7-15 digits)' });
  }
  if (data.alternatePhone) {
    if (!PHONE.test(data.alternatePhone)) errors.push({ field: 'alternatePhone', message: 'Enter a valid phone number' });
    else if (digits(data.alternatePhone) === digits(data.phone)) {
      errors.push({ field: 'alternatePhone', message: 'Alternate phone must differ from the phone' });
    }
  }

  // ---- tax registration (India: GSTIN / PAN formats and consistency) ------------
  data.gstin = String(data.gstin || '').trim().toUpperCase();
  data.pan = String(data.pan || '').trim().toUpperCase();
  if (isIndia) {
    if (data.gstin && !GSTIN_IN.test(data.gstin)) {
      errors.push({ field: 'gstin', message: 'GSTIN must be 15 characters, e.g. 27AAAAA0000A1Z5' });
    }
    if (data.pan && !PAN_IN.test(data.pan)) errors.push({ field: 'pan', message: 'PAN must look like AAAAA0000A' });
    if (data.gstin && GSTIN_IN.test(data.gstin)) {
      const fromGstin = data.gstin.slice(2, 12);
      if (!data.pan) data.pan = fromGstin;
      else if (data.pan !== fromGstin) errors.push({ field: 'pan', message: 'PAN does not match the GSTIN' });
    }
  }

  // ---- addresses ----------------------------------------------------------------
  data.address = await checkAddress(data.address, 'address', errors);
  if (isIndia && data.gstin && GSTIN_IN.test(data.gstin) && data.address.state) {
    const code = GST_STATE_CODES[String(data.address.state).toLowerCase()];
    if (code && data.gstin.slice(0, 2) !== code) {
      errors.push({ field: 'gstin', message: `GSTIN state code ${data.gstin.slice(0, 2)} does not match ${data.address.state} (${code})` });
    }
  }
  if (data.shippingSameAsBilling !== false || blank(data.shippingAddress)) {
    data.shippingSameAsBilling = true;
    data.shippingAddress = { ...data.address };
  } else {
    data.shippingAddress = await checkAddress(data.shippingAddress, 'shippingAddress', errors);
  }

  // ---- credit -------------------------------------------------------------------
  data.paymentTerms = data.paymentTerms || 'IMMEDIATE';
  data.creditDays = creditDaysFor(data.paymentTerms, data.creditDays);
  if (data.paymentTerms === 'CUSTOM' && !(data.creditDays > 0)) {
    errors.push({ field: 'creditDays', message: 'Enter the credit days for custom terms' });
  }

  // ---- duplicates within the company --------------------------------------------
  const notSelf = existingId ? { _id: { $ne: existingId } } : {};
  if (data.gstin && (await Customer.exists({ gstin: data.gstin, ...notSelf }))) {
    errors.push({ field: 'gstin', message: 'Another customer already has this tax registration number' });
  }
  if (data.name && data.phone) {
    const sameNamePhone = await Customer.exists({
      name: new RegExp(`^${escapeRegex(String(data.name).trim())}$`, 'i'),
      phone: data.phone,
      ...notSelf,
    });
    if (sameNamePhone) errors.push({ field: 'name', message: 'A customer with this name and phone already exists' });
  }

  return { data, errors };
};

export default { checkCustomer, nextCustomerCode, creditDaysFor };
