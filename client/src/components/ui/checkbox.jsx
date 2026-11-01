import * as React from 'react';
import { cn } from '@/utils/cn';

/**
 * Native checkbox with a consistent label/description layout.
 * Kept dependency-free (no Radix) like the rest of the UI kit.
 */
export const Checkbox = React.forwardRef(
  ({ className, label, description, id, ...props }, ref) => {
    const autoId = React.useId();
    const inputId = id || autoId;

    if (!label && !description) {
      return (
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className={cn(
            'h-4 w-4 rounded border-input text-primary accent-primary focus-ring disabled:opacity-50',
            className
          )}
          {...props}
        />
      );
    }

    return (
      <div className={cn('flex items-start gap-2.5', className)}>
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-input text-primary accent-primary focus-ring disabled:opacity-50"
          {...props}
        />
        <label htmlFor={inputId} className="cursor-pointer select-none text-sm leading-tight">
          <span className="font-medium text-foreground">{label}</span>
          {description && (
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{description}</span>
          )}
        </label>
      </div>
    );
  }
);
Checkbox.displayName = 'Checkbox';

export default Checkbox;
