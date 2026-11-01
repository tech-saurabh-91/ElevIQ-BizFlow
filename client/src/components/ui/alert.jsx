import * as React from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/utils/cn';

const tones = {
  default: 'border-border bg-card text-card-foreground',
  info: 'border-brand-500/30 bg-brand-500/10 text-foreground',
  success: 'border-success/30 bg-success/10 text-foreground',
  warning: 'border-warning/40 bg-warning/10 text-foreground',
  destructive: 'border-destructive/30 bg-destructive/10 text-foreground',
};

const icons = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  destructive: AlertCircle,
};

export function Alert({ tone = 'default', className, icon: Icon, children, onClose, ...props }) {
  const ResolvedIcon = Icon || icons[tone] || Info;
  return (
    <div
      role="alert"
      className={cn('relative flex w-full items-start gap-3 rounded-lg border p-4 text-sm', tones[tone], className)}
      {...props}
    >
      <ResolvedIcon className={cn('mt-0.5 h-4 w-4 shrink-0', {
        'text-brand-500': tone === 'info',
        'text-success': tone === 'success',
        'text-warning': tone === 'warning',
        'text-destructive': tone === 'destructive',
      })} />
      <div className="flex-1 min-w-0">{children}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 opacity-60 hover:opacity-100 focus-ring"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export const AlertTitle = ({ className, children }) => (
  <p className={cn('mb-1 font-medium', className)}>{children}</p>
);
export const AlertDescription = ({ className, children }) => (
  <p className={cn('text-sm opacity-90', className)}>{children}</p>
);

/** Inline error box used by forms/pages for API failures. */
export const ErrorAlert = ({ title = 'Something went wrong', message, errors = [], onClose }) =>
  message || errors.length ? (
    <Alert tone="destructive" onClose={onClose}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {message}
        {errors.length > 0 && (
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  ) : null;

export default Alert;
