import { cn } from '@/utils/cn';

const tones = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  success: 'border-transparent bg-success/15 text-success dark:bg-success/20',
  warning: 'border-transparent bg-warning/20 text-warning-foreground dark:text-warning',
  destructive: 'border-transparent bg-destructive/15 text-destructive dark:bg-destructive/20',
  info: 'border-transparent bg-brand-500/15 text-brand-600 dark:text-brand-300',
  outline: 'border-border text-foreground',
  muted: 'border-transparent bg-muted text-muted-foreground',
};

export function Badge({ className, tone = 'default', dot = false, children, ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        tones[tone] || tones.default,
        className
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Status -> tone mapping used across the app for consistent colours. */
export const STATUS_TONE = {
  ACTIVE: 'success',
  TRIAL: 'info',
  SUSPENDED: 'destructive',
  EXPIRED: 'destructive',
  CANCELLED: 'muted',
  DRAFT: 'muted',
  PENDING_APPROVAL: 'warning',
  CONFIRMED: 'success',
  PARTIALLY_INVOICED: 'info',
  FULLY_INVOICED: 'success',
  DISPATCHED: 'info',
  DELIVERED: 'success',
  REJECTED: 'destructive',
  ISSUED: 'info',
  POSTED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'destructive',
  APPROVED: 'success',
  SUBMITTED: 'info',
  PENDING: 'warning',
  PAID_OUT: 'success',
  NO_ORDER: 'muted',
  ORDER_TAKEN: 'success',
  PAYMENT_COLLECTED: 'success',
  RECEIVED: 'success',
  BOUNCED: 'destructive',
};

export const StatusBadge = ({ status, className, ...props }) => (
  <Badge tone={STATUS_TONE[status] || 'muted'} className={cn('uppercase', className)} {...props}>
    {String(status || '').replace(/_/g, ' ')}
  </Badge>
);

export default Badge;
