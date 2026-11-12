import * as React from 'react';
import { cn } from '@/utils/cn';

/**
 * Controlled tabs (pill / segmented style).
 * Usage:
 *   <Tabs value={v} onChange={setV} items={[{ value:'a', label:'A', badge: 3 }]} />
 *   <TabPanel value="a" active={v}>...</TabPanel>
 */
export function Tabs({ items = [], value, onChange, className, size = 'md' }) {
  return (
    <div
      className={cn('no-scrollbar flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border bg-muted/60 p-1', className)}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(item.value)}
            className={cn(
              'relative shrink-0 whitespace-nowrap rounded-lg px-3.5 font-medium transition-all focus-ring',
              size === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-sm',
              active
                ? 'bg-gradient-to-r from-blue-600 to-indigo-500 text-white shadow-sm'
                : 'text-muted-foreground hover:bg-background hover:text-foreground'
            )}
          >
            <span className="inline-flex items-center gap-2">
              {item.icon && <item.icon className="h-4 w-4" />}
              {item.label}
              {item.badge !== undefined && item.badge !== null && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    active ? 'bg-white/25 text-white' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {item.badge}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const TabPanel = ({ value, active, children, className }) =>
  value === active ? (
    <div role="tabpanel" className={cn('animate-fade-in', className)}>
      {children}
    </div>
  ) : null;

export default Tabs;
