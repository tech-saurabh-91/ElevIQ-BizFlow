import { cn } from '@/utils/cn';

/**
 * ElevIQ SFA brand mark.
 * Used in the sidebar, auth screens and the footer — always with the
 * "ElevIQ SFA" wordmark so the product identity is present everywhere.
 */
export function LogoMark({ className, size = 32 }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm',
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" width={size * 0.72} height={size * 0.72} fill="none">
        <path d="M14 46V18h10.5v20H36v8H14z" fill="currentColor" />
        <path d="M38 46l-6.5-11 6-10L45 33l6-10 6 10L45 46z" fill="currentColor" opacity="0.8" />
      </svg>
    </span>
  );
}

export function Logo({ size = 'md', className, showTagline = false, compact = false }) {
  const textSizes = { sm: 'text-sm', md: 'text-base', lg: 'text-lg', xl: 'text-xl' }[size] || 'text-base';
  const markSizes = { sm: 26, md: 30, lg: 34, xl: 38 }[size] || 30;

  if (compact) return <LogoMark size={markSizes} className={className} />;

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={markSizes} />
      <span className="flex flex-col leading-tight">
        <span className={cn('font-bold tracking-tight', textSizes)}>
          ElevIQ <span className="text-brand-500">SFA</span>
        </span>
        {showTagline && (
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Sales Force Automation
          </span>
        )}
      </span>
    </span>
  );
}

/** "Workspace" badge: shows ElevIQ SFA + the signed-in company name. */
export function WorkspaceBadge({ appName = 'ElevIQ SFA', companyName, className, logo }) {
  if (!companyName) return <Logo className={className} />;
  return (
    <span className={cn('flex min-w-0 items-center gap-3', className)}>
      {logo ? (
        <img
          src={logo}
          alt=""
          className="h-9 w-9 shrink-0 rounded-lg object-contain ring-1 ring-border"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-sm font-bold text-brand-600 dark:text-brand-300">
          {companyName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex flex-col leading-tight">
        <span className="truncate text-sm font-semibold" title={companyName}>
          {companyName}
        </span>
        <span className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {appName}
        </span>
      </span>
    </span>
  );
}

export default Logo;
