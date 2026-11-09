import { NavLink } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { Logo } from '@/components/brand/Logo';
import { useUIStore } from '@/store/uiStore';
import { ChevronLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

/**
 * Sidebar navigation.
 * - Sections + items from the nav registry (already permission-filtered)
 * - Desktop only (lg and up), collapsible to icons; phones use BottomNav
 * - Brand block at the top always shows "ElevIQ SFA"
 */
export default function Sidebar({ sections = [], footer, onNavigate, variant = 'company' }) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);

  const width = collapsed ? 'lg:w-[68px]' : 'lg:w-64';

  return (
    <>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-card lg:flex',
          width
        )}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className={cn('flex h-16 shrink-0 items-center border-b px-4', collapsed && 'lg:justify-center lg:px-0')}>
          <NavLink to={variant === 'platform' ? '/platform' : '/app'} className="focus-ring rounded-lg" onClick={onNavigate}>
            <span className={cn(collapsed && 'lg:hidden')}>
              <Logo size="sm" />
            </span>
            {collapsed && (
              <span className="hidden lg:inline-flex">
                <Logo compact size="sm" />
              </span>
            )}
          </NavLink>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-4">
          {sections.map((section) => (
            <div key={section.section} className="mb-4 last:mb-0">
              {!collapsed && (
                <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {section.section}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={onNavigate}
                        title={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'group flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors focus-ring',
                            collapsed && 'lg:justify-center lg:px-0',
                            isActive
                              ? 'bg-primary/12 text-primary dark:bg-primary/15'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          )
                        }
                      >
                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                        <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                        {item.badge > 0 && (
                          <span
                            className={cn(
                              'ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground',
                              collapsed && 'lg:hidden'
                            )}
                          >
                            {item.badge}
                          </span>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer slot (user card / plan usage) */}
        {footer && <div className="shrink-0 border-t p-2.5">{footer}</div>}

        {/* Collapse toggle (desktop only) */}
        <button
          type="button"
          onClick={toggle}
          className="hidden shrink-0 items-center justify-center gap-2 border-t py-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-ring lg:flex"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><ChevronLeft className="h-4 w-4" /> Collapse</>}
        </button>
      </aside>
    </>
  );
}
