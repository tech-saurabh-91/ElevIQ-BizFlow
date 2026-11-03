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
export function AddressFields({ register, errors, prefix = 'address', watch, setValue, disabled = false }) {
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

  const onCountry = (e) => {
    set('country', e.target.value);
    set('state', '');
    set('city', '');
    setTypingCity(false);
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
      <Field label="Country" error={err('country')}>
        <Select value={country?.name || countryValue} onChange={onCountry} error={!!err('country')} disabled={disabled}>
          <option value="">Select country</option>
          {!country && countryValue && <option value={countryValue}>{countryValue}</option>}
          {countries.map((c) => (
            <option key={c.code} value={c.name}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="State" error={err('state')}>
        <Select
          value={state?.name || stateValue}
          onChange={onState}
          error={!!err('state')}
          disabled={disabled || !country}
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

/** Date -> `<input type="date">` value. */
export const dateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

export default FormSection;
