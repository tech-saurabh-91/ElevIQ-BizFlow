import { Inbox, SearchX, FileQuestion, PackageOpen } from 'lucide-react';
import { cn } from '@/utils/cn';

const icons = {
  empty: Inbox,
  search: SearchX,
  error: FileQuestion,
  package: PackageOpen,
};

/** Consistent empty / no-results / error states. */
export function EmptyState({
  icon = 'empty',
  title = 'Nothing here yet',
  description,
  action,
  compact = false,
  className,
}) {
  const Icon = icons[icon] || icons.empty;
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-16',
        className
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <Icon className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground text-balance">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Shown when a query fails. */
export const ErrorState = ({ message = 'We could not load this.', onRetry, title = 'Something went wrong' }) => (
  <EmptyState
    icon="error"
    title={title}
    description={message}
    action={
      onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-10 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent focus-ring"
        >
          Try again
        </button>
      )
    }
  />
);

export default EmptyState;
