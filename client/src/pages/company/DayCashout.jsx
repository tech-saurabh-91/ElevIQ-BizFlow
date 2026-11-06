import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Truck } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/misc';
import { ErrorAlert } from '@/components/ui/alert';
import { DayCloseDialog } from '@/components/company/VanPanels';
import { CASHOUT_LABEL, useFieldDay } from '@/components/company/FieldDay';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';

/**
 * Day cashout: a van salesman's end-of-day count and cash hand-over. It goes
 * to a manager for approval; marking out needs it approved.
 */

const TONE = { SUBMITTED: 'warning', APPROVED: 'success', REJECTED: 'destructive' };
const LABEL = { SUBMITTED: 'Waiting approval', APPROVED: 'Approved', REJECTED: 'Rejected' };

export default function DayCashout() {
  const { company } = useAuth();
  const day = useFieldDay();
  const [closing, setClosing] = useState(false);
  const van = useQuery({
    queryKey: ['company', 'vans', 'mine'],
    queryFn: async () => (await api.get('/v1/vans/mine')).data?.data ?? null,
  });
  const history = useQuery({
    queryKey: ['company', 'day-cashouts', 'mine'],
    queryFn: async () => (await api.get('/v1/vans/day-closes')).data?.data ?? [],
    enabled: Boolean(van.data),
  });
  const data = van.data;
  const money = (v) => formatMoney(v, company?.currency);
  const today = day.cashout;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Day cashout"
        description="Count your van and hand over the cash at the end of the day. A manager approves it before you mark out."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Day cashout' }]}
        actions={
          data ? (
            <Button onClick={() => setClosing(true)}>
              <Truck className="h-4 w-4" /> Submit day cashout
            </Button>
          ) : null
        }
      />
      {van.isLoading ? (
        <LoadingState label="Loading your van…" />
      ) : van.isError ? (
        <ErrorAlert title="Could not load your van" message={apiError(van.error).message} />
      ) : !data ? (
        <Card>
          <EmptyState title="No van assigned" description="Day cashout is for salesmen selling from a van." />
        </Card>
      ) : (
        <>
          {data.pendingDays.length > 0 && (
            <ErrorAlert
              title="Day cashout pending"
              message={`Submit the day cashout for ${data.pendingDays.join(', ')} - you cannot mark in or sell until it is approved.`}
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {data.van.name} <Badge tone="info">{data.van.vehicleNumber || data.van.code}</Badge>
              </CardTitle>
              <CardDescription>
                Today&apos;s cashout: <strong>{CASHOUT_LABEL[today?.status] || CASHOUT_LABEL.NONE}</strong>
                {today?.rejectReason ? ` (${today.rejectReason})` : ''}
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Earlier cashouts</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {history.isLoading ? (
                <LoadingState label="Loading…" />
              ) : !(history.data || []).length ? (
                <EmptyState compact title="No cashouts yet" description="Your submitted day cashouts appear here." />
              ) : (
                <ul className="divide-y">
                  {history.data.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium">{formatDate(`${r.day}T12:00:00`)}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.warehouse?.code} · cash {money(r.cashDeposited)} of {money(r.cashExpected)}
                          {r.stockVarianceQty ? ` · stock diff ${formatNumber(r.stockVarianceQty)}` : ''}
                        </p>
                        {r.rejectReason && <p className="text-xs text-destructive">Rejected: {r.rejectReason}</p>}
                      </div>
                      <Badge tone={TONE[r.status] || 'success'}>{LABEL[r.status] || 'Approved'}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {closing && data && (
        <DayCloseDialog
          van={{ ...data.van }}
          onClose={() => {
            setClosing(false);
            history.refetch();
            day.refetch();
          }}
        />
      )}
    </div>
  );
}
