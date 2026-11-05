import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, FileText, IndianRupee, LogIn, LogOut, MapPin, Phone, Route as RouteIcon, ShoppingCart } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/misc';
import { ErrorAlert } from '@/components/ui/alert';
import { usePermissions } from '@/hooks/usePermissions';
import { CheckOutDialog, captureGps, noOrderReasonLabel, outcomeLabel } from '@/components/company/fieldforce-shared';
import { formatMoney, formatTime } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * The salesman's day: routes planned for today, their customers, check in at a
 * shop, book an order / invoice / payment, check out (reason if nothing booked).
 */

const OUTCOME_TONE = { ORDER_TAKEN: 'success', INVOICED: 'success', PAYMENT_COLLECTED: 'info', NO_ORDER: 'warning', CUSTOMER_UNAVAILABLE: 'muted' };

function VisitChip({ visit }) {
  if (!visit) return <Badge tone="outline">Not visited</Badge>;
  if (visit.status === 'IN_PROGRESS') return <Badge tone="info">Checked in {formatTime(visit.checkInAt)}</Badge>;
  if (visit.status !== 'COMPLETED') return <Badge tone="muted">{outcomeLabel(visit.status)}</Badge>;
  const extra = visit.invoiceNo || visit.orderNo || (visit.noOrderReason ? noOrderReasonLabel(visit.noOrderReason) : '');
  return (
    <Badge tone={OUTCOME_TONE[visit.outcome] || 'muted'}>
      {outcomeLabel(visit.outcome)}
      {extra ? ` · ${extra}` : ''}
    </Badge>
  );
}

export default function MyBeat() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [routeId, setRouteId] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [checkingOut, setCheckingOut] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'beat', 'mine'],
    queryFn: async () => (await api.get('/v1/beat-plans/mine')).data?.data,
  });
  const routes = data?.routes || [];
  const open = data?.openVisit;

  useEffect(() => {
    if (routes.length && !routes.some((r) => r.id === routeId)) setRouteId(routes[0].id);
  }, [routes, routeId]);

  const route = routes.find((r) => r.id === routeId);
  const customers = (route?.customers || []).filter((c) => !search || `${c.name} ${c.code} ${c.phone}`.toLowerCase().includes(search.toLowerCase()));
  const done = (route?.customers || []).filter((c) => c.visit?.status === 'COMPLETED').length;
  const openCustomer = open && routes.flatMap((r) => r.customers).find((c) => c.visit?.id === open.id);

  const checkIn = async (customer) => {
    setBusy(customer.id);
    try {
      const gps = await captureGps();
      const body = { customerId: customer.id, route: route?.id };
      if (gps) {
        body.location = { lat: gps.lat, lng: gps.lng };
        if (gps.accuracy != null) body.accuracy = gps.accuracy;
      }
      const res = await api.post('/v1/beat-plans/check-in', body);
      toast.success(res.data?.message || 'Checked in');
      queryClient.invalidateQueries({ queryKey: ['company', 'beat'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'visits'] });
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="My beat"
        description={data?.day ? `Today's route plan · ${data.day}` : "Today's route plan"}
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'My beat' }]}
      />

      {isLoading ? (
        <LoadingState label="Loading your beat…" />
      ) : isError ? (
        <ErrorAlert title="Could not load your beat" message={apiError(error).message} />
      ) : (
        <>
          {open && (
            <Card className="border-brand-500/40 bg-brand-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Checked in since {formatTime(open.checkInAt)}</p>
                  <p className="text-lg font-semibold">{openCustomer?.name || open.visitNo}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {openCustomer && can('orders.create') && (
                    <Button variant="outline" size="sm" onClick={() => navigate(`/app/orders/new?customerId=${openCustomer.id}`)}>
                      <ShoppingCart className="h-4 w-4" /> Order
                    </Button>
                  )}
                  {openCustomer && can('invoices.create') && (
                    <Button variant="outline" size="sm" onClick={() => navigate(`/app/invoices/new?customerId=${openCustomer.id}`)}>
                      <FileText className="h-4 w-4" /> Invoice
                    </Button>
                  )}
                  {openCustomer && can('payments.create') && (
                    <Button variant="outline" size="sm" onClick={() => navigate(`/app/payments/new?customerId=${openCustomer.id}`)}>
                      <IndianRupee className="h-4 w-4" /> Payment
                    </Button>
                  )}
                  <Button size="sm" onClick={() => setCheckingOut({ ...open, customerName: openCustomer?.name || '' })}>
                    <LogOut className="h-4 w-4" /> Check out
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {!routes.length ? (
            <Card>
              <EmptyState icon="empty" title="No route planned for today" description="Ask your manager to plan a beat for you in Beat Plan." />
            </Card>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Today's routes">
                {routes.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="tab"
                    aria-selected={r.id === routeId}
                    onClick={() => setRouteId(r.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      r.id === routeId ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent'
                    )}
                  >
                    <RouteIcon className="h-4 w-4" />
                    {r.name}
                    <span className="text-xs text-muted-foreground">{r.customers.length} shops</span>
                  </button>
                ))}
              </div>

              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                  <p className="text-sm text-muted-foreground">
                    {done} of {route?.customers.length || 0} visited
                  </p>
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shop…" className="h-9 w-full sm:w-64" aria-label="Search customers" />
                </div>
                {!customers.length ? (
                  <EmptyState icon="empty" title="No customers" description="This route has no active customers. Add them in Routes & Beats." />
                ) : (
                  <ul className="divide-y">
                    {customers.map((c) => {
                      const here = open && c.visit?.id === open.id;
                      return (
                        <li key={c.id} className={cn('flex flex-wrap items-center justify-between gap-3 p-3', here && 'bg-brand-500/5')}>
                          <div className="min-w-0">
                            <p className="font-medium">
                              {c.name} <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                            </p>
                            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                              {c.address && (
                                <span>
                                  <MapPin className="mr-0.5 inline h-3 w-3" />
                                  {c.address}
                                </span>
                              )}
                              {c.phone && (
                                <a href={`tel:${c.phone}`} className="hover:underline">
                                  <Phone className="mr-0.5 inline h-3 w-3" />
                                  {c.phone}
                                </a>
                              )}
                              {c.outstanding > 0 && <span>Due {formatMoney(c.outstanding)}</span>}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <VisitChip visit={c.visit} />
                            {c.visit?.status === 'COMPLETED' ? (
                              <CheckCircle2 className="h-5 w-5 text-success" aria-label="Visited" />
                            ) : !here ? (
                              <Button size="sm" variant="outline" onClick={() => checkIn(c)} loading={busy === c.id} disabled={Boolean(open) || !can('fieldforce.visits.manage')}>
                                <LogIn className="h-4 w-4" /> Check in
                              </Button>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </>
          )}
        </>
      )}

      {checkingOut && <CheckOutDialog visit={checkingOut} onClose={() => setCheckingOut(null)} />}
    </div>
  );
}
