import dayjs from 'dayjs';
import Company from '../models/Company.js';
import Notification from '../models/Notification.js';
import { withTenant, withoutTenant } from '../middlewares/tenant.js';
import { yearEndState } from '../services/yearCloseService.js';
import { notifyPermission } from '../services/notifyService.js';
import logger from '../utils/logger.js';

// Weekly for the first two months after the year ended, then every four weeks.
const gapDays = (daysSinceEnd) => (daysSinceEnd < 56 ? 7 : 28);

/**
 * Year-end reminders for the people who close the books ("books.close"):
 *   - once, when the current year has 15 days or less to go;
 *   - when a year has ended but is not closed: on the first day, then once a
 *     week for two months and every four weeks after that, until it is closed.
 * Reminders are keyed on entityType and spaced by the last one sent, so
 * running the job more than once a day is harmless.
 */
export const runYearEndReminders = async (now = new Date()) => {
  const companies = await withoutTenant(() => Company.find({ status: { $in: ['ACTIVE', 'TRIAL'] }, isDeleted: { $ne: true } }).select('_id timezone financialYearStartMonth booksClosedThrough').skipTenant().lean());
  let sent = 0;
  for (const company of companies) {
    try {
      await withTenant(company._id, async () => {
        const state = await yearEndState(company, now);
        const send = async (key, message) => {
          if (await Notification.exists({ entityType: key })) return;
          await notifyPermission(company._id, 'books.close', { type: 'SYSTEM', link: '/app/year-closing', entityType: key, ...message });
          sent += 1;
        };
        if (state.ended) {
          const key = `YEAR_END:${state.ended.tag}:ENDED`;
          const last = await Notification.findOne({ entityType: key }).sort({ createdAt: -1 }).select('createdAt').lean();
          const due = !last || dayjs(now).diff(dayjs(last.createdAt), 'day') >= gapDays(state.ended.daysSinceEnd);
          if (due) {
            await notifyPermission(company._id, 'books.close', {
              type: 'SYSTEM',
              link: '/app/year-closing',
              entityType: key,
              title: `${state.ended.label} has ended - close the books`,
              body: `${state.ended.label} ended on ${dayjs(state.ended.endDay).format('DD/MM/YYYY')}. Finish the checklist on Year Closing and close the year. Until then only admins and accountants can enter documents dated in it.`,
              priority: 'HIGH',
            });
            sent += 1;
          }
        } else if (state.dueSoon && state.current.daysLeft >= 0) {
          await send(`YEAR_END:${state.current.tag}:DUE`, {
            title: `${state.current.label} ends in ${state.current.daysLeft} day${state.current.daysLeft === 1 ? '' : 's'}`,
            body: `${state.current.label} ends on ${dayjs(state.current.endDay).format('DD/MM/YYYY')}. Plan the stock count, clear draft documents and pending approvals, and close the year once the last bills are in.`,
          });
        }
      });
    } catch (err) {
      logger.warn?.(`year-end reminder failed for ${company._id}: ${err.message}`);
    }
  }
  return { companies: companies.length, sent };
};

export default runYearEndReminders;
