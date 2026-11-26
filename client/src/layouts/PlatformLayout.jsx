import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Suspense } from 'react';
import Sidebar from '@/components/shell/Sidebar';
import Topbar from '@/components/shell/Topbar';
import BottomNav from '@/components/shell/BottomNav';
import { LoadingState } from '@/components/ui/misc';
import PageErrorBoundary from '@/components/shell/PageErrorBoundary';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';
import { platformNav, platformMobileTabs } from '@/routes/navigation';

/**
 * Platform (Service Provider) shell: /platform/*
 * Topbar badge shows the SaaS owner's own org name + ElevIQ BizFlow.
 */
export default function PlatformLayout() {
  const { user, logout, bootstrapping } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // New website demo requests, shown as a count next to "Demo Requests".
  const { data: newLeads = 0 } = useQuery({
    queryKey: ['platform', 'demo-requests-new'],
    queryFn: async () => (await api.get('/platform/demo-requests/new-count')).data.data.count,
    enabled: Boolean(user) && !bootstrapping,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const badges = { demoRequests: newLeads };
  const sections = platformNav.map((s) => ({
    ...s,
    items: s.items.map((i) => (i.badgeKey ? { ...i, badge: badges[i.badgeKey] || 0 } : i)),
  }));

  if (bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Restoring your session…" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        sections={sections}
        variant="platform"
        footer={
          <div className="px-2 py-1.5">
            <p className="truncate text-xs font-medium">{user?.name}</p>
            <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
              {user?.role?.replace(/_/g, ' ')}
            </p>
          </div>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
        <Topbar />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
          <PageErrorBoundary key={location.pathname}>
            <Suspense fallback={<LoadingState />}>
              <Outlet key={location.pathname} />
            </Suspense>
          </PageErrorBoundary>
        </main>
        <footer className="border-t px-4 py-3 text-center text-[11px] text-muted-foreground sm:px-6">
          ElevIQ BizFlow · Service Provider Console · v1.0.0
        </footer>
      </div>
      <BottomNav sections={sections} primary={platformMobileTabs} homeTo="/platform" />
    </div>
  );
}
