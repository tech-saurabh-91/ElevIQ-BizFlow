import * as React from 'react';
import { cn } from '@/utils/cn';

export const Input = React.forwardRef(({ className, type, error, ...props }, ref) => {
  return (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors',
        'placeholder:text-muted-foreground focus-ring disabled:cursor-not-allowed disabled:opacity-50',
        error && 'border-destructive focus-visible:ring-destructive',
        className
      )}
      aria-invalid={error ? 'true' : undefined}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export const Textarea = React.forwardRef(({ className, error, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm',
      'placeholder:text-muted-foreground focus-ring disabled:cursor-not-allowed disabled:opacity-50',
      error && 'border-destructive focus-visible:ring-destructive',
      className
    )}
    aria-invalid={error ? 'true' : undefined}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef(({ className, error, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm',
      'focus-ring disabled:cursor-not-allowed disabled:opacity-50',
      error && 'border-destructive',
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

export const Label = React.forwardRef(({ className, required, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('mb-1.5 block text-sm font-medium leading-none text-foreground', className)}
    {...props}
  >
    {props.children}
    {required && <span className="ml-0.5 text-destructive">*</span>}
  </label>
));
Label.displayName = 'Label';

/** Field wrapper that shows a label + server/validation error consistently. */
export const Field = ({ label, required, error, hint, children, className }) => (
  <div className={cn('space-y-1.5', className)}>
    {label && (
      <Label required={required}>{label}</Label>
    )}
    {typeof children === 'function' ? children({ error }) : children}
    {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
    {error && (
      <p className="text-xs font-medium text-destructive" role="alert">
        {error}
      </p>
    )}
  </div>
);

export default Input;
