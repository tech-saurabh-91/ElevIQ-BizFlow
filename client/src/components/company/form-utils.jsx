import { useState } from 'react';
import { Field, Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';
import { useCountries, useStates, useCities, findCountry, findState, postalCodeError } from '@/hooks/useLocations';

/** Group of fields with a small heading, rendered inside the master-data forms. */
export function FormSection({ title, description, children, className }) {
  return (
    <section className="space-y-3">
      {(title || description) && (
        <div>
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>
    </section>
  );
}

const OTHER_CITY = '__other__';

/**
 * Standard address block bound to react-hook-form.
 *
 * Country -> State -> City are linked dropdowns fed by the platform location
 * master; picking a country narrows the states, a state narrows the cities.
 * Values are stored as names (as before) so existing addresses keep working.
 * The postal code follows the country's format (e.g. India: 6 digits only).
 *
 * `prefix` is the nested object path (`address`, `shippingAddress`), or '' for
 * flat forms whose fields are named line1/city/state/... directly.
 */
export function AddressFields({
  register,
  errors,
  prefix = 'address',
  watch,
  setValue,
  disabled = false,
  lockedFields = {},
  onCountryChange,
}) {
  const path = (key) => (prefix ? `${prefix}.${key}` : key);
  const err = (key) => (prefix ? errors?.[prefix]?.[key] : errors?.[key])?.message;
  const set = (key, value) => setValue(path(key), value, { shouldDirty: true, shouldValidate: false });

  const countryValue = watch(path('country')) || '';
  const stateValue = watch(path('state')) || '';
  const cityValue = watch(path('city')) || '';
  const pincode = watch(path('pincode')) || '';

  const { data: countries = [] } = useCountries();
  const country = findCountry(countries, countryValue);
  const { data: states = [], isFetching: statesLoading } = useStates(country?.code);
  const state = findState(states, stateValue);
  const { data: cities = [], isFetching: citiesLoading } = useCities(country?.code, state?.code);

  const cityListed = !cityValue || cities.some((c) => c.name.toLowerCase() === cityValue.toLowerCase());
  const [typingCity, setTypingCity] = useState(false);
  const freeCity = typingCity || !cities.length || !cityListed;

  const postal = country?.postalCode || {};
  const postalLabel = postal.label || 'Postal code';
  const pinHint = postalCodeError(country, pincode);
  const pinField = register(path('pincode'));

  // `lockedFields` maps country/state to a reason; the value stays in the form
  // (so it is still submitted) but cannot be changed.
  const lock = (key) =>
    lockedFields[key]
      ? { 'aria-disabled': true, tabIndex: -1, className: 'pointer-events-none bg-muted/60 text-muted-foreground' }
      : {};

  const onCountry = (e) => {
    set('country', e.target.value);
    set('state', '');
    set('city', '');
    setTypingCity(false);
    onCountryChange?.(findCountry(countries, e.target.value));
  };
  const onState = (e) => {
    set('state', e.target.value);
    set('city', '');
    setTypingCity(false);
  };
  const onCity = (e) => {
    if (e.target.value === OTHER_CITY) {
      setTypingCity(true);
      set('city', '');
      return;
    }
    set('city', e.target.value);
  };
  const onPincode = (e) => {
    // Digits-only countries drop anything else as it is typed or pasted.
    if (postal.numeric) e.target.value = e.target.value.replace(/\D/g, '');
    if (postal.length) e.target.value = e.target.value.slice(0, postal.length);
    pinField.onChange(e);
  };

  return (
    <>
      <Field label="Address line 1" error={err('line1')} className="sm:col-span-2">
        <Input {...register(path('line1'))} error={!!err('line1')} placeholder="Street / building" disabled={disabled} />
      </Field>
      <Field label="Address line 2" error={err('line2')} className="sm:col-span-2">
        <Input {...register(path('line2'))} error={!!err('line2')} placeholder="Area / landmark" disabled={disabled} />
      </Field>
      <Field label="Country" error={err('country')} hint={lockedFields.country}>
        <Select
          value={country?.name || countryValue}
          onChange={onCountry}
          error={!!err('country')}
          disabled={disabled}
          {...lock('country')}
        >
          <option value="">Select country</option>
          {!country && countryValue && <option value={countryValue}>{countryValue}</option>}
          {countries.map((c) => (
            <option key={c.code} value={c.name}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="State" error={err('state')} hint={lockedFields.state}>
        <Select
          value={state?.name || stateValue}
          onChange={onState}
          error={!!err('state')}
          disabled={disabled || !country}
          {...lock('state')}
        >
          <option value="">{!country ? 'Select country first' : statesLoading ? 'Loading…' : 'Select state'}</option>
          {!state && stateValue && <option value={stateValue}>{stateValue}</option>}
          {states.map((s) => (
            <option key={s.code} value={s.name}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="City"
        error={err('city')}
        hint={freeCity && cities.length ? (
          <button type="button" className="text-brand-600 hover:underline" onClick={() => { setTypingCity(false); set('city', ''); }}>
            Pick from list
          </button>
        ) : undefined}
      >
        {freeCity ? (
          <Input
            value={cityValue}
            onChange={(e) => set('city', e.target.value)}
            error={!!err('city')}
            placeholder={state ? 'Type city name' : 'City'}
            disabled={disabled}
          />
        ) : (
          <Select value={cityValue} onChange={onCity} error={!!err('city')} disabled={disabled || !state}>
            <option value="">{!state ? 'Select state first' : citiesLoading ? 'Loading…' : 'Select city'}</option>
            {cities.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
            <option value={OTHER_CITY}>Other (type it)</option>
          </Select>
        )}
      </Field>
      <Field label={postalLabel} error={err('pincode') || (pincode && pinHint) || undefined}>
        <Input
          {...pinField}
          onChange={onPincode}
          inputMode={postal.numeric ? 'numeric' : 'text'}
          maxLength={postal.numeric ? undefined : postal.length || 12}
          error={!!(err('pincode') || (pincode && pinHint))}
          placeholder={postal.length ? `${postal.length} digits` : ''}
          disabled={disabled}
        />
      </Field>
    </>
  );
}

/** Footer row used by every modal form. */
export function FormActions({ onCancel, loading, submitLabel = 'Save', cancelLabel = 'Cancel', children }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
      {children}
      <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
        {cancelLabel}
      </Button>
      <Button type="submit" loading={loading}>
        {submitLabel}
      </Button>
    </div>
  );
}

/** '' / null -> undefined so the API never receives empty reference ids. */
export const opt = (value) => (value === '' || value == null ? undefined : value);

/** '' / null -> undefined, otherwise a Number (never NaN). */
export const num = (value) => {
  if (value === '' || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Number -> string for form defaults.
 * Numeric inputs are kept as strings in React Hook Form so validation messages
 * stay friendly; a saved record returns real numbers from the API, which would
 * otherwise fail `z.string()` when the edit form re-hydrates.
 */
export const numInput = (value, fallback = '') =>
  value === '' || value == null ? fallback : String(value);

/** Comma / newline separated text -> trimmed unique string array. */
export const csv = (value) =>
  String(value || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

const pad2 = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * Date -> `<input type="date">` value, in the browser's own calendar day.
 * (toISOString() is UTC: in India a saved date showed one day earlier.)
 * A plain 'YYYY-MM-DD' string is kept as it is.
 */
export const dateInput = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : localDay(d);
};

/** Today as an `<input type="date">` value (for min / max). */
export const todayInput = () => localDay(new Date());

/** 'YYYY-MM-DD' shifted by n days (n may be negative). */
export const shiftDateInput = (value, n) => {
  const base = value ? new Date(`${value}T12:00:00`) : new Date();
  base.setDate(base.getDate() + n);
  return localDay(base);
};

/**
 * Zod refinements for 'YYYY-MM-DD' strings. Empty strings pass (pair them
 * with a required rule where the date is mandatory).
 */
export const notFutureDate = (v) => !v || v <= todayInput();
export const notPastDate = (v) => !v || v >= todayInput();

export default FormSection;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Financial year start by country; everything else runs January-December.
const FY_START = { IN: 4, GB: 4, NZ: 4, JP: 4, HK: 4, ZA: 3, AU: 7, PK: 7, BD: 7, EG: 7, KE: 7 };

/** Defaults a newly registered company takes from its country. */
export const countryLocaleDefaults = (country) =>
  country
    ? {
        currency: country.currency || '',
        currencySymbol: country.currencySymbol || country.currency || '',
        timezone: country.timezones?.[0] || 'UTC',
        financialYearStartMonth: String(FY_START[country.code] || 1),
        taxRegime: country.tax?.regime || 'VAT',
      }
    : null;

/**
 * Currency / time zone / financial year (and, at registration, tax regime).
 * These are captured when a company is registered and freeze once it has
 * transactions: pass `locked` with a reason to show them read-only.
 */
export function LocaleFields({ register, watch, setValue, errors, country, showRegime = false, locked = '' }) {
  const { data: countries = [] } = useCountries();
  const currencies = [];
  const seen = new Set();
  countries.forEach((c) => {
    if (c.currency && !seen.has(c.currency)) {
      seen.add(c.currency);
      currencies.push({ code: c.currency, symbol: c.currencySymbol || c.currency });
    }
  });
  currencies.sort((a, b) => a.code.localeCompare(b.code));

  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['UTC'];
  }
  const local = country?.timezones || [];
  const currency = watch('currency');
  const lockProps = locked
    ? { 'aria-disabled': true, tabIndex: -1, className: 'pointer-events-none bg-muted/60 text-muted-foreground' }
    : {};

  const onCurrency = (e) => {
    setValue('currency', e.target.value, { shouldDirty: true });
    const match = currencies.find((c) => c.code === e.target.value);
    if (match) setValue('currencySymbol', match.symbol, { shouldDirty: true });
  };

  return (
    <>
      <Field label="Currency" error={errors?.currency?.message} hint={locked || undefined}>
        <Select value={currency || ''} onChange={onCurrency} {...lockProps}>
          <option value="">Select currency</option>
          {currency && !seen.has(currency) && <option value={currency}>{currency}</option>}
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} ({c.symbol})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Time zone" error={errors?.timezone?.message}>
        <Select {...register('timezone')}>
          {local.length > 0 && (
            <optgroup label={country.name}>
              {local.map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="All time zones">
            {zones
              .filter((tz) => !local.includes(tz))
              .map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
          </optgroup>
        </Select>
      </Field>
      <Field label="Financial year starts" error={errors?.financialYearStartMonth?.message} hint={locked || undefined}>
        <Select {...register('financialYearStartMonth')} {...lockProps}>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </Select>
      </Field>
      {showRegime && (
        <Field label="Tax regime" error={errors?.taxRegime?.message} hint={country ? `${country.name} default` : undefined}>
          <Select {...register('taxRegime')}>
            <option value="GST">GST</option>
            <option value="VAT">VAT</option>
            <option value="SALES_TAX">Sales tax</option>
            <option value="NONE">No tax</option>
          </Select>
        </Field>
      )}
    </>
  );
}

// ---- Shared field rules (mirror server/src/services/customerService.js) ----
export const GSTIN_IN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_IN = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_IN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const PHONE_RX = /^\+?\d[\d\s-]{5,18}\d$/;
export const digitsOf = (v) => String(v || '').replace(/\D/g, '');

/** True when an address/company country means India (code or name, or not set yet). */
export const isIndiaCountry = (country) => !country || ['IN', 'IND', 'INDIA'].includes(String(country).trim().toUpperCase());

/**
 * Common checks for a contact + tax block inside a zod superRefine:
 *   checkContact(v, ctx, { phone: ['phone'], gstin: 'gstin', pan: 'pan', ifsc: ['bank', 'ifsc'] }, india)
 * A path is a field name or an array for a nested field; `phone` may list
 * several. Empty values pass; pair with required rules where mandatory.
 */
export const checkContact = (v, ctx, paths, india = true) => {
  const get = (path) => (Array.isArray(path) ? path.reduce((o, k) => o?.[k], v) : v?.[path]);
  const at = (path) => (Array.isArray(path) ? path : [path]);
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path: at(path), message });
  [].concat(paths.phone || []).forEach((p) => {
    const value = String(get(p) || '').trim();
    if (!value) return;
    const d = digitsOf(value).length;
    if (!PHONE_RX.test(value) || d < 7 || d > 15) issue(p, 'Enter a valid phone number (7-15 digits)');
  });
  if (!india) return;
  const read = (path) => String((path && get(path)) || '').trim().toUpperCase();
  const gstin = read(paths.gstin);
  const pan = read(paths.pan);
  if (gstin && !GSTIN_IN.test(gstin)) issue(paths.gstin, 'GSTIN must be 15 characters, e.g. 27AAAAA0000A1Z5');
  if (pan && !PAN_IN.test(pan)) issue(paths.pan, 'PAN must look like AAAAA0000A');
  if (gstin && pan && GSTIN_IN.test(gstin) && PAN_IN.test(pan) && gstin.slice(2, 12) !== pan) issue(paths.pan, 'PAN does not match the GSTIN');
  const ifsc = read(paths.ifsc);
  if (ifsc && !IFSC_IN.test(ifsc)) issue(paths.ifsc, 'IFSC must look like SBIN0001234');
  const account = read(paths.account);
  if (account && !/^\d{9,18}$/.test(account)) issue(paths.account, 'Account number must be 9-18 digits');
};
