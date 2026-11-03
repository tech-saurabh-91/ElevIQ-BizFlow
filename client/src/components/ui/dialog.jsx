import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion } from '@/lib/motion';
import { cn } from '@/utils/cn';

/**
 * Accessible modal built on a portal (no external UI dependency).
 * - Esc / backdrop click to close (disable with `dismissible={false}`)
 * - Focus is moved into the dialog on open and restored on close
 * - Sizes: sm | md | lg | xl | full
 */
const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[95vw] h-[92vh]',
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  className,
}) {
  const panelRef = React.useRef(null);
  const previouslyFocused = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    // Focus the panel (or first focusable) after paint.
    const t = setTimeout(() => {
      const focusable = panelRef.current?.querySelector(
        'input, select, textarea, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      (focusable || panelRef.current)?.focus();
    }, 30);

    const onKey = (e) => {
      if (e.key === 'Escape' && dismissible) onClose?.();
      if (e.key === 'Tab' && panelRef.current) {
        const nodes = panelRef.current.querySelectorAll(
          'input, select, textarea, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        );
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose, dismissible]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => dismissible && onClose?.()}
        aria-hidden="true"
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : 'Dialog'}
        tabIndex={-1}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className={cn(
          // Cap the height to the viewport so long forms scroll inside the body
          // instead of being cut off above/below the screen.
          'relative z-10 flex max-h-[95dvh] w-full flex-col overflow-hidden rounded-t-2xl border bg-card shadow-2xl sm:max-h-[90dvh] sm:rounded-2xl',
          sizes[size],
          className
        )}
      >
        <div className="flex items-start gap-4 border-b px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-base font-semibold leading-tight">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={() => onClose?.()}
              className="-mr-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-ring"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3.5 sm:px-6">
            {footer}
          </div>
        )}
      </motion.div>
    </div>,
    document.body
  );
}

/** Confirmation dialog for destructive actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'destructive',
  loading = false,
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-10 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent focus-ring disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'h-10 rounded-md px-4 text-sm font-medium text-white focus-ring disabled:opacity-60',
              tone === 'destructive' ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90'
            )}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </Dialog>
  );
}

export default Dialog;
