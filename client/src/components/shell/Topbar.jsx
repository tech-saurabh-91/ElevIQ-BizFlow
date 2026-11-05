import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';
import { Bell, LogOut, Menu, Moon, Sun, UserRound, KeyRound, ChevronDown, Eye, LogIn } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/uiStore';
import { WorkspaceBadge } from '@/components/brand/Logo';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { APP_NAME } from '@/utils/format';

/**
 * Top bar.
 *
 * Deliberately shows BOTH identities side by side:
 *   [Company name]            ← who signed in (tenant workspace)
 *   ElevIQ SFA                ← the product, always visible underneath
 *
 * While a platform admin is impersonating a tenant, a persistent amber banner
 * sits above the bar with a one-click "Exit workspace".
 */
export default function Topbar({ onMenuClick }) {
  const { user, company, scope, logout, impersonation, exitImpersonation } = useAuth();
  // Unread badge for workspace users (same key as the Notifications page, so
  // reading there clears it here).
  const unread = useQuery({
    queryKey: ['company', 'notifications', 'unread-count'],
    queryFn: async () => (await api.get('/v1/notifications/unread-count')).data?.data ?? { unread: 0 },
    enabled: scope !== 'platform' && Boolean(user),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const notificationCount = scope !== 'platform' ? Number(unread.data?.unread || 0) : 0;
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const navigate = useNavigate();
  const [exiting, setExiting] = useState(false);

  const companyName = company?.name || user?.companyName || '';
  const appName = APP_NAME;

  const handleExit = async () => {
    setExiting(true);
    try {
      const { companyId } = await exitImpersonation();
      toast.success('Exited the workspace');
      navigate(companyId ? `/platform/companies/${companyId}` : '/platform', { replace: true });
    } finally {
      setExiting(false);
    }
  };

  return (
    <>
      {impersonation && (
        <div
          role="status"
          className="sticky top-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-warning/40 bg-warning/15 px-4 py-2 text-xs font-medium text-warning-foreground dark:text-warning"
        >
          <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Support mode — viewing <span className="font-semibold">{impersonation.company?.name || 'workspace'}</span>
            {' as '}
            <span className="font-semibold">{impersonation.actingAs?.name}</span>
            {impersonation.actingAs?.role ? ` (${impersonation.actingAs.role})` : ''}
          </span>
          <Button size="sm" variant="outline" loading={exiting} onClick={handleExit} className="h-7 px-2.5 text-xs">
            <LogIn className="mr-1.5 h-3.5 w-3.5" />
            Exit workspace
          </Button>
        </div>
      )}
    <header className="sticky z-30 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6" style={impersonation ? { top: 38 } : { top: 0 }}>
      <button
        type="button"
        onClick={onMenuClick}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent focus-ring lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Identity: company + product */}
      <div className="min-w-0 flex-1">
        <WorkspaceBadge appName={appName} companyName={companyName} logo={company?.logo} />
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* Notifications */}
        <button
          type="button"
          onClick={() => navigate(scope === 'platform' ? '/platform/announcements' : '/app/notifications')}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent focus-ring"
          aria-label={`Notifications${notificationCount ? ` (${notificationCount})` : ''}`}
        >
          <Bell className="h-[18px] w-[18px]" />
          {notificationCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          )}
        </button>

        {/* Theme */}
        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent focus-ring"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>

        {/* User menu */}
        <DropdownMenu
          align="end"
          width="w-60"
          trigger={
            <span className="inline-flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-accent focus-ring">
              <Avatar name={user?.name || 'User'} src={user?.avatar} size="sm" />
              <span className="hidden flex-col items-start leading-tight sm:flex">
                <span className="max-w-[140px] truncate text-sm font-medium">{user?.name}</span>
                <span className="max-w-[140px] truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {user?.title || user?.role}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 opacity-60" />
            </span>
          }
        >
          {({ close }) => (
            <>
              <DropdownMenuLabel>
                {user?.email || user?.phone || 'Signed in'}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  close();
                  navigate(scope === 'platform' ? '/platform/profile' : '/app/profile');
                }}
              >
                <UserRound className="h-4 w-4" /> My profile
              </DropdownMenuItem>
              {!impersonation && (
                <DropdownMenuItem
                  onClick={() => {
                    close();
                    navigate('/app/change-password');
                  }}
                >
                  <KeyRound className="h-4 w-4" /> Change password
                </DropdownMenuItem>
              )}
              {!impersonation && (
                <DropdownMenuItem
                  onClick={() => {
                    close();
                    navigate('/app/sessions');
                  }}
                >
                  <Bell className="h-4 w-4" /> Active sessions
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  close();
                  if (impersonation) {
                    handleExit();
                  } else {
                    logout();
                  }
                }}
              >
                <LogOut className="h-4 w-4" /> {impersonation ? 'Exit workspace' : 'Sign out'}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenu>
      </div>
    </header>
    </>
  );
}
