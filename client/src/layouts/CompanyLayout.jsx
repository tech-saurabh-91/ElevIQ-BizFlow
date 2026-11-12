import { Outlet, useLocation } from 'react-router-dom';
import { Suspense } from 'react';
import { Link } from 'react-router-dom';
import Sidebar from '@/components/shell/Sidebar';
import Topbar from '@/components/shell/Topbar';
import BottomNav from '@/components/shell/BottomNav';
import { LoadingState, Progress } from '@/components/ui/misc';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { companyNav, filterNav, mobileTabs } from '@/routes/navigation';
import { useCountries, findCountry } from '@/hooks/useLocations';
import { setFormatDefaults } from '@/utils/format';
import { FieldDayGate } from '@/components/company/FieldDay';
import { useInventoryMode } from '@/components/company/cost-margin';

/**
 * Company workspace shell: /app/*
 *
 * The signed-in company name + "ElevIQ SFA" are shown in the top bar
 * (see Topbar -> WorkspaceBadge), and again in the footer.
 */
export default function CompanyLayout() {
  const { user, company, settings, logout, bootstrapping } = useAuth();
  const { can } = usePermissions();
  const { salesOnly } = useInventoryMode();
  const location = useLocation();
  const { data: countries = [] } = useCountries();
  const countryCode = findCountry(countries, company?.country)?.code;

  // Every money/date on screen follows the company's localisation settings.
  // Applied during render (idempotent) so the first paint is already correct.
  setFormatDefaults({
    currency: settings?.currency || company?.currency,
    locale: countryCode ? `en-${countryCode}` : undefined,
    timeZone: settings?.timezone || company?.timezone,
    dateFormat: settings?.dateFormat,
  });

  if (bootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Restoring your workspace…" />
      </div>
    );
  }

  const sections = filterNav(companyNav, { can, scope: user?.scope, role: user?.role, user, salesOnly });

  const limits = user?.limits || {};
  const usage = null; // surfaced once /dashboard/usage exists (Phase 8)

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        sections={sections}
        variant="company"
        footer={
          <div className="space-y-2 px-1 py-1">
            <div className="flex items-center gap-2 px-1.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-xs font-bold text-brand-600 dark:text-brand-300">
                {(company?.name || 'C').slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-xs font-semibold" title={company?.name}>
                  {company?.name}
                </p>
                <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {company?.code} · {company?.status}
                </p>
              </div>
            </div>
            {usage && (
              <div className="px-1.5">
                <Progress value={usage.pct} label={usage.label} showLabel />
              </div>
            )}
            <Link
              to="/app/settings"
              className="block rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-ring"
            >
              Need help? Contact support
            </Link>
          </div>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
        <Topbar />
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
          <Suspense fallback={<LoadingState />}>
            <FieldDayGate pathname={location.pathname}>
              <Outlet key={location.pathname} />
            </FieldDayGate>
          </Suspense>
        </main>
        <footer className="border-t px-4 py-3 text-center text-[11px] text-muted-foreground sm:px-6">
          {company?.name ? `${company.name} · ` : ''}Powered by <span className="font-semibold">ElevIQ SFA</span> ·
          v1.0.0
        </footer>
      </div>
      <BottomNav sections={sections} primary={mobileTabs(user?.role)} homeTo="/app" />
    </div>
  );
}
