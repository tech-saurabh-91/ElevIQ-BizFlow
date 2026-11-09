import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Circle,
  FileText,
  Info,
  Pencil,
  Printer,
  Send,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { LineItemsPhone } from '@/components/company/sale-pricing';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/ui/dialog';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/hooks/useAuth';
import { formatDate, formatDateTime, formatMoney, formatNumber, titleCase } from '@/utils/format';
import {
  CreditNoteActionDialog,
  creditNoteActionsFor,
  creditNoteReasonLabel,
  openCreditNotePdf,
} from '@/components/company/invoice-shared';
import { breakupRows } from '@/utils/tax';
import { useTaxLabels } from '@/hooks/useLocations';

const addressLines = (address = {}) =>
  [address.line1, address.line2, address.city, address.state, address.pincode, address.country]
    .filter(Boolean)
    .join(', ');

export default function CreditNoteDetail() {
  const { tax: taxSettings, taxIdLabel } = useTaxLabels();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company } = useAuth();

  const [action, setAction] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: note, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'credit-note', id],
    queryFn: async () => {
      const { data: body } = await api.get(`/v1/credit-notes/${id}`);
      return body?.data;
    },
    enabled: Boolean(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'credit-note', id] });
    queryClient.invalidateQueries({ queryKey: ['company', 'credit-notes'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'invoices'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/v1/credit-notes/${id}`),
    onSuccess: () => {
      toast.success('Draft credit note deleted');
      invalidate();
      navigate('/app/credit-notes', { replace: true });
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

  if (isError || !note) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Credit note not found"
          description={
            apiError(error).message ||
            'This credit note may have been deleted or belongs to another team.'
          }
          action={
            <Button variant="outline" onClick={() => navigate('/app/credit-notes')}>
              <ArrowLeft className="h-4 w-4" /> Back to credit notes
            </Button>
          }
        />
      </Card>
    );
  }

  const customer = note.customerId && typeof note.customerId === 'object' ? note.customerId : {};
  const invoice = note.invoice && typeof note.invoice === 'object' ? note.invoice : null;
  const available = creditNoteActionsFor(note, can);
  const isDraft = note.status === 'DRAFT';
  const isCancelled = note.status === 'CANCELLED';
  const billing = addressLines(note.billingAddress) || addressLines(customer.address);

  return (
    <div className="space-y-5">
      <PageHeader
        title={note.creditNoteNo || 'Draft credit note'}
        description={`${note.customerName || customer.name || 'Customer'} · ${formatDate(
          note.creditNoteDate
        )}`}
        breadcrumbs={[
          { label: 'Credit Notes', to: '/app/credit-notes' },
          { label: note.creditNoteNo || 'Credit note' },
        ]}
        actions={
          <>
            <Button variant="outline" className="max-sm:hidden" onClick={() => navigate('/app/credit-notes')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" onClick={() => openCreditNotePdf(note)}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            {isDraft && can('creditnotes.update') && (
              <Button
                variant="outline"
                onClick={() => navigate(`/app/credit-notes/${note.id}/edit`)}
              >
                <Pencil className="h-4 w-4" /> Edit draft
              </Button>
            )}
            {available.includes('issue') && (
              <Button onClick={() => setAction('issue')}>
                <Send className="h-4 w-4" /> Issue credit note
              </Button>
            )}
            {available.includes('cancel') && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setAction('cancel')}
              >
                <X className="h-4 w-4" /> Cancel credit note
              </Button>
            )}
            {isDraft && can('creditnotes.delete') && (
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
        <StatusBadge status={note.status} />
        {note.invoiceNo && (
          <span className="text-xs text-muted-foreground">Against invoice {note.invoiceNo}</span>
        )}
        {note.orderNo && (
          <span className="text-xs text-muted-foreground">Order {note.orderNo}</span>
        )}
        <span className="text-xs text-muted-foreground">
          Created {formatDateTime(note.createdAt)}
          {note.createdBy?.name ? ` by ${note.createdBy.name}` : ''}
        </span>
      </div>

      {isDraft && (
        <Alert tone="info">
          <AlertTitle>This credit note is a draft</AlertTitle>
          <AlertDescription>
            Drafts do not change the invoice balance or customer outstanding. Issue it to apply the
            credit, or edit/delete it while it is still a draft.
          </AlertDescription>
        </Alert>
      )}

      {note.status === 'CANCELLED' && (
        <Alert tone="warning">
          <AlertTitle>Credit note cancelled</AlertTitle>
          <AlertDescription>
            {note.cancelReason || 'No reason was provided.'}
            {note.cancelledBy?.name && (
              <span className="block text-xs opacity-80">
                By {note.cancelledBy.name}
                {note.cancelledAt ? ` · ${formatDateTime(note.cancelledAt)}` : ''}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Credit total" value={money(note.total)} icon={FileText} />
        <SummaryCard
          label="Applied"
          value={money(note.appliedAmount)}
          hint={
            isCancelled && Number(note.appliedAmount) > 0
              ? 'Reversed when the note was cancelled'
              : 'Knocked off the invoice balance'
          }
          icon={Wallet}
          tone={isCancelled && Number(note.appliedAmount) > 0 ? 'muted' : 'success'}
        />
        <SummaryCard
          label="Unapplied"
          value={money(note.unappliedAmount)}
          hint="Held as customer credit"
          icon={Info}
          tone="warning"
        />
        <SummaryCard
          label="Lines"
          value={formatNumber((note.items || []).length)}
          hint={`${formatNumber(note.itemCount || 0)} units credited`}
          icon={FileText}
          tone="brand"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Credited lines</CardTitle>
              <CardDescription>
                {formatNumber(note.itemCount || 0)} units · {note.items?.length || 0} product
                {note.items?.length === 1 ? '' : 's'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <LineItemsPhone items={note.items || []} money={money} showTag={false} />
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-y bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-6 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 font-medium">HSN</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Rate</th>
                      <th className="px-3 py-2 text-right font-medium">Disc</th>
                      <th className="px-3 py-2 text-right font-medium">Tax</th>
                      <th className="px-6 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(note.items || []).map((item, index) => (
                      <tr key={item.id || index}>
                        <td className="px-6 py-3 text-muted-foreground">{index + 1}</td>
                        <td className="px-3 py-3">
                          <p className="font-medium">{item.name || '—'}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.sku || '—'}
                            {item.unit ? ` · ${item.unit}` : ''}
                          </p>
                          {item.note && (
                            <p className="mt-1 text-xs italic text-muted-foreground">{item.note}</p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">
                          {item.hsnCode || '—'}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatNumber(item.qty)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {money(item.unitPrice)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {Number(item.discountPercent) > 0 ? `${item.discountPercent}%` : '—'}
                        </td>
                        <td className="px-3 py-3 text-right text-xs tabular-nums text-muted-foreground">
                          {item.taxRate}%
                        </td>
                        <td className="px-6 py-3 text-right font-medium tabular-nums">
                          {money(item.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end border-t px-4 py-4 sm:px-6">
                <dl className="w-full max-w-xs space-y-1.5 text-sm">
                  <TotalRow label="Subtotal" value={money(note.subtotal)} />
                  <TotalRow label="Discount" value={`− ${money(note.discountTotal)}`} />
                  <TotalRow label="Taxable value" value={money(note.taxableTotal)} />
                  <TotalRow label="Tax" value={money(note.taxTotal)} />
                  {breakupRows(note.taxBreakup, taxSettings).map((r) => (
                    <TotalRow key={r.label} label={r.label} value={r.value.map(money).join(' / ')} muted />
                  ))}
                  <TotalRow
                    label="Round off"
                    value={`${Number(note.roundOff) >= 0 ? '+' : '−'} ${money(
                      Math.abs(Number(note.roundOff) || 0)
                    )}`}
                    muted
                  />
                  <div className="flex items-center justify-between border-t pt-2">
                    <dt className="font-medium">Credit total</dt>
                    <dd className="text-lg font-bold tabular-nums">{money(note.total)}</dd>
                  </div>
                  <TotalRow
                    label={isCancelled ? 'Applied (reversed)' : 'Applied'}
                    value={money(note.appliedAmount)}
                    muted
                  />
                  <TotalRow label="Unapplied" value={money(note.unappliedAmount)} muted />
                </dl>
              </div>
            </CardContent>
          </Card>

          {(note.reasonNote || note.notes) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Reason &amp; notes</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Reason
                  </p>
                  <p className="mt-1 text-sm font-medium">{creditNoteReasonLabel(note.reason)}</p>
                  {note.reasonNote && (
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">
                      {note.reasonNote}
                    </p>
                  )}
                </div>
                {note.notes && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Internal notes
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{note.notes}</p>
                  </div>
                )}
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
                <p className="font-medium">{note.customerName || customer.name || '—'}</p>
                {(note.customerCode || customer.code) && (
                  <p className="text-xs text-muted-foreground">
                    {note.customerCode || customer.code}
                  </p>
                )}
              </div>
              {(note.customerPhone || customer.phone) && (
                <p className="text-muted-foreground">{note.customerPhone || customer.phone}</p>
              )}
              {(note.customerGstin || customer.gstin) && (
                <p className="text-xs text-muted-foreground">
                  {taxIdLabel} {note.customerGstin || customer.gstin}
                </p>
              )}
              {billing && <p className="text-xs text-muted-foreground">{billing}</p>}
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
              <CardTitle>Linked invoice</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {invoice ? (
                <>
                  <InfoRow label="Invoice" value={invoice.invoiceNo || '—'} />
                  <InfoRow label="Invoice date" value={formatDate(invoice.invoiceDate)} />
                  <InfoRow label="Invoice status" value={titleCase(invoice.status)} />
                  <InfoRow label="Invoice total" value={money(invoice.total)} />
                  <InfoRow label="Invoice balance" value={money(invoice.balanceDue)} />
                  {invoice.orderNo && <InfoRow label="Order" value={invoice.orderNo} />}
                  <Link
                    to={`/app/invoices/${invoice.id}`}
                    className="inline-block text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
                  >
                    View invoice
                  </Link>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {note.invoiceNo
                    ? `Invoice ${note.invoiceNo} is no longer available.`
                    : 'No linked invoice.'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>History</CardTitle>
              <CardDescription>Every workflow step on this credit note</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-0">
                {(note.statusHistory || []).map((entry, index, list) => (
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
              {(!note.statusHistory || note.statusHistory.length === 0) && (
                <p className="text-sm text-muted-foreground">No history recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CreditNoteActionDialog
        action={action}
        note={note}
        open={Boolean(action)}
        onClose={() => setAction(null)}
        onDone={invalidate}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete this draft credit note?"
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

function TotalRow({ label, value, muted = false }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={muted ? 'text-xs text-muted-foreground' : 'text-muted-foreground'}>{label}</dt>
      <dd className={`tabular-nums ${muted ? 'text-xs text-muted-foreground' : ''}`}>{value}</dd>
    </div>
  );
}
