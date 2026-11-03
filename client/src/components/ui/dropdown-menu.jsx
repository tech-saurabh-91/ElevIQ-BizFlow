import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';

const GAP = 4;
const EDGE = 8;

/**
 * Lightweight dropdown menu (click-outside + Esc to close).
 * Avoids a Radix dependency while keeping keyboard basics.
 *
 * The menu is portalled to <body> with fixed positioning so scrollable table
 * wrappers cannot clip it, and it flips above the trigger when there is not
 * enough room below (e.g. the last rows of a list).
 */
export function DropdownMenu({ trigger, children, align = 'end', className, width = 'w-56' }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const ref = React.useRef(null);
  const menuRef = React.useRef(null);

  const place = React.useCallback(() => {
    const anchor = ref.current?.getBoundingClientRect();
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const { offsetHeight: h, offsetWidth: w } = menu;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const below = vh - anchor.bottom - GAP - EDGE;
    const above = anchor.top - GAP - EDGE;
    const up = h > below && above > below;
    let top = up ? anchor.top - GAP - h : anchor.bottom + GAP;
    top = Math.max(EDGE, Math.min(top, vh - h - EDGE));

    let left = align === 'end' ? anchor.right - w : anchor.left;
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));

    setPos({ top, left, maxHeight: vh - EDGE * 2 });
  }, [align]);

  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Keep the menu attached to its trigger while the page or a table scrolls.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

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

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={
              pos
                ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
                : { top: 0, left: 0, visibility: 'hidden' }
            }
            className={cn(
              'fixed z-[60] min-w-[10rem] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg animate-fade-in',
              width
            )}
            onClick={() => setOpen(false)}
          >
            {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
          </div>,
          document.body
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
