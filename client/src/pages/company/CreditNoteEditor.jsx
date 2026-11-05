import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Save, Send } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertTitle, AlertDescription, ErrorAlert } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { dateInput, num } from '@/components/company/form-utils';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';
import {
  CREDIT_NOTE_REASONS,
  computeInvoicePreview,
  creditNoteReasonLabel,
  priceInvoiceLine,
} from '@/components/company/invoice-shared';
import { breakupRows, buyerStateOf } from '@/utils/tax';

const text = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''));

const itemSchema = z.object({
  invoiceItemId: z.string().min(1, 'Select an invoice line'),
  product: z.string().optional().or(z.literal('')),
  name: z.string().optional().or(z.literal('')),
  sku: z.string().optional().or(z.literal('')),
  unit: z.string().optional().or(z.literal('')),
  include: z.boolean().optional(),
  qty: z
    .string()
    .trim()
    .min(1, 'Enter a quantity')
    .refine((v) => Number(v) > 0, 'Quantity must be greater than zero'),
  unitPrice: z.union([z.string(), z.number()]).optional(),
  discountPercent: z.union([z.string(), z.number()]).optional(),
  taxRate: z.union([z.string(), z.number()]).optional(),
  note: text(300),
  maxQty: z.number().optional().nullable(),
});

const schema = z.object({
  invoiceId: z.string().min(1, 'Select the invoice to credit'),
  creditNoteDate: z.string().optional().or(z.literal('')),
  reason: z.enum(CREDIT_NOTE_REASONS),
  reasonNote: text(1000),
  notes: text(1000),
  items: z.array(itemSchema),
});

const todayInput = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const rowFromInvoiceOption = (row) => ({
  invoiceItemId: String(row.invoiceItemId),
  product: String(row.product),
  name: row.name || '',
  sku: row.sku || '',
  unit: row.unit || 'PCS',
  include: true,
  qty: String(row.remainingQty ?? row.qty ?? 1),
  unitPrice: Number(row.unitPrice || 0),
  discountPercent: Number(row.discountPercent || 0),
  taxRate: Number(row.taxRate || 0),
  note: '',
  maxQty: Number(row.remainingQty ?? row.qty ?? 0),
});

export default function CreditNoteEditor() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [searchParams] = useSearchParams();
  // Opened from a shop visit: go back there after saving (check-out follows).
  const returnTo = (searchParams.get('returnTo') || '').startsWith('/app/') ? searchParams.get('returnTo') : '';
  const presetInvoiceId = searchParams.get('invoiceId') || '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { company } = useAuth();

  const [initialized, setInitialized] = useState(!isEdit);
  const [serverError, setServerError] = useState(null);
  const pendingIntent = useRef('draft');
  const [intent, setIntent] = useState('draft');

  const {
    register,
    control,
    handleSubmit,
    reset,
    getValues,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      invoiceId: presetInvoiceId,
      creditNoteDate: todayInput(),
      reason: 'SALES_RETURN',
      reasonNote: '',
      notes: '',
      items: [],
    },
  });

  const { fields, replace } = useFieldArray({ control, name: 'items' });
  const watchedItems = useWatch({ control, name: 'items' }) || [];
  const invoiceId = useWatch({ control, name: 'invoiceId' }) || '';
  const reason = useWatch({ control, name: 'reason' }) || 'SALES_RETURN';

  // ---- Existing draft ------------------------------------------------------
  const noteQuery = useQuery({
    queryKey: ['company', 'credit-note', id],
    queryFn: async () => {
      const { data } = await api.get(`/v1/credit-notes/${id}`);
      return data?.data;
    },
    enabled: isEdit,
  });

  const note = noteQuery.data;
  const locked = isEdit && note && note.status !== 'DRAFT';

  useEffect(() => {
    if (!isEdit || !note || initialized) return;
    reset({
      invoiceId: String(note.invoice?.id || note.invoice || ''),
      creditNoteDate: dateInput(note.creditNoteDate),
      reason: note.reason || 'SALES_RETURN',
      reasonNote: note.reasonNote || '',
      notes: note.notes || '',
      items: (note.items || []).map((item) => ({
        invoiceItemId: String(item.invoiceItemId || ''),
        product: String(item.product || ''),
        name: item.name || '',
        sku: item.sku || '',
        unit: item.unit || 'PCS',
        include: true,
        qty: String(item.qty ?? 1),
        unitPrice: Number(item.unitPrice || 0),
        discountPercent: Number(item.discountPercent || 0),
        taxRate: Number(item.taxRate || 0),
        note: item.note || '',
        maxQty: null,
      })),
    });
    setInitialized(true);
  }, [isEdit, note, initialized, reset]);

  // ---- Form options --------------------------------------------------------
  const optionsQuery = useQuery({
    queryKey: ['company', 'credit-note-form-options', invoiceId || 'none'],
    queryFn: async () => {
      const params = invoiceId ? { invoiceId } : {};
      const { data } = await api.get('/v1/credit-notes/form-options', { params });
      return data?.data;
    },
    enabled: initialized,
    staleTime: 30_000,
  });

  const options = optionsQuery.data;
  const invoice = options?.invoice || null;
  const currency = options?.settings?.currency || company?.currency || 'INR';
  const money = (value) => formatMoney(value, currency);

  // Apply the invoice's creditable lines once the invoice is known.
  const appliedInvoice = useRef(null);
  const skipInvoiceApply = useRef(isEdit);
  useEffect(() => {
    if (!invoice?.id) return;
    if (appliedInvoice.current === invoice.id) return;

    if (skipInvoiceApply.current) {
      appliedInvoice.current = invoice.id;
      skipInvoiceApply.current = false;
      const caps = new Map(
        (invoice.items || []).map((row) => [String(row.invoiceItemId), Number(row.remainingQty || 0)])
      );
      (getValues('items') || []).forEach((row, index) => {
        const cap = caps.get(String(row.invoiceItemId));
        setValue(`items.${index}.maxQty`, cap == null ? Number(row.qty) : cap);
      });
      return;
    }

    appliedInvoice.current = invoice.id;
    replace((invoice.items || []).map(rowFromInvoiceOption));
  }, [invoice, getValues, setValue, replace]);

  // Reset the applied marker when the user picks a different invoice.
  const selectInvoice = (nextId) => {
    setValue('invoiceId', nextId);
    appliedInvoice.current = null;
    skipInvoiceApply.current = false;
    setServerError(null);
    if (!nextId) replace([]);
  };

  // ---- Preview -------------------------------------------------------------
  const includedItems = useMemo(
    () => watchedItems.filter((row) => row?.include !== false),
    [watchedItems]
  );

  const preview = useMemo(
    () =>
      computeInvoicePreview({
        items: includedItems,
        products: new Map(),
        priceList: null,
        settings: options?.settings,
        buyerState: options?.invoice?.placeOfSupply,
      }),
    [includedItems, options?.settings, options?.invoice?.placeOfSupply]
  );

  // ---- Save ---------------------------------------------------------------
  const mutation = useMutation({
    mutationFn: async (payload) => {
      if (isEdit) {
        const { data } = await api.patch(`/v1/credit-notes/${id}`, payload);
        if (pendingIntent.current === 'issue') {
          const { data: issued } = await api.post(`/v1/credit-notes/${id}/issue`, {});
          return issued;
        }
        return data;
      }
      const { data } = await api.post('/v1/credit-notes', {
        ...payload,
        issue: pendingIntent.current === 'issue',
      });
      return data;
    },
    onSuccess: (payload) => {
      const saved = payload?.data;
      toast.success(payload?.message || 'Credit note saved');
      queryClient.invalidateQueries({ queryKey: ['company', 'credit-notes'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'credit-note', id] });
      queryClient.invalidateQueries({ queryKey: ['company', 'invoices'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'invoice', saved?.invoice?.id || saved?.invoice] });
      queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
      if (returnTo) navigate(returnTo, { replace: true });
      else if (saved?.id) navigate(`/app/credit-notes/${saved.id}`, { replace: true });
      else navigate('/app/credit-notes', { replace: true });
    },
    onError: (err) => {
      const e = apiError(err);
      setServerError(e);
      Object.entries(toFieldErrors(e.errors)).forEach(([field, message]) => {
        setError(field, { type: 'server', message });
      });
    },
  });

  const submitForm = (nextIntent) => {
    pendingIntent.current = nextIntent;
    setIntent(nextIntent);
    setServerError(null);
    handleSubmit((values) => {
      if (!values.invoiceId) {
        setError('invoiceId', { type: 'manual', message: 'Select the invoice to credit' });
        return;
      }

      let qtyIssue = false;
      values.items.forEach((row, index) => {
        if (row.include === false) return;
        const cap = Number(row.maxQty);
        if (cap > 0 && Number(row.qty) > cap) {
          setError(`items.${index}.qty`, {
            type: 'manual',
            message: `Only ${formatNumber(cap)} left to credit`,
          });
          qtyIssue = true;
        }
      });
      if (qtyIssue) return;

      const selected = values.items.filter((row) => row.include !== false);
      if (selected.length === 0) {
        setServerError({
          message: 'Choose at least one invoice line to credit.',
          errors: [],
        });
        return;
      }

      const payload = {
        creditNoteDate: values.creditNoteDate || undefined,
        reason: values.reason,
        reasonNote: values.reasonNote || '',
        notes: values.notes || '',
        items: selected.map((item) => ({
          invoiceItemId: item.invoiceItemId,
          qty: num(item.qty),
        })),
      };

      if (!isEdit) payload.invoiceId = values.invoiceId;
      mutation.mutate(payload);
    })();
  };

  // ---- Guards -------------------------------------------------------------
  if (isEdit && noteQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (isEdit && noteQuery.isError) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Could not load this credit note"
          description={apiError(noteQuery.error).message}
          action={
            <Button variant="outline" onClick={() => navigate('/app/credit-notes')}>
              <ArrowLeft className="h-4 w-4" /> Back to credit notes
            </Button>
          }
        />
      </Card>
    );
  }

  if (locked) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={`Credit note ${note.creditNoteNo}`}
          breadcrumbs={[
            { label: 'Credit Notes', to: '/app/credit-notes' },
            { label: note.creditNoteNo || 'Credit note' },
          ]}
        />
        <Card>
          <EmptyState
            icon="error"
            title="This credit note can no longer be edited"
            description={`Only draft credit notes can be edited. This note is currently ${String(
              note.status
            )
              .replace(/_/g, ' ')
              .toLowerCase()}.`}
            action={
              <Button onClick={() => navigate(`/app/credit-notes/${note.id}`)}>
                View credit note
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const itemsError = errors.items?.message || errors.items?.root?.message;
  const saving = isSubmitting || mutation.isPending;
  const hasLines = fields.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? `Edit ${note?.creditNoteNo || 'draft credit note'}` : 'New credit note'}
        description="Credit an issued invoice for a return, rate difference, damage or shortage. Totals are computed on save."
        breadcrumbs={[
          { label: 'Credit Notes', to: '/app/credit-notes' },
          { label: isEdit ? note?.creditNoteNo || 'Edit draft' : 'New credit note' },
        ]}
        actions={
          <Button
            variant="outline"
            onClick={() => navigate(returnTo || (isEdit ? `/app/credit-notes/${id}` : '/app/credit-notes'))}
          >
            <ArrowLeft className="h-4 w-4" />
            Cancel
          </Button>
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitForm('draft');
        }}
        className="space-y-5"
        noValidate
      >
        {serverError && (
          <ErrorAlert
            title="Could not save the credit note"
            message={serverError.message}
            errors={serverError.errors}
            onClose={() => setServerError(null)}
          />
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Invoice & credit details</CardTitle>
                <CardDescription>
                  Only issued invoices with an uncredited quantity can receive a credit note.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Invoice"
                  required
                  error={errors.invoiceId?.message}
                  className="sm:col-span-2"
                  hint={
                    invoice
                      ? `${invoice.customerName} · total ${money(invoice.total)} · balance ${money(
                          invoice.balanceDue
                        )}`
                      : 'Pick the invoice this credit note reverses.'
                  }
                >
                  {isEdit ? (
                    <Input
                      value={
                        invoice
                          ? `${invoice.invoiceNo} · ${invoice.customerName}`
                          : note?.invoiceNo || ''
                      }
                      readOnly
                      disabled
                    />
                  ) : (
                    <Select
                      value={invoiceId}
                      onChange={(e) => selectInvoice(e.target.value)}
                      error={!!errors.invoiceId}
                    >
                      <option value="">Select an invoice…</option>
                      {(options?.invoices || []).map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.invoiceNo} · {row.customerName} · {money(row.balanceDue)} due
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Credit note date" error={errors.creditNoteDate?.message}>
                  <Input type="date" {...register('creditNoteDate')} />
                </Field>
                <Field label="Reason" error={errors.reason?.message}>
                  <Select {...register('reason')}>
                    {CREDIT_NOTE_REASONS.map((value) => (
                      <option key={value} value={value}>
                        {creditNoteReasonLabel(value)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Reason details"
                  error={errors.reasonNote?.message}
                  className="sm:col-span-2"
                  hint={
                    reason === 'OTHER'
                      ? 'Describe the reason for this credit.'
                      : 'Optional context for the customer and your team.'
                  }
                >
                  <Input
                    {...register('reasonNote')}
                    placeholder="e.g. 2 cases damaged in transit"
                  />
                </Field>
              </CardContent>
            </Card>

            {invoice && options?.invoice && (
              <Alert tone="info">
                <AlertTitle>Crediting {invoice.invoiceNo}</AlertTitle>
                <AlertDescription>
                  Invoiced {formatDate(invoice.invoiceDate)} · total {money(invoice.total)} · already
                  credited {money(invoice.creditNoteTotal)} · balance {money(invoice.balanceDue)}.
                  Issue the note to knock the credit off this balance.
                </AlertDescription>
              </Alert>
            )}

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Lines to credit</CardTitle>
                <CardDescription>
                  Quantities are capped at the uncredited quantity on each invoice line.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {itemsError && (
                  <p className="text-xs font-medium text-destructive" role="alert">
                    {itemsError}
                  </p>
                )}

                {hasLines ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="w-12 pb-2 pr-2 font-medium">Credit</th>
                          <th className="pb-2 pr-2 font-medium">Product</th>
                          <th className="w-32 pb-2 px-2 font-medium">Credit qty</th>
                          <th className="w-28 pb-2 px-2 font-medium">Price</th>
                          <th className="w-24 pb-2 px-2 font-medium">Tax</th>
                          <th className="w-28 pb-2 px-2 text-right font-medium">Amount</th>
                          <th className="w-56 pb-2 pl-2 font-medium">Line note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fields.map((field, index) => {
                          const row = watchedItems[index] || {};
                          const included = row.include !== false;
                          const line = priceInvoiceLine(
                            {
                              product: row.product,
                              qty: row.qty,
                              unitPrice: row.unitPrice,
                              discountPercent: row.discountPercent,
                              taxRate: row.taxRate,
                            },
                            { products: new Map(), priceList: null, settings: options?.settings }
                          );
                          const max = Number(row.maxQty);
                          return (
                            <tr
                              key={field.id}
                              className={`border-b last:border-0 ${included ? '' : 'opacity-50'}`}
                            >
                              <td className="py-2 pr-2 align-top">
                                <input
                                  type="checkbox"
                                  className="mt-2 h-4 w-4 rounded border-input text-primary focus-ring"
                                  {...register(`items.${index}.include`)}
                                  aria-label={`Include line ${index + 1} in this credit note`}
                                />
                              </td>
                              <td className="py-2 pr-2 align-top">
                                <p className="font-medium">{row.name || '—'}</p>
                                <p className="text-xs text-muted-foreground">
                                  {row.sku || '—'}
                                  {row.unit ? ` · ${row.unit}` : ''}
                                  {max > 0 ? ` · ${formatNumber(max)} creditable` : ''}
                                </p>
                                {errors.items?.[index]?.invoiceItemId && (
                                  <p className="mt-1 text-xs text-destructive">
                                    {errors.items[index].invoiceItemId.message}
                                  </p>
                                )}
                              </td>
                              <td className="py-2 px-2 align-top">
                                <Input
                                  type="number"
                                  min="0.0001"
                                  step="any"
                                  max={max > 0 ? max : undefined}
                                  disabled={!included}
                                  {...register(`items.${index}.qty`)}
                                  error={!!errors.items?.[index]?.qty}
                                  aria-label={`Credit quantity for line ${index + 1}`}
                                />
                                {errors.items?.[index]?.qty && (
                                  <p className="mt-1 text-xs text-destructive">
                                    {errors.items[index].qty.message}
                                  </p>
                                )}
                              </td>
                              <td className="py-2 px-2 align-top">
                                <span className="inline-flex h-10 items-center tabular-nums">
                                  {money(row.unitPrice)}
                                </span>
                              </td>
                              <td className="py-2 px-2 align-top">
                                <span className="inline-flex h-10 items-center text-xs tabular-nums text-muted-foreground">
                                  {Number(row.taxRate || 0)}%
                                </span>
                              </td>
                              <td className="py-2 px-2 text-right align-top">
                                <span className="inline-flex h-10 items-center font-medium tabular-nums">
                                  {line ? money(line.lineTotal) : '—'}
                                </span>
                              </td>
                              <td className="py-2 pl-2 align-top">
                                <Input
                                  {...register(`items.${index}.note`)}
                                  disabled={!included}
                                  placeholder="Optional note"
                                  aria-label={`Note for line ${index + 1}`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : invoiceId ? (
                  <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    {optionsQuery.isLoading
                      ? 'Loading creditable lines…'
                      : 'Everything on this invoice has already been credited.'}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    Select an invoice to load its creditable lines.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <Field label="Internal notes" error={errors.notes?.message}>
                  <Textarea
                    {...register('notes')}
                    rows={3}
                    placeholder="Printed or kept internal for this credit note…"
                  />
                </Field>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Credit summary</CardTitle>
                <CardDescription>
                  {preview.lines.length} line{preview.lines.length === 1 ? '' : 's'} ·{' '}
                  {formatNumber(preview.itemCount)} unit{preview.itemCount === 1 ? '' : 's'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Subtotal" value={money(preview.subtotal)} />
                <Row label="Discount" value={`− ${money(preview.discountTotal)}`} />
                <Row label="Taxable value" value={money(preview.taxableTotal)} />
                <Row label="Tax" value={money(preview.taxTotal)} />
                {breakupRows(preview.taxBreakup, options?.settings?.tax).map((r) => (
                  <Row key={r.label} label={r.label} value={r.value.map(money).join(' / ')} muted />
                ))}
                <Row
                  label="Round off"
                  value={`${preview.roundOff >= 0 ? '+' : '−'} ${money(Math.abs(preview.roundOff))}`}
                  muted
                />
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Credit total</span>
                    <span className="text-xl font-bold tabular-nums">{money(preview.total)}</span>
                  </div>
                </div>

                {invoice && (
                  <Alert tone={preview.total > Number(invoice.balanceDue) ? 'warning' : 'default'}>
                    <AlertTitle>Applied to {invoice.invoiceNo}</AlertTitle>
                    <AlertDescription>
                      {preview.total <= Number(invoice.balanceDue)
                        ? `${money(preview.total)} will be knocked off the invoice balance.`
                        : `Only ${money(invoice.balanceDue)} can be applied; the excess is kept as unapplied customer credit.`}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
              <Button type="submit" variant="outline" disabled={saving || !hasLines}>
                <Save className="h-4 w-4" />
                {saving && intent === 'draft' ? 'Saving…' : 'Save draft'}
              </Button>
              <Button
                type="button"
                disabled={saving || !hasLines}
                loading={saving && intent === 'issue'}
                onClick={() => submitForm('issue')}
              >
                <Send className="h-4 w-4" />
                Save &amp; issue
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Issuing applies the credit to the invoice and reduces the customer outstanding
                immediately.
              </p>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

function Row({ label, value, muted = false }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={muted ? 'text-xs text-muted-foreground' : 'text-muted-foreground'}>
        {label}
      </span>
      <span className={`tabular-nums ${muted ? 'text-xs text-muted-foreground' : 'font-medium'}`}>
        {value}
      </span>
    </div>
  );
}
