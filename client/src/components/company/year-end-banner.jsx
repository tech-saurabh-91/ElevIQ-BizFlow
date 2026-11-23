import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Lock } from 'lucide-react';

import api from '@/api/client';
import { usePermissions } from '@/hooks/usePermissions';
import { formatDate } from '@/utils/format';

/**
 * Year-end banner on the home screen for the people who keep the books:
 * "the year ends in N days" in the last two weeks, and "the year has ended -
 * close it" until it is closed.
 */
export default function YearEndBanner() {
  const { can } = usePermissions();
  const allowed = can('books.view');
  const { data } = useQuery({
    queryKey: ['financial-years', 'status'],
    queryFn: async () => (await api.get('/v1/financial-years/status')).data.data,
    enabled: allowed,
    staleTime: 10 * 60_000,
    retry: false,
  });
  if (!allowed || !data) return null;

  if (data.ended) {
    const { label, endDay } = data.ended;
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="text-sm">
            <p className="font-semibold">{label} has ended - close the books</p>
            <p className="text-muted-foreground">
              It ended on {formatDate(endDay)}. Until it is closed, only admins and accountants can
              enter documents dated in it. Finish the checklist and close the year.
            </p>
          </div>
        </div>
        <Link
          to="/app/year-closing"
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Open Year Closing
        </Link>
      </div>
    );
  }

  if (data.dueSoon && data.current.daysLeft >= 0) {
    const { label, endDay, daysLeft } = data.current;
    return (
      <div className="flex items-start gap-3 rounded-xl border border-brand-500/30 bg-brand-500/5 p-4 text-sm">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
        <div>
          <p className="font-semibold">
            {label} ends{' '}
            {daysLeft === 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`} (
            {formatDate(endDay)})
          </p>
          <p className="text-muted-foreground">
            Plan the stock count, clear draft documents and pending approvals.{' '}
            <Link to="/app/year-closing" className="font-medium text-brand-600 hover:underline">
              See the year-end checklist
            </Link>
          </p>
        </div>
      </div>
    );
  }
  return null;
}
