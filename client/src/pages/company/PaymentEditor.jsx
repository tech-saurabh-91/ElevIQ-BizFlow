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
import { useLookups } from '@/hooks/useLookups';
import { dateInput, num } from '@/components/company/form-utils';
import { formatDate, formatMoney, formatNumber } from '@/utils/format';
import {
  PAYMENT_MODES,
  PAYMENT_REASONS,
  paymentModeLabel,
  paymentReasonLabel,
} from '@/components/company/payment-shared';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const text = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''));

const allocationSchema = z.object({
  invoice: z.string().min(1, 'Select an invoice'),
  invoiceNo: z.string().optional(),
  balanceDue: z.number().optional(),
  amount: z
    .string()
    .trim()
    .min(1, 'Enter an amount')
    .refine((v) => Number(v) > 0, 'Amount must be greater than zero'),
});

const schema = z.object({
  customerId: z.string().min(1, 'Select a customer'),
  amount: z
    .string()
    .trim()
    .min(1, 'Enter the amount received')
    .refine((v) => Number(v) > 0, 'Amount must be greater than zero'),
  paymentDate: z.string().optional().or(z.literal('')),
  mode: z.enum(PAYMENT_MODES),
  reference: text(100),
  bankName: text(120),
  chequeDate: z.string().optional().or(z.literal('')),
  reason: z.enum(PAYMENT_REASONS),
  notes: text(1000),
  allocations: z.array(allocationSchema),
});

const todayInput = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export default function PaymentEditor() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [searchParams] = useSearchParams();
  // Opened from a shop visit: go back there after saving (check-out follows).
  const returnTo = (searchParams.get('returnTo') || '').startsWith('/app/') ? searchParams.get('returnTo') : '';
  const presetCustomerId = searchParams.get('customerId') || '';
  const presetInvoiceId = searchParams.get('invoiceId') || '';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { company } = useAuth();
  const { lookups } = useLookups();

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
      customerId: presetCustomerId,
      amount: '',
      paymentDate: todayInput(),
      mode: 'CASH',
      reference: '',
      bankName: '',
      chequeDate: '',
      reason: 'INVOICE_SETTLEMENT',
      notes: '',
      allocations: [],
    },
  });

  const { fields, replace, append, remove } = useFieldArray({ control, name: 'allocations' });
  const watchedAllocations = useWatch({ control, name: 'allocations' }) || [];
  const customerId = useWatch({ control, name: 'customerId' }) || '';
  const amount = Number(useWatch({ control, name: 'amount' }) || 0);
  const mode = useWatch({ control, name: 'mode' }) || 'CASH';

  // ---- Existing draft ------------------------------------------------------
  const paymentQuery = useQuery({
    queryKey: ['company', 'payment', id],
    queryFn: async () => {
      const { data } = await api.get(`/v1/payments/${id}`);
      return data?.data;
    },
    enabled: isEdit,
  });

  const payment = paymentQuery.data;
  const locked = isEdit && payment && payment.status !== 'DRAFT';

  useEffect(() => {
    if (!isEdit || !payment || initialized) return;
    reset({
      customerId: String(payment.customerId?.id || payment.customerId || ''),
      amount: payment.amount == null ? '' : String(payment.amount),
      paymentDate: dateInput(payment.paymentDate),
      mode: payment.mode || 'CASH',
      reference: payment.reference || '',
      bankName: payment.bankName || '',
      chequeDate: dateInput(payment.chequeDate),
      reason: payment.reason || 'INVOICE_SETTLEMENT',
      notes: payment.notes || '',
      allocations: (payment.allocations || []).map((a) => ({
        invoice: String(a.invoice?.id || a.invoice || ''),
        invoiceNo: a.invoiceNo || '',
        balanceDue: undefined,
        amount: a.amount == null ? '' : String(a.amount),
      })),
    });
    setInitialized(true);
  }, [isEdit, payment, initialized, reset]);

  // ---- Form options (payable invoices for the chosen customer) -------------
  const optionsQuery = useQuery({
    queryKey: ['company', 'payment-form-options', customerId || 'none'],
    queryFn: async () => {
      const params = customerId ? { customerId } : {};
      const { data } = await api.get('/v1/payments/form-options', { params });
      return data?.data;
    },
    enabled: initialized,
    staleTime: 30_000,
  });

  const options = optionsQuery.data;
  const currency = options?.settings?.currency || company?.currency || 'INR';
  const money = (value) => formatMoney(value, currency);

  const invoicesById = useMemo(
    () => new Map((options?.invoices || []).map((i) => [String(i.id), i])),
    [options?.invoices]
  );

  // When the customer changes, seed an allocation for a preset invoice (deep
  // link from an invoice) or clear the allocations so they match the new set.
  const seededCustomer = useRef(null);
  useEffect(() => {
    if (!customerId || !options?.invoices) return;
    if (seededCustomer.current === customerId) return;
    seededCustomer.current = customerId;

    if (presetInvoiceId && invoicesById.has(presetInvoiceId)) {
      const inv = invoicesById.get(presetInvoiceId);
      replace([{ invoice: String(inv.id), invoiceNo: inv.invoiceNo, balanceDue: Number(inv.balanceDue || 0), amount: String(round2(inv.balanceDue || 0)) }]);
      if (!getValues('amount')) setValue('amount', String(round2(inv.balanceDue || 0)));
    } else if (!isEdit) {
      replace([]);
    }
  }, [customerId, options?.invoices, invoicesById, presetInvoiceId, replace, getValues, setValue, isEdit]);

  const selectCustomer = (nextId) => {
    setValue('customerId', nextId);
    seededCustomer.current = null;
    setServerError(null);
    if (!isEdit) replace([]);
  };

  // ---- Allocation helpers --------------------------------------------------
  const allocatedTotal = useMemo(
    () => round2(watchedAllocations.reduce((s, a) => s + (Number(a.amount) || 0), 0)),
    [watchedAllocations]
  );
  const remaining = round2(amount - allocatedTotal);

  // "Allocate oldest invoice first" (Collections setting): spread the amount
  // over open invoices by due date. It keeps following the amount until the
  // user edits an allocation by hand.
  const fifoDefault = options?.settings?.collections?.fifoAllocationDefault !== false;
  const [autoAllocate, setAutoAllocate] = useState(!isEdit);

  const allocateOldestFirst = () => {
    let left = amount;
    const rows = [...(options?.invoices || [])]
      .sort((a, b) => new Date(a.dueDate || a.invoiceDate || 0) - new Date(b.dueDate || b.invoiceDate || 0))
      .map((inv) => {
        const take = round2(Math.min(Number(inv.balanceDue || 0), Math.max(left, 0)));
        left = round2(left - take);
        return take > 0
          ? { invoice: String(inv.id), invoiceNo: inv.invoiceNo, balanceDue: Number(inv.balanceDue || 0), amount: String(take) }
          : null;
      })
      .filter(Boolean);
    replace(rows);
  };

  useEffect(() => {
    if (fifoDefault && autoAllocate && customerId && options?.invoices) allocateOldestFirst();
  }, [fifoDefault, autoAllocate, customerId, amount, options?.invoices]);

  const addInvoiceRow = (invoiceId) => {
    const inv = invoicesById.get(String(invoiceId));
    if (!inv) return;
    setAutoAllocate(false);
    const exists = watchedAllocations.some((a) => String(a.invoice) === String(inv.id));
    if (exists) return;
    append({
      invoice: String(inv.id),
      invoiceNo: inv.invoiceNo,
      balanceDue: Number(inv.balanceDue || 0),
      amount: String(round2(Math.min(Number(inv.balanceDue || 0), Math.max(remaining, 0) || Number(inv.balanceDue || 0)))),
    });
  };

  const allocatableInvoices = useMemo(
    () =>
      (options?.invoices || []).filter(
        (inv) => !watchedAllocations.some((a) => String(a.invoice) === String(inv.id))
      ),
    [options?.invoices, watchedAllocations]
  );

  // ---- Save ----------------------------------------------------------------
  const mutation = useMutation({
    mutationFn: async (payload) => {
      if (isEdit) {
        const { data } = await api.patch(`/v1/payments/${id}`, payload);
        if (pendingIntent.current === 'receive') {
          const { data: received } = await api.post(`/v1/payments/${id}/receive`, {});
          return received;
        }
        return data;
      }
      const { data } = await api.post('/v1/payments', {
        ...payload,
        receive: pendingIntent.current === 'receive',
      });
      return data;
    },
    onSuccess: (payload) => {
      const saved = payload?.data;
      toast.success(payload?.message || 'Payment saved');
      queryClient.invalidateQueries({ queryKey: ['company', 'payments'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'payment', id] });
      queryClient.invalidateQueries({ queryKey: ['company', 'invoices'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
      if (returnTo) navigate(returnTo, { replace: true });
      else if (saved?.id) navigate(`/app/payments/${saved.id}`, { replace: true });
      else navigate('/app/payments', { replace: true });
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
      const total = round2(Number(values.amount));
      const selected = (values.allocations || [])
        .filter((a) => a.invoice && Number(a.amount) > 0)
        .map((a) => ({ invoice: a.invoice, amount: round2(Number(a.amount)) }));

      const allocSum = round2(selected.reduce((s, a) => s + a.amount, 0));
      if (allocSum > total) {
        setError('amount', {
          type: 'manual',
          message: `Allocated ${money(allocSum)} exceeds the payment amount ${money(total)}`,
        });
        return;
      }

      const payload = {
        customerId: values.customerId,
        amount: total,
        paymentDate: values.paymentDate || undefined,
        mode: values.mode,
        reference: values.reference || '',
        bankName: values.bankName || '',
        chequeDate: values.chequeDate || undefined,
        reason: values.reason,
        notes: values.notes || '',
        allocations: selected,
      };

      mutation.mutate(payload);
    })();
  };

  // ---- Guards -------------------------------------------------------------
  if (isEdit && paymentQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (isEdit && paymentQuery.isError) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Could not load this payment"
          description={apiError(paymentQuery.error).message}
          action={
            <Button variant="outline" onClick={() => navigate('/app/payments')}>
              <ArrowLeft className="h-4 w-4" /> Back to payments
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
          title={`Payment ${payment.paymentNo}`}
          breadcrumbs={[
            { label: 'Payments & Collections', to: '/app/payments' },
            { label: payment.paymentNo || 'Payment' },
          ]}
        />
        <Card>
          <EmptyState
            icon="error"
            title="This payment can no longer be edited"
            description={`Only draft payments can be edited. This payment is currently ${String(
              payment.status
            )
              .replace(/_/g, ' ')
              .toLowerCase()}.`}
            action={
              <Button onClick={() => navigate(`/app/payments/${payment.id}`)}>View payment</Button>
            }
          />
        </Card>
      </div>
    );
  }

  const saving = isSubmitting || mutation.isPending;
  const overAllocated = allocatedTotal > amount + 0.001;

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? `Edit ${payment?.paymentNo || 'draft payment'}` : 'New payment'}
        description="Record money received from a customer and settle one or more invoices, or hold it as an advance."
        breadcrumbs={[
          { label: 'Payments & Collections', to: '/app/payments' },
          { label: isEdit ? payment?.paymentNo || 'Edit draft' : 'New payment' },
        ]}
        actions={
          <Button
            variant="outline"
            onClick={() => navigate(returnTo || (isEdit ? `/app/payments/${id}` : '/app/payments'))}
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
            title="Could not save the payment"
            message={serverError.message}
            errors={serverError.errors}
            onClose={() => setServerError(null)}
          />
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Payment details</CardTitle>
                <CardDescription>
                  Enter the money received. You can allocate it across open invoices or leave it as
                  an advance.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Customer"
                  required
                  error={errors.customerId?.message}
                  className="sm:col-span-2"
                  hint="Pick the customer who paid; their open invoices load below."
                >
                  {isEdit ? (
                    <Input
                      value={payment?.customerName || ''}
                      readOnly
                      disabled
                    />
                  ) : (
                    <Select
                      value={customerId}
                      onChange={(e) => selectCustomer(e.target.value)}
                      error={!!errors.customerId}
                    >
                      <option value="">Select a customer…</option>
                      {(lookups.customers || []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.code ? ` (${c.code})` : ''}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field
                  label="Amount received"
                  required
                  error={errors.amount?.message}
                  hint="Total money received on this receipt."
                >
                  <Input
                    type="number"
                    min="0.01"
                    step="any"
                    inputMode="decimal"
                    {...register('amount')}
                    error={!!errors.amount}
                    placeholder="0.00"
                  />
                </Field>

                <Field label="Payment date" error={errors.paymentDate?.message}>
                  <Input type="date" {...register('paymentDate')} />
                </Field>

                <Field label="Mode" error={errors.mode?.message}>
                  <Select {...register('mode')}>
                    {PAYMENT_MODES.map((value) => (
                      <option key={value} value={value}>
                        {paymentModeLabel(value)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Reason" error={errors.reason?.message}>
                  <Select {...register('reason')}>
                    {PAYMENT_REASONS.map((value) => (
                      <option key={value} value={value}>
                        {paymentReasonLabel(value)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Reference / UTR / cheque no"
                  error={errors.reference?.message}
                  hint={mode === 'CASH' ? 'Optional for cash.' : 'Transaction or cheque reference.'}
                >
                  <Input {...register('reference')} placeholder="e.g. UPI987654 or CHQ-123456" />
                </Field>

                {(mode === 'BANK_TRANSFER' || mode === 'CHEQUE' || mode === 'CARD') && (
                  <Field label="Bank" error={errors.bankName?.message}>
                    <Input {...register('bankName')} placeholder="Bank name (optional)" />
                  </Field>
                )}

                {mode === 'CHEQUE' && (
                  <Field label="Cheque date" error={errors.chequeDate?.message}>
                    <Input type="date" {...register('chequeDate')} />
                  </Field>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Settle invoices</CardTitle>
                <CardDescription>
                  Allocate the amount across this customer&apos;s open invoices. Anything not
                  allocated is kept as an advance.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {customerId ? (
                  <>
                    {fields.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-sm">
                          <thead>
                            <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                              <th className="pb-2 pr-2 font-medium">Invoice</th>
                              <th className="w-32 pb-2 px-2 text-right font-medium">Balance</th>
                              <th className="w-36 pb-2 px-2 font-medium">Amount to settle</th>
                              <th className="w-12 pb-2 pl-2 font-medium" />
                            </tr>
                          </thead>
                          <tbody>
                            {fields.map((field, index) => {
                              const row = watchedAllocations[index] || {};
                              const inv = invoicesById.get(String(row.invoice));
                              const balance = Number(row.balanceDue ?? inv?.balanceDue ?? 0);
                              const over = Number(row.amount) > balance + 0.001;
                              return (
                                <tr key={field.id} className="border-b last:border-0">
                                  <td className="py-2 pr-2 align-top">
                                    <p className="font-medium">{row.invoiceNo || inv?.invoiceNo || '—'}</p>
                                    <p className="text-xs text-muted-foreground">
                                      Due {inv?.dueDate ? formatDate(inv.dueDate) : '—'} ·{' '}
                                      {inv?.status ? String(inv.status).replace(/_/g, ' ') : ''}
                                    </p>
                                  </td>
                                  <td className="py-2 px-2 text-right align-top tabular-nums">
                                    {money(balance)}
                                  </td>
                                  <td className="py-2 px-2 align-top">
                                    <Input
                                      type="number"
                                      min="0.01"
                                      step="any"
                                      {...register(`allocations.${index}.amount`, { onChange: () => setAutoAllocate(false) })}
                                      aria-label={`Amount to settle for ${row.invoiceNo || index + 1}`}
                                    />
                                    {over && (
                                      <p className="mt-1 text-xs text-warning">
                                        More than the balance; capped on receive.
                                      </p>
                                    )}
                                  </td>
                                  <td className="py-2 pl-2 align-top">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setAutoAllocate(false);
                                        remove(index);
                                      }}
                                      aria-label={`Remove allocation for ${row.invoiceNo || index + 1}`}
                                    >
                                      ×
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                        {optionsQuery.isLoading
                          ? 'Loading open invoices…'
                          : 'No invoices allocated yet. Add an invoice below, or leave the full amount as an advance.'}
                      </div>
                    )}

                    {(options?.invoices || []).length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={amount <= 0}
                          onClick={() => {
                            setAutoAllocate(false);
                            allocateOldestFirst();
                          }}
                        >
                          Allocate oldest first
                        </Button>
                      </div>
                    )}

                    {allocatableInvoices.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) addInvoiceRow(e.target.value);
                          }}
                          className="w-72"
                          aria-label="Add an invoice to settle"
                        >
                          <option value="">Add an invoice to settle…</option>
                          {allocatableInvoices.map((inv) => (
                            <option key={inv.id} value={inv.id}>
                              {inv.invoiceNo} · {money(inv.balanceDue)} due
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                    Select a customer to load their open invoices.
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
                    placeholder="Context for this receipt…"
                  />
                </Field>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Summary</CardTitle>
                <CardDescription>Confirm the split before saving.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Row label="Amount received" value={money(amount)} />
                <Row label="Allocated to invoices" value={money(allocatedTotal)} />
                <Row
                  label={remaining < 0 ? 'Over-allocated' : 'Advance / unallocated'}
                  value={money(Math.abs(remaining))}
                  muted
                />
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Receipt total</span>
                    <span className="text-xl font-bold tabular-nums">{money(amount)}</span>
                  </div>
                </div>

                {overAllocated && (
                  <Alert tone="warning">
                    <AlertTitle>Allocations exceed the amount</AlertTitle>
                    <AlertDescription>
                      Reduce the allocated amounts to {money(amount)} or less before saving.
                    </AlertDescription>
                  </Alert>
                )}

                {!overAllocated && remaining > 0.001 && allocatedTotal >= 0 && (
                  <Alert tone="info">
                    <AlertTitle>Advance held</AlertTitle>
                    <AlertDescription>
                      {money(remaining)} will be kept as an advance on the customer account.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
              <Button type="submit" variant="outline" disabled={saving || overAllocated}>
                <Save className="h-4 w-4" />
                {saving && intent === 'draft' ? 'Saving…' : 'Save draft'}
              </Button>
              <Button
                type="button"
                disabled={saving || overAllocated}
                loading={saving && intent === 'receive'}
                onClick={() => submitForm('receive')}
              >
                <Send className="h-4 w-4" />
                Save &amp; receive
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Receiving settles the allocated invoices and reduces the customer outstanding
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
