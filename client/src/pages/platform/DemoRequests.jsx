import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Building2,
  CalendarClock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Search,
  Trash2,
  Users,
  Repeat,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Dialog, ConfirmDialog } from '@/components/ui/dialog';
import { formatDate, formatDateTime, timeAgo } from '@/utils/format';
import { cn } from '@/utils/cn';

export const LEAD_STATUS = {
  NEW: { label: 'New', tone: 'default' },
  CONTACTED: { label: 'Contacted', tone: 'info' },
  DEMO_SCHEDULED: { label: 'Demo scheduled', tone: 'warning' },
  DEMO_DONE: { label: 'Demo done', tone: 'info' },
  WON: { label: 'Won', tone: 'success' },
  LOST: { label: 'Lost', tone: 'muted' },
};

const KEY = ['platform', 'demo-requests'];

/** Today in the browser's time zone, as YYYY-MM-DD. */
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dateInput = (v) => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');
const isDue = (lead) => lead.followUpAt && !['WON', 'LOST'].includes(lead.status) && dateInput(lead.followUpAt) <= today();

const whatsapp = (lead) =>
  `https://wa.me/91${lead.mobile}?text=${encodeURIComponent(`Hello ${lead.name}, this is ElevIQ Technologies about your ElevIQ BizFlow demo request.`)}`;

function StatusBadge({ status }) {
  const s = LEAD_STATUS[status] || { label: status, tone: 'outline' };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export default function DemoRequests() {
  const { user } = useAuth();
  const readOnly = user?.role !== 'SUPER_ADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => {
    const t = searchParams.get('tab');
    return t && (t in LEAD_STATUS || ['OPEN', 'DUE', 'ALL'].includes(t)) ? t : 'OPEN';
  });
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [openId, setOpenId] = useState(searchParams.get('open') || null);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = {
    page,
    limit,
    ...(query ? { search: query } : {}),
    ...(tab === 'DUE' ? { followUp: 'due' } : tab !== 'ALL' ? { status: tab } : {}),
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [...KEY, params],
    queryFn: async () => (await api.get('/platform/demo-requests', { params })).data,
    placeholderData: (prev) => prev,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};
  const c = meta.counts || {};
  const openCount = (c.NEW || 0) + (c.CONTACTED || 0) + (c.DEMO_SCHEDULED || 0) + (c.DEMO_DONE || 0);

  const tabs = [
    { value: 'OPEN', label: 'Open', badge: openCount },
    { value: 'NEW', label: 'New', badge: c.NEW || 0 },
    { value: 'DUE', label: 'Follow-up due', badge: c.followUpDue || 0 },
    { value: 'CONTACTED', label: 'Contacted', badge: c.CONTACTED || 0 },
    { value: 'DEMO_SCHEDULED', label: 'Demo scheduled', badge: c.DEMO_SCHEDULED || 0 },
    { value: 'DEMO_DONE', label: 'Demo done', badge: c.DEMO_DONE || 0 },
    { value: 'WON', label: 'Won', badge: c.WON || 0 },
    { value: 'LOST', label: 'Lost', badge: c.LOST || 0 },
    { value: 'ALL', label: 'All', badge: c.total || 0 },
  ];

  const open = (id) => {
    setOpenId(id);
  };
  const close = () => {
    setOpenId(null);
    if (searchParams.get('open')) {
      searchParams.delete('open');
      setSearchParams(searchParams, { replace: true });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Demo requests"
        description="Requests from the “Book a demo” form on the website. Call them, keep notes and track each lead to a company."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'New, not contacted', value: c.NEW || 0, tone: 'text-brand-600' },
          { label: 'Follow-up due', value: c.followUpDue || 0, tone: 'text-amber-600' },
          { label: 'Demos scheduled', value: c.DEMO_SCHEDULED || 0, tone: 'text-violet-600' },
          { label: 'Won', value: c.WON || 0, tone: 'text-emerald-600' },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="py-4">
              <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
              <p className={cn('mt-1 text-2xl font-bold', s.tone)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          items={tabs}
          value={tab}
          onChange={(v) => {
            setTab(v);
            setPage(1);
          }}
          size="sm"
        />
        <div className="relative w-full lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, business, mobile, city"
            className="pl-9"
            aria-label="Search demo requests"
          />
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState icon="error" title="Could not load demo requests" description={apiError(error).message} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="empty"
            title={query ? 'No matching requests' : 'No demo requests here'}
            description={
              query
                ? 'Try another name, business, mobile number or city.'
                : 'When someone fills the “Book a demo” form on the website, it shows up here.'
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y">
            {rows.map((lead) => (
              <li key={lead.id}>
                <button
                  type="button"
                  onClick={() => open(lead.id)}
                  className="grid w-full gap-2 px-4 py-3.5 text-left transition-colors hover:bg-accent/60 focus-ring sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-center sm:gap-4"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{lead.business}</span>
                      {lead.status === 'NEW' && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="New" />}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {lead.name} · {lead.businessType || 'Business type not given'}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5" /> {lead.mobile}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" /> {lead.city}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {timeAgo(lead.lastSubmittedAt)}
                    {lead.repeatCount > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600">
                        <Repeat className="h-3 w-3" /> asked {lead.repeatCount + 1}×
                      </span>
                    )}
                    {isDue(lead) && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-600">
                        <CalendarClock className="h-3 w-3" /> Follow up {formatDate(lead.followUpAt)}
                      </span>
                    )}
                  </span>
                  <span className="sm:justify-self-end">
                    <StatusBadge status={lead.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t px-4 py-3">
            <Pagination
              meta={meta}
              onPageChange={setPage}
              onLimitChange={(l) => {
                setLimit(l);
                setPage(1);
              }}
            />
          </div>
        </Card>
      )}

      {openId && <LeadDialog id={openId} readOnly={readOnly} onClose={close} />}
    </div>
  );
}

function LeadDialog({ id, readOnly, onClose }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: lead, isLoading, isError, error } = useQuery({
    queryKey: ['platform', 'demo-request', id],
    queryFn: async () => (await api.get(`/platform/demo-requests/${id}`)).data.data,
  });

  const refresh = (updated) => {
    if (updated) queryClient.setQueryData(['platform', 'demo-request', id], updated);
    queryClient.invalidateQueries({ queryKey: KEY });
    queryClient.invalidateQueries({ queryKey: ['platform', 'demo-requests-new'] });
    queryClient.invalidateQueries({ queryKey: ['platform', 'dashboard'] });
  };

  const update = useMutation({
    mutationFn: async (body) => (await api.patch(`/platform/demo-requests/${id}`, body)).data.data,
    onSuccess: (d) => {
      refresh(d);
      toast.success('Saved');
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const addNote = useMutation({
    mutationFn: async () =>
      (await api.post(`/platform/demo-requests/${id}/notes`, { text: note.trim(), markContacted: true })).data.data,
    onSuccess: (d) => {
      setNote('');
      refresh(d);
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/platform/demo-requests/${id}`),
    onSuccess: () => {
      toast.success('Demo request deleted');
      refresh();
      onClose();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        size="lg"
        title={lead ? lead.business : 'Demo request'}
        description={lead ? `Asked ${formatDateTime(lead.createdAt)}${lead.repeatCount ? ` · asked again ${lead.repeatCount}× (last ${timeAgo(lead.lastSubmittedAt)})` : ''}` : undefined}
      >
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : isError ? (
          <EmptyState icon="error" title="Could not load this request" description={apiError(error).message} />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <a href={`tel:+91${lead.mobile}`}>
                <Button size="sm">
                  <Phone className="mr-2 h-4 w-4" /> Call {lead.mobile}
                </Button>
              </a>
              <a href={whatsapp(lead)} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline">
                  <MessageCircle className="mr-2 h-4 w-4" /> WhatsApp
                </Button>
              </a>
              {lead.email && (
                <a href={`mailto:${lead.email}?subject=${encodeURIComponent('Your ElevIQ BizFlow demo')}`}>
                  <Button size="sm" variant="outline">
                    <Mail className="mr-2 h-4 w-4" /> Email
                  </Button>
                </a>
              )}
            </div>

            <dl className="grid gap-x-6 gap-y-3 rounded-xl border bg-muted/30 p-4 text-sm sm:grid-cols-2">
              {[
                ['Contact person', lead.name],
                ['Mobile', lead.mobile],
                ['City', lead.city],
                ['Email', lead.email || '—'],
                ['Type of business', lead.businessType || '—'],
                ['Sales team', lead.teamSize || '—'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
              {lead.message && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Message</dt>
                  <dd className="whitespace-pre-wrap">{lead.message}</dd>
                </div>
              )}
            </dl>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <Select
                  value={lead.status}
                  disabled={readOnly || update.isPending}
                  onChange={(e) => update.mutate({ status: e.target.value })}
                >
                  {Object.entries(LEAD_STATUS).map(([v, s]) => (
                    <option key={v} value={v}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Next follow-up" hint="Shows under “Follow-up due” on that day">
                <Input
                  type="date"
                  value={dateInput(lead.followUpAt)}
                  disabled={readOnly || update.isPending}
                  onChange={(e) => update.mutate({ followUpAt: e.target.value || null })}
                />
              </Field>
            </div>

            <div className="rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Building2 className="h-4 w-4 text-brand-500" /> Company
                </p>
                {lead.convertedCompany ? (
                  <Link to={`/platform/companies/${lead.convertedCompany.id}`} className="text-sm font-medium text-primary hover:underline">
                    {lead.convertedCompany.name || 'Open company'}
                    {lead.convertedCompany.code ? ` (${lead.convertedCompany.code})` : ''}
                  </Link>
                ) : readOnly ? (
                  <span className="text-sm text-muted-foreground">Not a customer yet</span>
                ) : (
                  <Link to={`/platform/companies/new?lead=${lead.id}`}>
                    <Button size="sm" variant="outline">
                      Create company from this lead
                    </Button>
                  </Link>
                )}
              </div>
              {!lead.convertedCompany && (
                <p className="mt-1 text-xs text-muted-foreground">
                  The new-company form opens with these details filled in, and the lead is marked Won once it is created.
                </p>
              )}
            </div>

            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4 text-brand-500" /> Notes
              </p>
              {!readOnly && (
                <div className="space-y-2">
                  <Textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What happened on the call? e.g. Wants demo on Friday 4 pm, uses Tally today"
                  />
                  <div className="flex justify-end">
                    <Button size="sm" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()}>
                      {addNote.isPending ? 'Saving…' : 'Add note'}
                    </Button>
                  </div>
                </div>
              )}
              {lead.notes.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {lead.notes.map((n) => (
                    <li key={n.id} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      <p className="whitespace-pre-wrap">{n.text}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {n.byName || 'Someone'} · {formatDateTime(n.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!readOnly && (
              <div className="flex justify-end border-t pt-4">
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete (spam or duplicate)
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title="Delete this demo request?"
        message="Use this for spam or duplicates. It disappears from the list."
        confirmLabel="Delete"
        tone="destructive"
        loading={remove.isPending}
      />
    </>
  );
}
