import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  Clock,
  FileText,
  IndianRupee,
  LogIn,
  LogOut,
  MapPin,
  MapPinOff,
  Navigation,
  Phone,
  RotateCcw,
  Search,
  ShoppingCart,
} from 'lucide-react';

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
import { FieldDayBanner, useFieldDay } from '@/components/company/FieldDay';
import { formatDate, formatMoney, formatTime } from '@/utils/format';
import { cn } from '@/utils/cn';

/**
 * Sales visit - one screen for the salesman's day in the market:
 *   pick a route (or "No route") -> customer cards -> check in at the shop
 *   (within the geofence) -> order / invoice / collection / return ->
 *   check out (a reason only when nothing was booked). Time at the shop is
 *   the check-in to check-out span.
 */

const NO_ROUTE = 'none';
// Back from the order / invoice / collection form lands on Sales visit; the
// salesman checks out when they are done at the shop (nothing is forced).
const RETURN_TO = '/app/sales';
const OUTCOME_TONE = { ORDER_TAKEN: 'success', INVOICED: 'success', PAYMENT_COLLECTED: 'info', NO_ORDER: 'warning', CUSTOMER_UNAVAILABLE: 'muted' };

/**
 * Google Maps directions from where the phone is to the shop: on a phone it
 * opens the Maps app in navigation, on a computer a new tab. The pinned point
 * is exact; without a pin we fall back to the shop's name and address.
 */
const directionsUrl = (c) => {
  const dest = c.location ? `${c.location.lat},${c.location.lng}` : c.fullAddress ? `${c.name}, ${c.fullAddress}` : '';
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving` : '';
};

/** Straight-line distance in km between two { lat, lng } points. */
const kmBetween = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};
const kmLabel = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);

const minutesSince = (at) => (at ? Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000)) : 0);
const durationLabel = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);

function VisitChip({ visit }) {
  if (!visit) return null;
  const away = visit.outsideGeofence ? (
    <Badge tone="warning">{visit.checkInDistanceM != null ? `${visit.checkInDistanceM} m away` : 'Away'}</Badge>
  ) : null;
  if (visit.status === 'IN_PROGRESS') {
    return (
      <span className="flex flex-wrap gap-1">
        <Badge tone="info">Checked in {formatTime(visit.checkInAt)}</Badge>
        {away}
      </span>
    );
  }
  if (visit.status !== 'COMPLETED') return <Badge tone="muted">{outcomeLabel(visit.status)}</Badge>;
  const extra = visit.invoiceNo || visit.orderNo || (visit.noOrderReason ? noOrderReasonLabel(visit.noOrderReason) : '');
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={OUTCOME_TONE[visit.outcome] || 'muted'}>
        {outcomeLabel(visit.outcome)}
        {extra ? ` · ${extra}` : ''}
      </Badge>
      {away}
    </span>
  );
}

export default function SalesVisit() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = usePermissions();
  const day = useFieldDay();
  const [routeId, setRouteId] = useState(() => {
    try {
      return localStorage.getItem('sales-visit-route') || NO_ROUTE;
    } catch {
      return NO_ROUTE;
    }
  });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [checkingOut, setCheckingOut] = useState(null);
  const [, tick] = useState(0);
  // Where the phone is now: "how far" on each card and "Nearest first".
  const [here, setHere] = useState(null);
  const [nearest, setNearest] = useState(() => {
    try {
      return localStorage.getItem('sales-visit-nearest') === '1';
    } catch {
      return false;
    }
  });
  const [locating, setLocating] = useState(false);
  const locate = async () => {
    setLocating(true);
    const gps = await captureGps();
    setLocating(false);
    if (gps) setHere(gps);
    return gps;
  };
  useEffect(() => {
    let live = true;
    captureGps().then((gps) => live && gps && setHere(gps));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('sales-visit-nearest', nearest ? '1' : '0');
    } catch {
      /* per-viewer convenience only */
    }
  }, [nearest]);

  const mine = useQuery({
    queryKey: ['company', 'beat', 'mine'],
    queryFn: async () => (await api.get('/v1/beat-plans/mine')).data?.data ?? null,
  });
  const routes = useMemo(() => mine.data?.routes || [], [mine.data]);
  const open = mine.data?.openVisit || null;

  // A route that is no longer ours falls back to "No route".
  useEffect(() => {
    if (mine.data && routeId !== NO_ROUTE && !routes.some((r) => r.id === routeId)) setRouteId(NO_ROUTE);
  }, [mine.data, routes, routeId]);
  useEffect(() => {
    try {
      localStorage.setItem('sales-visit-route', routeId);
    } catch {
      /* per-viewer convenience only */
    }
  }, [routeId]);

  const customers = useQuery({
    queryKey: ['company', 'beat', 'customers', routeId, search],
    queryFn: async () => (await api.get('/v1/beat-plans/customers', { params: { route: routeId, q: search || undefined } })).data?.data ?? [],
    keepPreviousData: true,
  });
  const rows = useMemo(() => {
    const list = (customers.data || []).map((c) => ({ ...c, km: here && c.location ? kmBetween(here, c.location) : null }));
    // Nearest first; shops without a pin go last, in name order.
    if (nearest && here) list.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
    return list;
  }, [customers.data, here, nearest]);

  // Old links (?checkout=1) no longer pop the check-out; just tidy the URL.
  useEffect(() => {
    if (searchParams.get('checkout')) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  // Keep the "time at shop" clock moving.
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [open]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'beat'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'visits'] });
  };

  const checkIn = async (customer) => {
    setBusy(customer.id);
    try {
      const gps = await captureGps();
      const body = { customerId: customer.id };
      if (routeId !== NO_ROUTE) body.route = routeId;
      if (gps) {
        body.location = { lat: gps.lat, lng: gps.lng };
        if (gps.accuracy != null) body.accuracy = Math.round(gps.accuracy);
      }
      const res = await api.post('/v1/beat-plans/check-in', body);
      toast.success(res.data?.message || 'Checked in');
      refresh();
    } catch (err) {
      const e = apiError(err);
      const message =
        e.code === 'GPS_REQUIRED' ? 'Your location is not available. Allow location access for this site in the browser (and turn on GPS), then try again.' : e.message;
      toast.error(message, { duration: ['OUTSIDE_GEOFENCE', 'GPS_REQUIRED'].includes(e.code) ? 6000 : 4000 });
      if (['ATTENDANCE_REQUIRED', 'ATTENDANCE_OUT_PENDING', 'DAY_CASHOUT_PENDING', 'DAY_ENDED'].includes(e.code)) day.refetch();
      // Someone else's view of the open shop is stale: reload it.
      if (e.code === 'VISIT_IN_PROGRESS') refresh();
    } finally {
      setBusy('');
    }
  };

  const go = (path) => navigate(`${path}${path.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(RETURN_TO)}`);
  const openCustomer = open && (rows.find((c) => c.id === open.customerId) || { id: open.customerId, name: open.customerName });
  const blocked = Boolean(day.blocked);
  const done = rows.filter((c) => c.visit?.status === 'COMPLETED').length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales visit"
        description="Pick a route, check in at the shop, book the sale, check out."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Sales visit' }]}
      />

      <FieldDayBanner day={day} />

      {open && (
        <Card className="border-brand-500/40 bg-brand-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              {open.earlierDay ? (
                <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-warning">
                  <Clock className="h-3.5 w-3.5" /> Left checked in on {formatDate(`${open.day}T12:00:00`)} at {formatTime(open.checkInAt)}
                </p>
              ) : (
                <p className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> At the shop {durationLabel(minutesSince(open.checkInAt))} · since {formatTime(open.checkInAt)}
                </p>
              )}
              <p className="truncate text-lg font-semibold">{openCustomer?.name}</p>
              {open.earlierDay && <p className="text-xs text-muted-foreground">Check out of this shop to continue - no other shop can be checked in until then.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {!open.earlierDay && can('orders.create') && (
                <Button variant="outline" size="sm" onClick={() => go(`/app/orders/new?customerId=${open.customerId}`)}>
                  <ShoppingCart className="h-4 w-4" /> Order
                </Button>
              )}
              {!open.earlierDay && can('invoices.create') && (
                <Button variant="outline" size="sm" onClick={() => go(`/app/invoices/new?customerId=${open.customerId}`)}>
                  <FileText className="h-4 w-4" /> Invoice
                </Button>
              )}
              {!open.earlierDay && can('payments.create') && (
                <Button variant="outline" size="sm" onClick={() => go(`/app/payments/new?customerId=${open.customerId}`)}>
                  <IndianRupee className="h-4 w-4" /> Collect
                </Button>
              )}
              {!open.earlierDay && can('creditnotes.create') && (
                <Button variant="outline" size="sm" onClick={() => go(`/app/credit-notes/new?customerId=${open.customerId}`)}>
                  <RotateCcw className="h-4 w-4" /> Return
                </Button>
              )}
              <Button size="sm" onClick={() => setCheckingOut(open)}>
                <LogOut className="h-4 w-4" /> Check out
              </Button>
            </div>
          </div>
        </Card>
      )}

      {mine.isError ? (
        <ErrorAlert title="Could not load your routes" message={apiError(mine.error).message} />
      ) : (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Route">
          {[{ id: NO_ROUTE, name: 'No route', customers: null }, ...routes].map((r) => (
            <label
              key={r.id}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                r.id === routeId ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-accent'
              )}
            >
              <input type="radio" name="route" value={r.id} checked={r.id === routeId} onChange={() => setRouteId(r.id)} className="accent-primary" />
              {r.name}
              {r.today && <Badge tone="info">Today</Badge>}
              {r.customers != null && <span className="text-xs text-muted-foreground">{r.customers}</span>}
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} customer{rows.length === 1 ? '' : 's'} · {done} visited today
        </p>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button
            variant={nearest && here ? 'default' : 'outline'}
            size="sm"
            loading={locating}
            aria-pressed={nearest && Boolean(here)}
            title="Sort the shops by how far they are from you"
            onClick={async () => {
              if (nearest) return setNearest(false);
              const gps = here || (await locate());
              if (!gps) return toast.error('Your location is not available. Allow location access for this site and turn on GPS.');
              return setNearest(true);
            }}
          >
            <Navigation className="h-4 w-4" /> Nearest first
          </Button>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shop, code or phone…" className="h-9 pl-8" aria-label="Search customers" />
          </div>
        </div>
      </div>

      {customers.isLoading ? (
        <LoadingState label="Loading customers…" />
      ) : !rows.length ? (
        <Card>
          <EmptyState
            icon="empty"
            title={routeId === NO_ROUTE ? 'No customers found' : 'No customers on this route'}
            description={routeId === NO_ROUTE ? 'Try a different search.' : 'Add customers to the route in Routes & Beats.'}
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((c) => {
            const atShop = open && open.customerId === c.id;
            const route = directionsUrl(c);
            const visited = c.visit?.status === 'COMPLETED';
            return (
              <Card key={c.id} className={cn('flex flex-col gap-3 p-4', atShop && 'border-brand-500/60 bg-brand-500/5')}>
                <div className="min-w-0">
                  <p className="truncate font-medium" title={c.name}>
                    {c.name}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{c.code}</p>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {c.address && (
                    <p className="flex items-start gap-1">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                      {c.address}
                    </p>
                  )}
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:underline">
                      <Phone className="h-3 w-3" />
                      {c.phone}
                    </a>
                  )}
                  {c.km != null && (
                    <p className="flex items-center gap-1 font-medium text-foreground">
                      <Navigation className="h-3 w-3" /> {kmLabel(c.km)} away
                    </p>
                  )}
                  {!c.hasLocation && (
                    <p className="flex items-center gap-1">
                      <MapPinOff className="h-3 w-3" /> Shop location not pinned{c.fullAddress ? ' - directions use the address' : ''}
                    </p>
                  )}
                  {c.outstanding > 0 && <p className="font-medium text-foreground">Due {formatMoney(c.outstanding)}</p>}
                </div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                  <VisitChip visit={atShop ? { ...open, status: 'IN_PROGRESS' } : c.visit} />
                  {route && !atShop && (
                    <a
                      href={route}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-accent focus-ring"
                      title={c.location ? 'Directions to the shop in Google Maps' : 'Directions to the shop address (location not pinned)'}
                    >
                      <Navigation className="h-4 w-4" /> Directions
                    </a>
                  )}
                  {atShop ? (
                    <Button size="sm" className="ml-auto" onClick={() => setCheckingOut(open)}>
                      <LogOut className="h-4 w-4" /> Check out
                    </Button>
                  ) : visited ? (
                    // Back at a shop visited today (a second order, a late
                    // collection): a fresh check-in opens a new visit.
                    <span className={cn('flex items-center gap-2', !route && 'ml-auto')}>
                      <CheckCircle2 className="h-5 w-5 text-success" aria-label="Visited" />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => checkIn(c)}
                        loading={busy === c.id}
                        disabled={Boolean(open) || blocked || !can('fieldforce.visits.manage')}
                        title={open ? `Check out of ${openCustomer?.name || 'the current shop'} first` : 'Check in again for another order or collection'}
                      >
                        <LogIn className="h-4 w-4" /> Visit again
                      </Button>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className={route ? undefined : 'ml-auto'}
                      onClick={() => checkIn(c)}
                      loading={busy === c.id}
                      disabled={Boolean(open) || blocked || !can('fieldforce.visits.manage')}
                      title={open ? `Check out of ${openCustomer?.name || 'the current shop'} first` : undefined}
                    >
                      <LogIn className="h-4 w-4" /> Check in
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {checkingOut && (
        <CheckOutDialog
          visit={{ ...checkingOut, customerName: checkingOut.customerName || openCustomer?.name || '' }}
          onClose={() => setCheckingOut(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
