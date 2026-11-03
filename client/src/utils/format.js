/**
 * Shared formatting helpers. Money is handled as plain numbers (already
 * rounded to 2dp on the server).
 */
export const APP_NAME = 'ElevIQ SFA';

/**
 * Workspace-wide formatting defaults. CompanyLayout calls `setFormatDefaults`
 * with the company's currency, locale, time zone and date format so every
 * screen formats the same way without threading them through props.
 */
const defaults = {
  currency: 'INR',
  locale: 'en-IN',
  timeZone: undefined, // browser zone until a company is loaded
  dateFormat: 'DD/MM/YYYY',
};

export const setFormatDefaults = (next = {}) => {
  Object.entries(next).forEach(([key, value]) => {
    if (value) defaults[key] = value;
  });
};

export const getFormatDefaults = () => ({ ...defaults });

/** Valid BCP-47 locale for Intl, falling back to `en`. */
const safeLocale = (locale) => {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length ? locale : 'en';
  } catch {
    return 'en';
  }
};

export const formatMoney = (value, currency, locale, { decimals = 2 } = {}) => {
  const n = Number(value || 0);
  const code = currency || defaults.currency;
  try {
    return new Intl.NumberFormat(safeLocale(locale || defaults.locale), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n);
  } catch {
    return `${code} ${n.toFixed(decimals)}`;
  }
};

export const formatNumber = (value, locale) =>
  new Intl.NumberFormat(safeLocale(locale || defaults.locale)).format(Number(value || 0));

export const formatCompact = (value, locale) =>
  new Intl.NumberFormat(safeLocale(locale || defaults.locale), { notation: 'compact', maximumFractionDigits: 1 }).format(
    Number(value || 0)
  );

const toDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Day / month / year of a date in the company time zone. */
const dateParts = (d) => {
  const parts = {};
  try {
    new Intl.DateTimeFormat('en-GB', {
      timeZone: defaults.timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .forEach((p) => {
        parts[p.type] = p.value;
      });
  } catch {
    parts.day = String(d.getDate()).padStart(2, '0');
    parts.month = String(d.getMonth() + 1).padStart(2, '0');
    parts.year = String(d.getFullYear());
    parts.hour = String(d.getHours()).padStart(2, '0');
    parts.minute = String(d.getMinutes()).padStart(2, '0');
  }
  return parts;
};

/** Date in the company's date format (DD/MM/YYYY, MM/DD/YYYY or YYYY-MM-DD). */
export const formatDate = (value) => {
  const d = toDate(value);
  if (!d) return '—';
  const { day, month, year } = dateParts(d);
  switch (defaults.dateFormat) {
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    default:
      return `${day}/${month}/${year}`;
  }
};

/** Time of day (HH:mm, 12h/24h per locale) in the company time zone. */
export const formatTime = (value) => {
  const d = toDate(value);
  if (!d) return '—';
  try {
    return d.toLocaleTimeString(safeLocale(defaults.locale), {
      timeZone: defaults.timeZone,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toLocaleTimeString();
  }
};

export const formatDateTime = (value) => {
  const d = toDate(value);
  if (!d) return '—';
  return `${formatDate(d)} ${formatTime(d)}`;
};

/** Short "12 Mar" / "Mar 26" style labels for chart axes, in the company locale. */
export const formatShortDate = (value, options = { day: '2-digit', month: 'short' }) => {
  const d = toDate(value);
  if (!d) return '';
  try {
    return d.toLocaleDateString(safeLocale(defaults.locale), { timeZone: defaults.timeZone, ...options });
  } catch {
    return d.toDateString();
  }
};

export const timeAgo = (value) => {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.round((Date.now() - then) / 1000);
  const units = [
    [60, 'sec'],
    [60, 'min'],
    [24, 'hr'],
    [7, 'day'],
    [4.35, 'wk'],
    [12, 'mo'],
    [Number.POSITIVE_INFINITY, 'yr'],
  ];
  let amount = secs;
  for (const [step, label] of units) {
    if (amount < step) return `${Math.round(amount)} ${label}${Math.round(amount) === 1 ? '' : 's'} ago`;
    amount /= step;
  }
  return 'just now';
};

export const initials = (name = '') =>
  String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

export const truncate = (s = '', n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const titleCase = (s = '') =>
  String(s)
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const classNames = { formatMoney, formatNumber, formatCompact };
export default { formatMoney, formatNumber, formatDate, formatDateTime, timeAgo, initials };
