import { useQuery } from '@tanstack/react-query';
import { Server, ExternalLink, ShieldCheck, Clock, Database, Palette } from 'lucide-react';

import api, { API_BASE } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { APP_NAME } from '@/utils/format';

/** Human-friendly uptime from seconds. */
const formatDuration = (secs) => {
  const s = Math.max(0, Math.round(Number(secs) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

/**
 * Platform settings: read-only environment/branding overview.
 * Tenant-level settings live inside each company workspace (Phase 3).
 */
export default function PlatformSettings() {
  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'health'],
    queryFn: async () => {
      // Absolute URLs so we hit the server health endpoints, not the /api proxy.
      const base = API_BASE.replace(/\/api$/, '');
      const [h, r] = await Promise.all([
        fetch(`${base}/health`, { credentials: 'include' }).then((x) => x.json()).catch(() => null),
        fetch(`${base}/ready`, { credentials: 'include' }).then((x) => x.json()).catch(() => null),
      ]);
      return { health: h?.data || null, ready: r?.data || null, isReady: Boolean(r?.success) };
    },
    refetchInterval: 60000,
  });

  const health = data?.health || {};
  const ready = data?.ready || {};

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Platform settings"
        description="Environment, branding and service health for this ElevIQ SFA instance"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4 text-brand-500" />
              Branding
            </CardTitle>
            <CardDescription>Shown to every tenant in their workspace header and emails.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Product name</span>
              <span className="font-semibold">{APP_NAME}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Workspace label</span>
              <Badge tone="info">Service Provider</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Company-facing footer</span>
              <span className="text-xs">Powered by {APP_NAME}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-brand-500" />
              Security posture
            </CardTitle>
            <CardDescription>Session and API protection defaults for this instance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Access token</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> 15 minutes
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Refresh token</span>
              <span>7 days · httpOnly cookie · rotated</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Impersonation session</span>
              <span>30 minutes · audit-trailed</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Tenant isolation</span>
              <Badge tone="success">ENFORCED</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4 text-brand-500" />
              Service health
            </CardTitle>
            <CardDescription>Live status of the API backing this panel.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">API</span>
                  <Badge tone={health.status === 'up' ? 'success' : 'warning'} dot>
                    {String(health.status || 'unknown').toUpperCase()}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Database</span>
                  <span className="inline-flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5" />
                    <Badge tone={data?.isReady ? 'success' : 'destructive'}>{String(ready.db || 'unknown').toUpperCase()}</Badge>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Environment</span>
                  <span>{health.env || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Uptime</span>
                  <span>{health.uptime ? `${formatDuration(health.uptime)}` : '—'}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ExternalLink className="h-4 w-4 text-brand-500" />
              Developer resources
            </CardTitle>
            <CardDescription>Everything you need to integrate with this instance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">API base</span>
              <code className="rounded bg-muted px-2 py-0.5 text-xs">{API_BASE}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Interactive docs</span>
              <a href="/api-docs" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                Swagger UI <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Health endpoint</span>
              <code className="rounded bg-muted px-2 py-0.5 text-xs">/health</code>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="py-4 text-xs text-muted-foreground">
          Per-company settings (currency, numbering, role permissions, feature flags) are managed inside each workspace
          and will appear under Company Settings from Phase 3.
        </CardContent>
      </Card>
    </div>
  );
}
