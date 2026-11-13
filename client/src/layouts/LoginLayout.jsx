import { Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { LogoMark } from '@/components/brand/Logo';
import BusinessJourney from '@/components/auth/BusinessJourney';

/**
 * Company sign-in screen: the animated "business journey" on the left (60%),
 * the sign-in card on the right (40%). On tablets and phones a compact scene
 * sits above the form so the form is still reached without scrolling.
 * Same auth guards as AuthLayout.
 */
export default function LoginLayout({ children }) {
  const { user, bootstrapping } = useAuth();
  const desktop = useMediaQuery('(min-width: 1024px)');

  useEffect(() => {
    document.title = 'Sign in · ElevIQ Bizflow';
    return () => {
      document.title = 'ElevIQ SFA';
    };
  }, []);

  if (bootstrapping) return null;
  if (user) return <Navigate to={user.scope === 'platform' ? '/platform' : '/app'} replace />;

  return (
    <div className="min-h-screen bg-muted/40 lg:grid lg:grid-cols-[3fr_2fr]">
      {/* ---- The business journey ---- */}
      <aside className="relative h-[210px] overflow-hidden rounded-b-[28px] bg-[#070d1c] text-white sm:h-[290px] lg:sticky lg:top-0 lg:h-screen lg:rounded-none">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(900px 520px at 70% 45%, rgba(50,135,252,.28), transparent 65%), radial-gradient(700px 500px at 0% 100%, rgba(20,82,222,.30), transparent 60%), radial-gradient(500px 400px at 100% 0%, rgba(124,58,237,.16), transparent 60%)',
          }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 lg:top-36">
          <BusinessJourney compact={!desktop} />
        </div>

        <div className="pointer-events-none relative z-20 hidden lg:block lg:px-10 lg:pt-9">
          <div className="flex items-center gap-2.5">
            <LogoMark size={40} />
            <div className="leading-tight">
              <p className="text-lg font-bold tracking-tight">
                ElevIQ <span className="text-brand-400">Bizflow</span>
              </p>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">
                by ElevIQ Technologies
              </p>
            </div>
          </div>
          <div className="mt-7 max-w-xl">
            <h2 className="text-3xl font-extrabold leading-tight tracking-tight xl:text-4xl">
              Your Business. Your Orders.{' '}
              <span className="bg-gradient-to-r from-brand-300 to-violet-300 bg-clip-text text-transparent">
                Your Control.
              </span>
            </h2>
            <p className="mt-2 text-sm text-white/65">Smarter Business Management Starts Here.</p>
          </div>
        </div>
      </aside>

      {/* ---- Sign-in card ---- */}
      <main className="flex flex-col justify-center px-4 pb-10 pt-6 sm:px-10 lg:min-h-screen lg:px-12 lg:py-10">
        <div className="mx-auto w-full max-w-md">
          <div className="rounded-2xl border bg-card p-6 shadow-xl shadow-slate-900/5 sm:p-8">
            {children}
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Powered by <span className="font-semibold text-foreground">ElevIQ Technologies</span>
          </p>
          <p className="mt-1 text-center text-[11px] text-muted-foreground/80">
            © {new Date().getFullYear()} ElevIQ Technologies. All rights reserved.
          </p>
        </div>
      </main>
    </div>
  );
}
