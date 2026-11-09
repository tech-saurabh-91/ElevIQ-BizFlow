import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Standard page header: title, subtitle, breadcrumbs and action buttons.
 * Keeps every screen visually consistent.
 */
export function PageHeader({ title, description, actions, breadcrumbs = [], className, children }) {
  // Phones get an app-style back link to the nearest parent instead of the trail.
  const parent = [...breadcrumbs].reverse().find((c) => c.to);
  return (
    <header className={cn('mb-4 sm:mb-5', className)}>
      {parent && (
        <Link
          to={parent.to}
          className="-ml-1 mb-1.5 inline-flex items-center gap-0.5 rounded-md py-1 pr-2 text-sm font-medium text-primary focus-ring sm:hidden"
        >
          <ChevronLeft className="h-4 w-4" />
          {parent.label}
        </Link>
      )}
      {breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 hidden flex-wrap items-center gap-1 text-xs text-muted-foreground sm:flex">
          {breadcrumbs.map((c, i) => (
            <React.Fragment key={`${c.label}-${i}`}>
              {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden="true" />}
              {c.to ? (
                <Link to={c.to} className="hover:text-foreground focus-ring rounded">
                  {c.label}
                </Link>
              ) : (
                <span className="text-foreground/80">{c.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight [overflow-wrap:anywhere] sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground max-sm:text-[13px]">{description}</p>}
        </div>
        {/* Phones: one swipeable row of actions instead of several wrapped lines. */}
        {actions && (
          <div className="no-scrollbar flex shrink-0 flex-wrap items-center gap-2 max-sm:-mx-3 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-3 max-sm:[&>*]:h-9 max-sm:[&>*]:shrink-0 max-sm:[&>*]:text-[13px]">
            {actions}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}

export default PageHeader;
