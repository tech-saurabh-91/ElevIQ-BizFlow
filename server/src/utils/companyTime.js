import dayjs from 'dayjs';
import { startOfDay, dayKey, DEFAULT_TZ } from '../services/fieldForceService.js';

/**
 * "Today" and "this month" for a company, in its own timezone.
 *
 * Servers run on UTC, so dayjs().startOf('day') is UTC midnight - for an
 * Indian company that is 05:30 IST, and between midnight and 05:30 IST the
 * server is still on yesterday. Everything that says "today" or "this month"
 * to a user goes through here instead.
 */
export const tzOf = (req) => req?.company?.timezone || req?.settings?.timezone || DEFAULT_TZ;

export const companyToday = (tz = DEFAULT_TZ, now = new Date()) => {
  const key = dayKey(now, tz); // YYYY-MM-DD, company local
  const today = startOfDay(key, tz);
  return {
    key,
    today,
    tomorrow: dayjs(today).add(1, 'day').toDate(),
    monthStart: startOfDay(`${key.slice(0, 8)}01`, tz),
  };
};

/** Start of a company-local calendar day given as YYYY-MM-DD. */
export const companyDayStart = (key, tz = DEFAULT_TZ) => startOfDay(key, tz);

export default companyToday;
