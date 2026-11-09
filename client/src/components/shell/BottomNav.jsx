import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutGrid, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useUIStore } from '@/store/uiStore';

/**
 * Phone / tablet navigation (below `lg`), like a native app:
 *  - a fixed tab bar at the bottom: Home + the role's most used screens + More
 *  - "More" opens a sheet with every other screen as icon tiles, by section
 * Desktop keeps the sidebar. Items come already permission-filtered.
 */

// Short labels for the tab bar (the sheet keeps the full ones).
const SHORT = {
  'Sales Visit': 'Visit',
  'My Orders': 'Orders',
  'My Invoices': 'Invoices',
  'My Collections': 'Collect',
  'Payments & Collections': 'Payments',
  'Platform Reports': 'Reports',
};

const isActivePath = (pathname, item) =>
  item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

export default function BottomNav({ sections = [], primary = [], homeTo, footer }) {
  const { pathname } = useLocation();
  const moreOpen = useUIStore((s) => s.mobileNavOpen);
  const setMoreOpen = useUIStore((s) => s.setMobileNav);

  // One entry per route (a route can sit in two sections).
  const all = [];
  sections.forEach((s) => s.items.forEach((i) => !all.some((a) => a.to === i.to) && all.push(i)));
  const home = all.find((i) => i.to === homeTo);
  const tabs = [home, ...primary.map((to) => all.find((i) => i.to === to)).filter(Boolean)]
    .filter(Boolean)
    .slice(0, 4);
  const moreActive = !tabs.some((t) => isActivePath(pathname, t));

  // Close the sheet when the page changes; lock page scroll while it is open.
  useEffect(() => setMoreOpen(false), [pathname, setMoreOpen]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [moreOpen, setMoreOpen]);

  const tabClass = (active) =>
    cn(
      'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[10.5px] font-medium transition-colors focus-ring',
      active ? 'text-primary' : 'text-muted-foreground'
    );

  // Form screens (new / edit) use the bottom edge for their own Save bar.
  if (/\/(new|edit)$/.test(pathname)) return null;

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="All menus">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMoreOpen(false)} aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border-t bg-card pb-[calc(4rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
              <p className="text-sm font-semibold">All menus</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent focus-ring"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain px-3 pb-3">
              {sections.map((section) => (
                <div key={section.section} className="mb-4 last:mb-1">
                  <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {section.section}
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const active = isActivePath(pathname, item);
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.end}
                          className={cn(
                            'relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-center text-[11px] font-medium leading-tight focus-ring',
                            active ? 'bg-primary/12 text-primary' : 'text-foreground/85 hover:bg-accent'
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-10 w-10 items-center justify-center rounded-xl',
                              active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground/80'
                            )}
                          >
                            <Icon className="h-5 w-5" aria-hidden="true" />
                          </span>
                          <span className="line-clamp-2 w-full break-words">{item.label}</span>
                          {item.badge > 0 && (
                            <span className="absolute right-2 top-1.5 rounded-full bg-primary px-1.5 text-[9px] font-semibold text-primary-foreground">
                              {item.badge}
                            </span>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              ))}
              {footer && <div className="mt-2 border-t pt-3">{footer}</div>}
            </div>
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-card/85 lg:hidden"
        aria-label="Main navigation"
      >
        <div className="mx-auto flex h-16 max-w-xl items-stretch">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = !moreOpen && isActivePath(pathname, item);
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={tabClass(active)}>
                <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', active && 'bg-primary/12')}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="max-w-full truncate px-0.5">{item.to === homeTo ? 'Home' : SHORT[item.label] || item.label}</span>
              </NavLink>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} className={tabClass(moreOpen || moreActive)} aria-expanded={moreOpen}>
            <span className={cn('flex h-7 w-12 items-center justify-center rounded-full transition-colors', (moreOpen || moreActive) && 'bg-primary/12')}>
              <LayoutGrid className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
