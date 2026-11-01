import * as React from 'react';
import { cn } from '@/utils/cn';

/**
 * Controlled tabs (underline style).
 * Usage:
 *   <Tabs value={v} onChange={setV} items={[{ value:'a', label:'A', badge: 3 }]} />
 *   <TabPanel value="a" active={v}>...</TabPanel>
 */
export function Tabs({ items = [], value, onChange, className, size = 'md' }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b no-scrollbar', className)} role="tablist">
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
              'relative whitespace-nowrap px-3.5 font-medium transition-colors focus-ring',
              size === 'sm' ? 'py-2 text-xs' : 'py-3 text-sm',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span className="inline-flex items-center gap-2">
              {item.icon && <item.icon className="h-4 w-4" />}
              {item.label}
              {item.badge !== undefined && item.badge !== null && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                  )}
                >
                  {item.badge}
                </span>
              )}
            </span>
            {active && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" aria-hidden="true" />
            )}
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
