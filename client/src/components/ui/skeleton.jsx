import { cn } from '@/utils/cn';

export function Skeleton({ className, ...props }) {
  return <div className={cn('skeleton', className)} {...props} />;
}

/** Table-shaped skeleton for list pages. */
export function TableSkeleton({ rows = 6, cols = 5, className }) {
  return (
    <div className={cn('space-y-3 p-4', className)}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cn('h-4 flex-1', c === 0 && 'max-w-[30%]')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Card-shaped skeleton for dashboards. */
export function CardSkeleton({ className }) {
  return (
    <div className={cn('card p-6 space-y-4', className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}

export const SkeletonText = ({ lines = 3, className }) => (
  <div className={cn('space-y-2', className)}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
    ))}
  </div>
);

export default Skeleton;
