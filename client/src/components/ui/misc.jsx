import { cn } from '@/utils/cn';

/** Spinner / Loader used for inline and page-level loading states. */
export function Spinner({ className, size = 'md' }) {
  const s = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-8 w-8' }[size] || 'h-5 w-5';
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', s, className)}
    />
  );
}

/** Full-area loading overlay for pages/panels. */
export const LoadingState = ({ label = 'Loading…', className }) => (
  <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground', className)}>
    <Spinner size="lg" className="text-primary" />
    <p className="text-sm">{label}</p>
  </div>
);

export const Separator = ({ className, orientation = 'horizontal' }) => (
  <div
    role="separator"
    aria-orientation={orientation}
    className={cn(
      orientation === 'horizontal' ? 'h-px w-full bg-border' : 'h-full w-px bg-border',
      className
    )}
  />
);

/** Determinate progress bar (targets, plan usage, etc.). */
export function Progress({ value = 0, max = 100, tone = 'primary', showLabel = false, className, label }) {
  const pct = Math.max(0, Math.min(100, (Number(value) / Number(max)) * 100 || 0));
  const tones = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    destructive: 'bg-destructive',
    info: 'bg-brand-500',
  };
  return (
    <div className={cn('space-y-1', className)}>
      {(showLabel || label) && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          <span className="font-medium text-foreground">{Math.round(pct)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full transition-all duration-500', tones[tone] || tones.primary)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

export const Kbd = ({ children, className }) => (
  <kbd
    className={cn(
      'pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground',
      className
    )}
  >
    {children}
  </kbd>
);

export default Spinner;
