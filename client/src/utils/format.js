/**
 * Shared formatting helpers. Money is handled as plain numbers (already
 * rounded to 2dp on the server).
 */
export const APP_NAME = 'ElevIQ SFA';

export const formatMoney = (value, currency = 'INR', locale = 'en-IN') => {
  const n = Number(value || 0);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `₹${n.toFixed(2)}`;
  }
};

export const formatNumber = (value, locale = 'en-IN') =>
  new Intl.NumberFormat(locale).format(Number(value || 0));

export const formatCompact = (value, locale = 'en-IN') =>
  new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    Number(value || 0)
  );

export const formatDate = (value, locale = 'en-IN') => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatDateTime = (value, locale = 'en-IN') => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
