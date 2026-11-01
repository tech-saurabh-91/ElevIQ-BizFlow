import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Lightweight dropdown menu (portal-free, click-outside + Esc to close).
 * Avoids a Radix dependency while keeping keyboard basics.
 */
export function DropdownMenu({ trigger, children, align = 'end', className, width = 'w-56' }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative inline-block text-left', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="focus-ring inline-flex w-full items-center justify-between gap-2"
      >
        {trigger}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 mt-1 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg animate-fade-in',
            align === 'end' ? 'right-0' : 'left-0',
            width
          )}
          onClick={() => setOpen(false)}
        >
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  );
}

export const DropdownMenuItem = ({ className, ...props }) => (
  <button
    type="button"
    role="menuitem"
    className={cn(
      'flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent focus-ring',
      className
    )}
    {...props}
  />
);

export const DropdownMenuSeparator = ({ className }) => (
  <div className={cn('my-1 h-px bg-border', className)} />
);

export const DropdownMenuLabel = ({ className, children }) => (
  <div className={cn('px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground', className)}>
    {children}
  </div>
);

/** Convenience: trigger button with a caret. */
export const MenuTrigger = ({ children, className, caret = true }) => (
  <span className={cn('inline-flex items-center gap-2', className)}>
    {children}
    {caret && <ChevronDown className="h-4 w-4 opacity-60" />}
  </span>
);

export default DropdownMenu;
