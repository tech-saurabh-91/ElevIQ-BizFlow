import { Field, Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';

/** Group of fields with a small heading, rendered inside the master-data forms. */
export function FormSection({ title, description, children, className }) {
  return (
    <section className="space-y-3">
      {(title || description) && (
        <div>
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className={cn('grid gap-4 sm:grid-cols-2', className)}>{children}</div>
    </section>
  );
}

/** Standard address block bound to react-hook-form's nested `address.*` fields. */
export function AddressFields({ register, errors, prefix = 'address' }) {
  const err = (key) => errors?.[prefix]?.[key]?.message;

  return (
    <>
      <Field label="Address line 1" error={err('line1')} className="sm:col-span-2">
        <Input {...register(`${prefix}.line1`)} error={!!err('line1')} placeholder="Street / building" />
      </Field>
      <Field label="Address line 2" error={err('line2')} className="sm:col-span-2">
        <Input {...register(`${prefix}.line2`)} error={!!err('line2')} placeholder="Area / landmark" />
      </Field>
      <Field label="City" error={err('city')}>
        <Input {...register(`${prefix}.city`)} error={!!err('city')} placeholder="Pune" />
      </Field>
      <Field label="State" error={err('state')}>
        <Input {...register(`${prefix}.state`)} error={!!err('state')} placeholder="Maharashtra" />
      </Field>
      <Field label="PIN code" error={err('pincode')}>
        <Input {...register(`${prefix}.pincode`)} error={!!err('pincode')} placeholder="411001" />
      </Field>
      <Field label="Country" error={err('country')}>
        <Input {...register(`${prefix}.country`)} error={!!err('country')} placeholder="India" />
      </Field>
    </>
  );
}

/** Footer row used by every modal form. */
export function FormActions({ onCancel, loading, submitLabel = 'Save', cancelLabel = 'Cancel', children }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
      {children}
      <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
        {cancelLabel}
      </Button>
      <Button type="submit" loading={loading}>
        {submitLabel}
      </Button>
    </div>
  );
}

/** '' / null -> undefined so the API never receives empty reference ids. */
export const opt = (value) => (value === '' || value == null ? undefined : value);

/** '' / null -> undefined, otherwise a Number (never NaN). */
export const num = (value) => {
  if (value === '' || value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Number -> string for form defaults.
 * Numeric inputs are kept as strings in React Hook Form so validation messages
 * stay friendly; a saved record returns real numbers from the API, which would
 * otherwise fail `z.string()` when the edit form re-hydrates.
 */
export const numInput = (value, fallback = '') =>
  value === '' || value == null ? fallback : String(value);

/** Comma / newline separated text -> trimmed unique string array. */
export const csv = (value) =>
  String(value || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Date -> `<input type="date">` value. */
export const dateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

export default FormSection;
