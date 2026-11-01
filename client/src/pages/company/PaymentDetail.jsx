import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Banknote,
  Circle,
  Info,
  Pencil,
  Printer,
  Receipt,
  Send,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/ui/dialog';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatDateTime, formatMoney, titleCase } from '@/utils/format';
import {
  PaymentActionDialog,
  paymentActionsFor,
  openPaymentPdf,
  paymentModeLabel,
  paymentReasonLabel,
} from '@/components/company/payment-shared';

export default function PaymentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company } = useAuth();

  const [action, setAction] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: payment, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'payment', id],
    queryFn: async () => {
      const { data: body } = await api.get(`/v1/payments/${id}`);
      return body?.data;
    },
    enabled: Boolean(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'payment', id] });
    queryClient.invalidateQueries({ queryKey: ['company', 'payments'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'invoices'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/v1/payments/${id}`),
    onSuccess: () => {
      toast.success('Draft payment deleted');
      invalidate();
      navigate('/app/payments', { replace: true });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const money = useMemo(
    () => (value) => formatMoney(value, company?.currency || 'INR'),
    [company?.currency]
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError || !payment) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Payment not found"
          description={
            apiError(error).message || 'This payment may have been deleted or belongs to another team.'
          }
          action={
            <Button variant="outline" onClick={() => navigate('/app/payments')}>
              <ArrowLeft className="h-4 w-4" /> Back to payments
            </Button>
          }
        />
      </Card>
    );
  }

  const customer = payment.customerId && typeof payment.customerId === 'object' ? payment.customerId : {};
  const available = paymentActionsFor(payment, can);
  const isDraft = payment.status === 'DRAFT';
  const isCancelled = payment.status === 'CANCELLED';
  const isBounced = payment.status === 'BOUNCED';
  const reversed = isCancelled || isBounced;
  const allocations = payment.allocations || [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={payment.paymentNo || 'Draft payment'}
        description={`${payment.customerName || customer.name || 'Customer'} · ${formatDate(
          payment.paymentDate
        )}`}
        breadcrumbs={[
          { label: 'Payments & Collections', to: '/app/payments' },
          { label: payment.paymentNo || 'Payment' },
        ]}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/app/payments')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" onClick={() => openPaymentPdf(payment)}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            {isDraft && can('payments.update') && (
              <Button variant="outline" onClick={() => navigate(`/app/payments/${payment.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit draft
              </Button>
            )}
            {available.includes('receive') && (
              <Button onClick={() => setAction('receive')}>
                <Send className="h-4 w-4" /> Receive payment
              </Button>
            )}
            {available.includes('bounce') && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setAction('bounce')}
              >
                <X className="h-4 w-4" /> Mark as bounced
              </Button>
            )}
            {available.includes('cancel') && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setAction('cancel')}
              >
                <X className="h-4 w-4" /> Cancel payment
              </Button>
            )}
            {isDraft && can('payments.delete') && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={payment.status} />
        <span className="text-xs text-muted-foreground">{paymentModeLabel(payment.mode)}</span>
        {payment.reference && (
          <span className="text-xs text-muted-foreground">Ref {payment.reference}</span>
        )}
        <span className="text-xs text-muted-foreground">
          Created {formatDateTime(payment.createdAt)}
          {payment.createdBy?.name ? ` by ${payment.createdBy.name}` : ''}
        </span>
      </div>

      {isDraft && (
        <Alert tone="info">
          <AlertTitle>This payment is a draft</AlertTitle>
          <AlertDescription>
            Drafts do not change any invoice balance or customer outstanding. Receive it to settle
            the allocated invoices, or edit/delete it while it is still a draft.
          </AlertDescription>
        </Alert>
      )}

      {isCancelled && (
        <Alert tone="warning">
          <AlertTitle>Payment cancelled</AlertTitle>
          <AlertDescription>
            {payment.cancelReason || 'No reason was provided.'}
            {payment.cancelledBy?.name && (
              <span className="block text-xs opacity-80">
                By {payment.cancelledBy.name}
                {payment.cancelledAt ? ` · ${formatDateTime(payment.cancelledAt)}` : ''}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {isBounced && (
        <Alert tone="destructive">
          <AlertTitle>Payment bounced</AlertTitle>
          <AlertDescription>
            {payment.bounceReason || 'The payment failed and was reversed.'}
            {payment.bouncedAt && (
              <span className="block text-xs opacity-80">{formatDateTime(payment.bouncedAt)}</span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Amount received" value={money(payment.amount)} icon={Wallet} />
        <SummaryCard
          label="Applied to invoices"
          value={money(payment.amountApplied)}
          hint={reversed ? 'Reversed' : 'Knocked off invoice balances'}
          icon={Banknote}
          tone={reversed ? 'muted' : 'success'}
        />
        <SummaryCard
          label="Advance / unallocated"
          value={money(payment.unappliedAmount)}
          hint="Held on the customer account"
          icon={Info}
          tone="warning"
        />
        <SummaryCard
          label="Invoices settled"
          value={String(allocations.length)}
          hint={paymentReasonLabel(payment.reason)}
          icon={Receipt}
          tone="brand"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Invoice allocations</CardTitle>
              <CardDescription>
                {allocations.length
                  ? `${allocations.length} invoice${allocations.length === 1 ? '' : 's'} settled by this receipt`
                  : 'No invoices allocated — the full amount is an advance.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {allocations.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-y bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-6 py-2 font-medium">Invoice</th>
                        <th className="px-3 py-2 text-right font-medium">Amount applied</th>
                        <th className="px-6 py-2 text-right font-medium"> </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {allocations.map((alloc, index) => (
                        <tr key={alloc.id || index}>
                          <td className="px-6 py-3">
                            <p className="font-medium">{alloc.invoiceNo || '—'}</p>
                          </td>
                          <td className="px-3 py-3 text-right font-medium tabular-nums">
                            {money(alloc.amount)}
                          </td>
                          <td className="px-6 py-3 text-right">
                            {alloc.invoice && (alloc.invoice.id || alloc.invoice) && (
                              <Link
                                to={`/app/invoices/${alloc.invoice.id || alloc.invoice}`}
                                className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
                              >
                                View invoice
                              </Link>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/40">
                        <td className="px-6 py-3 text-sm font-medium">Total applied</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums">
                          {money(payment.amountApplied)}
                        </td>
                        <td className="px-6 py-3" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                  This receipt is held entirely as an advance.
                </div>
              )}
            </CardContent>
          </Card>

          {payment.notes && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-sm">{payment.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-medium">{payment.customerName || customer.name || '—'}</p>
                {(payment.customerCode || customer.code) && (
                  <p className="text-xs text-muted-foreground">
                    {payment.customerCode || customer.code}
                  </p>
                )}
              </div>
              {(payment.customerPhone || customer.phone) && (
                <p className="text-muted-foreground">{payment.customerPhone || customer.phone}</p>
              )}
              {customer.id && (
                <Link
                  to={`/app/customers?search=${encodeURIComponent(customer.name || '')}`}
                  className="inline-block text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
                >
                  View customer
                </Link>
              )}
              <div className="grid grid-cols-2 gap-3 border-t pt-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Credit limit</p>
                  <p className="font-medium">{money(customer.creditLimit || 0)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Outstanding</p>
                  <p className="font-medium">{money(customer.outstanding || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Payment details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <InfoRow label="Receipt no" value={payment.paymentNo || '—'} />
              <InfoRow label="Date" value={formatDate(payment.paymentDate)} />
              <InfoRow label="Mode" value={paymentModeLabel(payment.mode)} />
              <InfoRow label="Reason" value={paymentReasonLabel(payment.reason)} />
              {payment.reference && <InfoRow label="Reference" value={payment.reference} />}
              {payment.bankName && <InfoRow label="Bank" value={payment.bankName} />}
              {payment.chequeDate && <InfoRow label="Cheque date" value={formatDate(payment.chequeDate)} />}
              {payment.collectedBy?.name && (
                <InfoRow label="Collected by" value={payment.collectedBy.name} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>History</CardTitle>
              <CardDescription>Every workflow step on this payment</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-0">
                {(payment.statusHistory || []).map((entry, index, list) => (
                  <li
                    key={`${entry.status}-${entry.at}-${index}`}
                    className="relative flex gap-3 pb-4 last:pb-0"
                  >
                    {index < list.length - 1 && (
                      <span
                        className="absolute left-[7px] top-4 h-full w-px bg-border"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative mt-1 flex h-4 w-4 shrink-0 items-center justify-center">
                      {index === list.length - 1 ? (
                        <span className="h-3 w-3 rounded-full border-2 border-primary bg-background" />
                      ) : (
                        <Circle className="h-3 w-3 text-muted-foreground/50" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{titleCase(entry.status)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(entry.at)}
                        {entry.byName ? ` · ${entry.byName}` : ''}
                      </p>
                      {entry.note && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{entry.note}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {(!payment.statusHistory || payment.statusHistory.length === 0) && (
                <p className="text-sm text-muted-foreground">No history recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <PaymentActionDialog
        action={action}
        payment={payment}
        open={Boolean(action)}
        onClose={() => setAction(null)}
        onDone={invalidate}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete this draft payment?"
        message="This draft will be permanently removed. Only drafts can be deleted."
        confirmLabel="Delete draft"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function SummaryCard({ label, value, hint, icon: Icon, tone = 'brand' }) {
  const tones = {
    brand: 'text-brand-600 dark:text-brand-300 bg-brand-500/12',
    success: 'text-success bg-success/12',
    warning: 'text-warning bg-warning/15',
    destructive: 'text-destructive bg-destructive/12',
    muted: 'text-muted-foreground bg-muted',
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || '—'}</span>
    </div>
  );
}
