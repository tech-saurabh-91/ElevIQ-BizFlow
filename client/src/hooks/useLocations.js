import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';
import { useAuthStore } from '@/store/authStore';

/**
 * Location master (Country -> State -> City) for address pickers.
 * Served by /api/locations for every signed-in user; cached for the session
 * because the master changes rarely.
 */
const STALE = 30 * 60 * 1000;

const fetchList = async (url) => {
  const res = await api.get(url);
  return res.data?.data || [];
};

export const useCountries = () =>
  useQuery({
    queryKey: ['locations', 'countries'],
    queryFn: () => fetchList('/locations/countries'),
    staleTime: STALE,
  });

export const useStates = (countryCode) =>
  useQuery({
    queryKey: ['locations', 'states', countryCode],
    queryFn: () => fetchList(`/locations/countries/${countryCode}/states`),
    enabled: Boolean(countryCode),
    staleTime: STALE,
  });

export const useCities = (countryCode, stateCode) =>
  useQuery({
    queryKey: ['locations', 'cities', countryCode, stateCode],
    queryFn: () => fetchList(`/locations/countries/${countryCode}/states/${stateCode}/cities`),
    enabled: Boolean(countryCode && stateCode),
    staleTime: STALE,
  });

/** Match a stored country value (name or ISO code) to a country row. */
export const findCountry = (countries = [], value) => {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  return countries.find((c) => c.code.toLowerCase() === v || c.name.toLowerCase() === v) || null;
};

/** Match a stored state value (name or code) to a state row. */
export const findState = (states = [], value) => {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  return states.find((s) => s.code.toLowerCase() === v || s.name.toLowerCase() === v) || null;
};

/** Client-side mirror of the server postal code check. Returns a message or null. */
export const postalCodeError = (country, value) => {
  if (!value || !country?.postalCode) return null;
  const { numeric, length, pattern, label = 'Postal code' } = country.postalCode;
  const v = String(value).trim();
  if (pattern) {
    try {
      return new RegExp(pattern).test(v) ? null : `${label} format is invalid`;
    } catch {
      return null;
    }
  }
  if (numeric && !/^\d+$/.test(v)) return `${label} must contain digits only`;
  if (length && v.length !== length) return `${label} must be ${length} digits`;
  return null;
};

/**
 * Tax wording for the signed-in company: the document tax label (GST, VAT...)
 * and the tax registration label of its country (GSTIN, TRN, VAT number...).
 */
export const useTaxLabels = () => {
  const company = useAuthStore((s) => s.company);
  const settings = useAuthStore((s) => s.settings);
  const { data: countries = [] } = useCountries();
  const country = findCountry(countries, company?.country);
  const tax = settings?.tax || {};
  const taxLabel = tax.taxLabel || country?.tax?.label || 'Tax';
  return {
    tax: { regime: tax.regime || 'GST', enableCgstSgst: tax.enableCgstSgst, label: taxLabel },
    taxLabel,
    taxIdLabel: country?.tax?.taxIdLabel || 'Tax ID',
    country,
  };
};
