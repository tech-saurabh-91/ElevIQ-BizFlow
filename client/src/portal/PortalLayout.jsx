import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ClipboardList, Home, LogOut, ShoppingBag, ShoppingCart, UserRound } from 'lucide-react';
import { LoadingState } from '@/components/ui/misc';
import { setFormatDefaults } from '@/utils/format';
import { cn } from '@/utils/cn';
import portalApi, { refreshPortal } from './portalApi';
import { usePortalStore } from './portalStore';
import { portalPath, usePortalCode } from './portal-shared';

/**
 * Point the browser's "Install app" at this company's portal (opens on
 * /portal/<CODE>/, not the staff login), for as long as the portal is open.
 */
const useCompanyManifest = (code) => {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link || !code) return undefined;
    const before = link.getAttribute('href');
    link.setAttribute('href', `/api/portal/company/${encodeURIComponent(code)}/manifest.webmanifest`);
    return () => {
      if (before) link.setAttribute('href', before);
    };
  }, [code]);
};

/** Signed-in session for this company: restores it from the refresh cookie on a cold load. */
const usePortalSession = (code) => {
  const session = usePortalStore((s) => s.session);
  const token = usePortalStore((s) => s.accessToken);
  const [state, setState] = useState(token ? 'ready' : 'checking');

  useEffect(() => {
    if (token) {
      setState('ready');
      return;
    }
    let live = true;
    refreshPortal()
      .then(() => live && setState('ready'))
      .catch(() => {
        usePortalStore.getState().clear();
        if (live) setState('out');
      });
    return () => {
      live = false;
    };
  }, [token]);

  // The cookie belongs to a login of another company: treat as signed out here.
  const sameCompany = !session || session.company?.code === code;
  return { session, state: sameCompany ? state : 'out' };
};

const TABS = [
  { to: '', label: 'Home', icon: Home, end: true },
  { to: 'catalog', label: 'Order', icon: ShoppingBag },
  { to: 'orders', label: 'My orders', icon: ClipboardList },
  { to: 'account', label: 'Account', icon: UserRound },
];

export default function PortalLayout() {
  const code = usePortalCode();
  const location = useLocation();
  const { session, state } = usePortalSession(code);
  const cartCount = usePortalStore((s) => (s.carts[code] || []).length);
  useCompanyManifest(code);

  useEffect(() => {
    const company = session?.company;
    if (!company) return;
    setFormatDefaults({ currency: company.currency, timeZone: company.timezone, locale: company.country === 'IN' ? 'en-IN' : undefined });
    document.title = `${company.name} · Order online`;
  }, [session?.company]);

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="Opening your account…" />
      </div>
    );
  }
  if (state === 'out' || !session) {
    return <Navigate to={portalPath(code, 'login')} replace state={{ from: location.pathname }} />;
  }
  // A PIN given by the company must be replaced first.
  if (session.account?.mustChangePin && !location.pathname.endsWith('/account/pin')) {
    return <Navigate to={portalPath(code, 'account/pin')} replace />;
  }

  const logout = async () => {
    try {
      await portalApi.post('/auth/logout');
    } catch {
      /* signing out locally anyway */
    }
    usePortalStore.getState().clear();
    window.location.assign(portalPath(code, 'login'));
  };

  const { company, customer } = session;
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <Link to={portalPath(code)} className="flex min-w-0 flex-1 items-center gap-2.5">
            {company.logo ? (
              <img src={company.logo} alt="" className="h-8 w-8 rounded-md object-contain" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500/15 text-xs font-bold text-brand-600">
                {company.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight">{company.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{customer.name}</span>
            </span>
          </Link>
          <Link
            to={portalPath(code, 'cart')}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-accent"
            aria-label={`Cart, ${cartCount} items`}
          >
            <ShoppingCart className="h-5 w-5" />
            {cartCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full bg-primary px-1 text-center text-[11px] font-bold leading-5 text-primary-foreground">
                {cartCount}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={logout}
            className="hidden h-10 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent sm:inline-flex"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-4">
        <Outlet context={{ logout }} />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-4">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={label}
              to={portalPath(code, to)}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
