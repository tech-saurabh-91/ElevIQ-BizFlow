import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, Truck } from 'lucide-react';

import api from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * A field salesman's working day on the client (mirror of
 * server/src/services/fieldDayService.js): mark in -> work -> (van) day
 * cashout approved -> mark out. While the day is blocked everything stays
 * visible; only booking is held back (with a banner saying why).
 */

const CASHOUT_LABEL = {
  NONE: 'not submitted',
  SUBMITTED: 'waiting for manager approval',
  REJECTED: 'rejected - submit again',
  APPROVED: 'approved',
};

/** Pages that already show the day status themselves. */
const OWN_BANNER = ['/app/sales', '/app/attendance'];

export const useFieldDay = () => {
  const user = useAuthStore((s) => s.user);
  const isField = user?.role === 'SALESMAN';
  const query = useQuery({
    queryKey: ['company', 'attendance', 'today'],
    queryFn: async () => (await api.get('/v1/field-force/attendance/today')).data?.data ?? null,
    enabled: isField,
    refetchOnWindowFocus: true,
  });
  const fd = query.data?.fieldDay || {};
  return {
    isField,
    isLoading: isField && query.isLoading,
    blocked: isField ? fd.blocked || null : null,
    previousOpen: fd.previousOpen || null,
    cashout: fd.cashout || null,
    attendance: query.data?.attendance || null,
    refetch: query.refetch,
  };
};

const actionFor = (code) =>
  code === 'DAY_CASHOUT_PENDING'
    ? { to: '/app/my-van', label: 'Open day cashout', icon: Truck }
    : code === 'DAY_ENDED'
      ? null
      : { to: '/app/attendance', label: code === 'ATTENDANCE_OUT_PENDING' ? 'Mark out now' : 'Mark attendance', icon: CalendarCheck };

/** Inline banner: what blocks the day, or the cashout still due before mark out. */
export function FieldDayBanner({ day }) {
  const navigate = useNavigate();
  if (!day?.isField) return null;
  if (day.blocked) {
    const action = actionFor(day.blocked.code);
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 border-warning/50 bg-warning/10 p-4">
        <p className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          {day.blocked.message}
        </p>
        {action && (
          <Button size="sm" onClick={() => navigate(action.to)}>
            <action.icon className="h-4 w-4" /> {action.label}
          </Button>
        )}
      </Card>
    );
  }
  if (day.cashout && day.cashout.status !== 'APPROVED') {
    return (
      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Van {day.cashout.van?.code}: today&apos;s day cashout is {CASHOUT_LABEL[day.cashout.status] || day.cashout.status}. It must be approved before you mark out.
      </p>
    );
  }
  return null;
}

/**
 * Layout gate: a salesman whose day is not open still sees every page; a
 * banner on top says why nothing can be booked (and the way out), and the
 * booking buttons are hidden (authStore.can). Sales visit shows its own banner.
 */
export function FieldDayGate({ pathname, children }) {
  const day = useFieldDay();
  const setBlocked = useAuthStore((s) => s.setFieldDayBlocked);
  const blocked = Boolean(day.blocked);
  useEffect(() => {
    setBlocked(blocked);
  }, [blocked, setBlocked]);
  useEffect(() => () => setBlocked(false), [setBlocked]);
  const ownBanner = OWN_BANNER.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  return (
    <>
      {blocked && !ownBanner && (
        <div className="mb-4">
          <FieldDayBanner day={day} />
        </div>
      )}
      {children}
    </>
  );
}

export { CASHOUT_LABEL };
