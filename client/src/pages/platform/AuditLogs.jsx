import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, Search, ShieldAlert, Users, Activity } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';
import { formatNumber, formatDateTime } from '@/utils/format';

const ACTIONS = ['', 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'IMPERSONATE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'APPROVE', 'REJECT', 'EXPORT', 'PASSWORD_RESET'];
const SEVERITIES = ['', 'INFO', 'WARN', 'ERROR'];
const ENTITY_TYPES = ['', 'Company', 'PlatformUser', 'Plan', 'Announcement', 'Subscription', 'User', 'Session'];

const SEVERITY_TONE = { INFO: 'muted', WARN: 'warning', ERROR: 'destructive' };

export default function AuditLogs() {
  const [params, setParams] = useSearchParams();
  const [searchDraft, setSearchDraft] = useState(params.get('search') || '');
  const [detail, setDetail] = useState(null);

  const search = params.get('search') || '';
  const action = params.get('action') || '';
  const entityType = params.get('entityType') || '';
  const severity = params.get('severity') || '';
  const page = Number(params.get('page') || 1);
  const limit = Number(params.get('limit') || 25);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => {
      if (!v) next.delete(k);
      else next.set(k, String(v));
    });
    setParams(next, { replace: true });
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['platform', 'audit-logs', { search, action, entityType, severity, page, limit }],
    queryFn: async () => {
      // Omit empty filters - the server's enums reject '' values.
      const params = { page, limit };
      if (search) params.search = search;
      if (action) params.action = action;
      if (entityType) params.entityType = entityType;
      if (severity) params.severity = severity;
      const res = await api.get('/platform/audit-logs', { params });
      return res.data;
    },
    keepPreviousData: true,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['platform', 'audit-logs', 'summary'],
    queryFn: async () => {
      const res = await api.get('/platform/audit-logs/summary');
      return res.data.data;
    },
  });

  const rows = data?.data || [];
  const meta = data?.meta || {};
  const facets = meta.facets || {};
  const filtersActive = Boolean(search || action || entityType || severity);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform audit trail"
        description="Every action taken by service provider admins — company changes, impersonation, plan edits, logins"
      />

      {/* Summary tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-300">
              <ScrollText className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Total events</p>
              <p className="text-lg font-bold">{summaryLoading ? '—' : formatNumber(summary?.total || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/15 text-warning">
              <Activity className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Last 30 days</p>
              <p className="text-lg font-bold">{summaryLoading ? '—' : formatNumber(summary?.last30d || 0)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/12 text-destructive">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Warnings (30d)</p>
              <p className="text-lg font-bold">{summaryLoading ? '—' : formatNumber((summary?.bySeverity?.WARN || 0) + (summary?.bySeverity?.ERROR || 0))}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/12 text-success">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs text-muted-foreground">Active admins (30d)</p>
              <p className="text-lg font-bold">{summaryLoading ? '—' : formatNumber(summary?.activeActors || 0)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 xl:flex-row xl:items-center">
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setParam({ search: searchDraft.trim(), page: 1 });
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search descriptions, entities or actors…"
              className="pl-9"
              aria-label="Search audit logs"
            />
          </form>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Select value={action} onChange={(e) => setParam({ action: e.target.value, page: 1 })} aria-label="Filter by action">
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a || 'Any action'}
                </option>
              ))}
            </Select>
            <Select value={entityType} onChange={(e) => setParam({ entityType: e.target.value, page: 1 })} aria-label="Filter by entity">
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t || 'Any entity'}
                </option>
              ))}
            </Select>
            <Select value={severity} onChange={(e) => setParam({ severity: e.target.value, page: 1 })} aria-label="Filter by severity">
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s || 'Any severity'}
                </option>
              ))}
            </Select>
          </div>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchDraft('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Facet chips */}
      {(facets.actions?.length > 0 || facets.entityTypes?.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {facets.actions?.slice(0, 8).map((f) => (
            <button
              key={`a-${f.value}`}
              type="button"
              onClick={() => setParam({ action: action === f.value ? '' : f.value, page: 1 })}
              className={
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-ring ' +
                (action === f.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent')
              }
            >
              {f.value} <span className="opacity-70">{f.count}</span>
            </button>
          ))}
          <span className="mx-1 w-px bg-border" aria-hidden="true" />
          {facets.entityTypes?.slice(0, 8).map((f) => (
            <button
              key={`e-${f.value}`}
              type="button"
              onClick={() => setParam({ entityType: entityType === f.value ? '' : f.value, page: 1 })}
              className={
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-ring ' +
                (entityType === f.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent')
              }
            >
              {f.value} <span className="opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <Card>
          <CardContent className="space-y-3 py-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <EmptyState icon="error" title="Could not load the audit trail" description={apiError(error).message} />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={filtersActive ? 'search' : 'empty'}
            title="No events found"
            description={filtersActive ? 'Try widening the filters.' : 'Platform actions will appear here as admins use the panel.'}
          />
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Severity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => setDetail(a)}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.occurredAt)}</TableCell>
                  <TableCell>
                    <p className="font-medium">{a.actor}</p>
                    {a.actorRole && <p className="text-xs text-muted-foreground">{a.actorRole}</p>}
                  </TableCell>
                  <TableCell>
                    <Badge tone={a.action === 'IMPERSONATE' ? 'warning' : a.action === 'DELETE' ? 'destructive' : 'secondary'}>
                      {a.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <p>{a.entityType}</p>
                    {a.entityLabel && <p className="max-w-[200px] truncate text-xs text-muted-foreground">{a.entityLabel}</p>}
                  </TableCell>
                  <TableCell className="max-w-[340px]">
                    <span className="block truncate" title={a.description}>
                      {a.description || '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge tone={SEVERITY_TONE[a.severity] || 'muted'}>{a.severity}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Pagination
        meta={meta}
        onPageChange={(p) => setParam({ page: p })}
        onLimitChange={(l) => setParam({ limit: l, page: 1 })}
      />

      {/* Detail dialog with before/after diff */}
      <Dialog
        open={!!detail}
        onClose={() => setDetail(null)}
        title={`${detail?.action || ''} · ${detail?.entityType || ''}`}
        description={detail?.description}
        size="lg"
        footer={
          <Button variant="outline" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Actor</dt>
              <dd>
                {detail.actor} {detail.actorEmail && <span className="text-muted-foreground">({detail.actorEmail})</span>}
              </dd>
              <dt className="text-muted-foreground">When</dt>
              <dd>{formatDateTime(detail.occurredAt)}</dd>
              <dt className="text-muted-foreground">Channel</dt>
              <dd>{detail.channel}</dd>
              <dt className="text-muted-foreground">Severity</dt>
              <dd>{detail.severity}</dd>
              {detail.entityLabel && (
                <>
                  <dt className="text-muted-foreground">Entity</dt>
                  <dd>{detail.entityLabel}</dd>
                </>
              )}
            </dl>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Before</p>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-3 text-xs">
                  {detail.before ? JSON.stringify(detail.before, null, 2) : '—'}
                </pre>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">After</p>
                <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-3 text-xs">
                  {detail.after ? JSON.stringify(detail.after, null, 2) : '—'}
                </pre>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
