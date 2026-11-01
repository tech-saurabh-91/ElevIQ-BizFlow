import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Eye, Search, ShieldCheck, X } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';
import { ErrorAlert } from '@/components/ui/alert';
import { formatDateTime, timeAgo } from '@/utils/format';

const ACTION_TONE = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'destructive',
  STATUS_CHANGE: 'warning',
  LOGIN: 'secondary',
  LOGOUT: 'muted',
  LOGIN_FAILED: 'destructive',
  APPROVE: 'success',
  REJECT: 'destructive',
  EXPORT: 'info',
  IMPERSONATE: 'warning',
  PASSWORD_RESET: 'warning',
};

const SEVERITY_TONE = { INFO: 'muted', WARN: 'warning', ERROR: 'destructive' };

const pretty = (value) => {
  if (value == null) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

function Snapshot({ label, value }) {
  const text = pretty(value);
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      {text ? (
        <pre className="max-h-72 overflow-auto rounded-lg border bg-muted/40 p-3 text-[11px] leading-relaxed">
          {text}
        </pre>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">No snapshot recorded</p>
      )}
    </div>
  );
}

export default function AuditTrail() {
  const [params, setParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(params.get('search') || '');
  const [selected, setSelected] = useState(null);

  const search = params.get('search') || '';
  const action = params.get('action') || '';
  const entityType = params.get('entityType') || '';
  const dateFrom = params.get('dateFrom') || '';
  const dateTo = params.get('dateTo') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 20);

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  const setParam = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      Object.entries(patch).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '' || value === 'ALL') next.delete(key);
        else next.set(key, String(value));
      });
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  useEffect(() => {
    if (searchDraft === search) return undefined;
    const timer = setTimeout(() => setParam({ search: searchDraft.trim(), page: 1 }), 400);
    return () => clearTimeout(timer);
  }, [searchDraft, search, setParam]);

  const queryParams = useMemo(() => {
    const out = { page, limit, sort: 'occurredAt', order: 'desc' };
    if (search) out.search = search;
    if (action) out.action = action;
    if (entityType) out.entityType = entityType;
    if (dateFrom) out.dateFrom = dateFrom;
    if (dateTo) out.dateTo = dateTo;
    return out;
  }, [page, limit, search, action, entityType, dateFrom, dateTo]);

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['company', 'audit-logs', queryParams],
    queryFn: async () => {
      const res = await api.get('/v1/audit-logs', { params: queryParams });
      return res.data;
    },
    keepPreviousData: true,
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};
  // Facets live at the top level of `meta` (paginated() spreads `extra`).
  const facets = { actions: meta.actions || [], entityTypes: meta.entityTypes || [] };

  const detail = useQuery({
    queryKey: ['company', 'audit-logs', 'detail', selected?.id],
    queryFn: async () => {
      const res = await api.get(`/v1/audit-logs/${selected.id}`);
      return res.data?.data;
    },
    enabled: Boolean(selected?.id),
  });

  const hasFilters = Boolean(search || action || entityType || dateFrom || dateTo);

  const resetAll = () => {
    const next = new URLSearchParams();
    if (limit !== 20) next.set('limit', String(limit));
    setParams(next, { replace: true });
    setSearchDraft('');
  };

  const record = detail.data || selected;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Trail"
        description="Who changed what, when — including before and after snapshots"
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Audit Trail' }]}
        actions={<Badge tone="info" dot>Tenant scoped</Badge>}
      />

      <Card>
        <CardContent className="grid gap-3 py-4 sm:grid-cols-2 xl:grid-cols-6">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search description, actor or entity…"
              className="pl-9 pr-9"
              aria-label="Search audit trail"
            />
            {searchDraft && (
              <button
                type="button"
                onClick={() => setSearchDraft('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent focus-ring"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select
            aria-label="Filter by action"
            value={action}
            onChange={(e) => setParam({ action: e.target.value || undefined, page: 1 })}
          >
            <option value="">All actions</option>
            {(facets.actions || []).map((a) => (
              <option key={a} value={a}>
                {a.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>

          <Select
            aria-label="Filter by entity type"
            value={entityType}
            onChange={(e) => setParam({ entityType: e.target.value || undefined, page: 1 })}
          >
            <option value="">All entities</option>
            {(facets.entityTypes || []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>

          <Field label="From" className="space-y-0">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setParam({ dateFrom: e.target.value || undefined, page: 1 })}
              aria-label="Filter from date"
            />
          </Field>
          <Field label="To" className="space-y-0">
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setParam({ dateTo: e.target.value || undefined, page: 1 })}
              aria-label="Filter to date"
            />
          </Field>

          {hasFilters && (
            <div className="sm:col-span-2 xl:col-span-6">
              <Button variant="ghost" size="sm" onClick={resetAll}>
                Reset filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <TableSkeleton rows={7} cols={5} />
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState icon="error" title="Could not load the audit trail" description={apiError(error).message} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={hasFilters ? 'search' : 'empty'}
            title={hasFilters ? 'No matching events' : 'No audit events yet'}
            description={
              hasFilters
                ? 'Try a wider date range or clear the filters.'
                : 'Changes to masters, users and settings will appear here.'
            }
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" onClick={resetAll}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <Card className={isFetching ? 'opacity-80 transition-opacity' : 'transition-opacity'}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="whitespace-nowrap text-sm">
                      <p>{timeAgo(row.occurredAt)}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(row.occurredAt)}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <p className="font-medium">{row.actor?.name || 'System'}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.actor?.role ? row.actor.role.replace(/_/g, ' ') : row.channel}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={ACTION_TONE[row.action] || 'secondary'}>
                        {String(row.action || '').replace(/_/g, ' ')}
                      </Badge>
                      {row.severity && row.severity !== 'INFO' && (
                        <Badge tone={SEVERITY_TONE[row.severity] || 'muted'}>{row.severity}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <p>{row.entityType}</p>
                      <p className="max-w-[14rem] truncate text-xs text-muted-foreground">
                        {row.entityLabel || row.entityId || '—'}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="max-w-md text-sm text-muted-foreground">{row.description || '—'}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon-sm" onClick={() => setSelected(row)} aria-label="View audit event">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Pagination
            meta={{ ...meta, page, limit }}
            onPageChange={(p) => setParam({ page: p })}
            onLimitChange={(l) => setParam({ limit: l, page: 1 })}
          />
        </Card>
      )}

      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Audit event"
        description={record?.description || undefined}
        size="xl"
      >
        {selected && (
          <div className="space-y-5">
            {detail.isError && (
              <ErrorAlert title="Could not load snapshots" message={apiError(detail.error).message} />
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone={ACTION_TONE[record?.action] || 'secondary'}>
                    {String(record?.action || '').replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-sm">{record?.entityType}</span>
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Occurred</p>
                <p className="mt-1 text-sm">{formatDateTime(record?.occurredAt)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actor</p>
                <p className="mt-1 text-sm font-medium">{record?.actor?.name || 'System'}</p>
                <p className="text-xs text-muted-foreground">
                  {[record?.actor?.email, record?.actor?.role?.replace(/_/g, ' ')].filter(Boolean).join(' · ') ||
                    record?.channel}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entity</p>
                <p className="mt-1 break-all text-sm">{record?.entityLabel || record?.entityId || '—'}</p>
                <p className="text-xs text-muted-foreground">{record?.channel || 'WEB'}</p>
              </div>
            </div>

            {detail.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" /> Loading snapshots…
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <Snapshot label="Before" value={record?.before} />
                <Snapshot label="After" value={record?.after} />
              </div>
            )}

            {record?.changes && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Changed fields
                </p>
                <Snapshot label="Changes" value={record.changes} />
              </div>
            )}

            <div className="grid gap-2 border-t pt-3 text-xs text-muted-foreground sm:grid-cols-2">
              <p>IP: {record?.meta?.ip || '—'}</p>
              <p className="truncate">Request: {record?.meta?.method || '—'} {record?.meta?.path || ''}</p>
              <p className="truncate sm:col-span-2">User agent: {record?.meta?.userAgent || '—'}</p>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
