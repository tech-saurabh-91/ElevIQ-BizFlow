import { Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';

/** Shared auth-screen chrome: brand panel + form panel, responsive. */
export default function AuthLayout({ children, variant = 'company' }) {
  const { user, bootstrapping } = useAuth();
  const location = useLocation();

  useEffect(() => {
    document.title = `${variant === 'platform' ? 'Platform Admin' : 'Sign in'} · ElevIQ SFA`;
    return () => {
      document.title = 'ElevIQ SFA';
    };
  }, [variant]);

  if (bootstrapping) return null;
  if (user) {
    return <Navigate to={user.scope === 'platform' ? '/platform' : '/app'} replace />;
  }

  const isPlatform = variant === 'platform';

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ---- Brand panel ---- */}
      <aside className="relative hidden overflow-hidden bg-[#0b1220] text-white lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'radial-gradient(600px 300px at 10% 10%, #3287fc55, transparent), radial-gradient(500px 400px at 90% 80%, #1452de55, transparent)',
          }}
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 text-lg font-black shadow-lg">
            E
          </span>
          <div className="leading-tight">
            <p className="text-lg font-bold">
              ElevIQ <span className="text-brand-400">SFA</span>
            </p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/50">
              {isPlatform ? 'Service Provider Console' : 'Sales Force Automation'}
            </p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight">
            {isPlatform ? 'Run your entire SaaS business from one console.' : 'Book orders. Invoice faster. Get paid sooner.'}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            {isPlatform
              ? 'Register companies, assign plans, monitor business health, and support your customers — with full auditability.'
              : 'Field sales, order booking, invoicing, collections, inventory and business tracking — built for retail & wholesale teams.'}
          </p>

          <ul className="mt-8 grid gap-3 text-sm text-white/80">
            {(isPlatform
              ? ['Company 360° business tracking', 'Plans, subscriptions & revenue', 'Impersonation with audit trail']
              : ['Order booking with credit & stock checks', 'Partial invoicing from orders', 'GPS field-force tracking & ageing reports']
            ).map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/40">
          © {new Date().getFullYear()} ElevIQ SFA · Multi-tenant SaaS
        </p>
      </aside>

      {/* ---- Form panel ---- */}
      <main className="flex flex-col justify-center px-5 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          {/* Mobile brand row */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 font-black text-white">
              E
            </span>
            <div className="leading-tight">
              <p className="font-bold">
                ElevIQ <span className="text-brand-500">SFA</span>
              </p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {isPlatform ? 'Service Provider Console' : 'Sales Force Automation'}
              </p>
            </div>
          </div>

          {children}

          <p className="mt-8 text-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} ElevIQ SFA. All rights reserved.
          </p>
        </div>
      </main>
    </div>
  );
}
