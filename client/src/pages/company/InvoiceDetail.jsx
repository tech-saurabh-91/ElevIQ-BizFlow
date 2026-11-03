import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  FileText,
  MapPin,
  Pencil,
  Phone,
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
import { formatDate, formatDateTime, formatMoney, formatNumber, titleCase } from '@/utils/format';
import { paymentModeLabel } from '@/components/company/order-shared';
import {
  CreditNoteActionDialog,
  InvoiceActionDialog,
  creditNoteActionsFor,
  creditNoteReasonLabel,
  invoiceActionsFor,
  openCreditNotePdf,
  openInvoicePdf,
} from '@/components/company/invoice-shared';
import { breakupRows } from '@/utils/tax';
import { useTaxLabels } from '@/hooks/useLocations';

const addressLines = (address = {}) =>
  [address.line1, address.line2, address.city, address.state, address.pincode, address.country]
    .filter(Boolean)
    .join(', ');

export default function InvoiceDetail() {
  const { tax: taxSettings, taxIdLabel } = useTaxLabels();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company } = useAuth();

  const [action, setAction] = useState(null);
  const [noteAction, setNoteAction] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: invoice, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'invoice', id],
    queryFn: async () => {
      const { data: body } = await api.get(`/v1/invoices/${id}`);
      return body?.data;
    },
    enabled: Boolean(id),
  });

  const creditNotesQuery = useQuery({
    queryKey: ['company', 'credit-notes', 'by-invoice', id],
    queryFn: async () => {
      const { data: body } = await api.get('/v1/credit-notes', {
        params: { invoiceId: id, limit: 100 },
      });
      return body;
    },
    enabled: Boolean(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'invoice', id] });
    queryClient.invalidateQueries({ queryKey: ['company', 'invoices'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'credit-notes'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/v1/invoices/${id}`),
    onSuccess: () => {
      toast.success('Draft invoice deleted');
      invalidate();
      navigate('/app/invoices', { replace: true });
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

  if (isError || !invoice) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Invoice not found"
          description={
            apiError(error).message ||
            'This invoice may have been deleted or belongs to another team.'
          }
          action={
            <Button variant="outline" onClick={() => navigate('/app/invoices')}>
              <ArrowLeft className="h-4 w-4" /> Back to invoices
            </Button>
          }
        />
      </Card>
    );
  }

  const customer = invoice.customerId && typeof invoice.customerId === 'object' ? invoice.customerId : {};
  const order = invoice.order && typeof invoice.order === 'object' ? invoice.order : null;
  const available = invoiceActionsFor(invoice, can);
  const isDraft = invoice.status === 'DRAFT';
  const cancellable =
    !isDraft &&
    invoice.status !== 'CANCELLED' &&
    can('invoices.cancel') &&
    Number(invoice.amountPaid || 0) === 0 &&
    Number(invoice.creditNoteTotal || 0) === 0;
  const canCredit =
    !isDraft &&
    invoice.status !== 'CANCELLED' &&
    can('creditnotes.create') &&
    Number(invoice.balanceDue) > 0;
  const creditNotes = creditNotesQuery.data?.data || [];
  const billing = addressLines(invoice.billingAddress) || addressLines(customer.address);
  const progress =
    Number(invoice.total) > 0
      ? Math.min(100, Math.round((Number(invoice.amountPaid || 0) / Number(invoice.total)) * 100))
      : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={invoice.invoiceNo || 'Draft invoice'}
        description={`${invoice.customerName || customer.name || 'Customer'} · ${formatDate(
          invoice.invoiceDate
        )}`}
        breadcrumbs={[
          { label: 'Invoices', to: '/app/invoices' },
          { label: invoice.invoiceNo || 'Invoice' },
        ]}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate('/app/invoices')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" onClick={() => openInvoicePdf(invoice)}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            {isDraft && can('invoices.update') && (
              <Button variant="outline" onClick={() => navigate(`/app/invoices/${invoice.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit draft
              </Button>
            )}
            {canCredit && (
              <Button
                variant="outline"
                onClick={() => navigate(`/app/credit-notes/new?invoiceId=${invoice.id}`)}
              >
                <FileText className="h-4 w-4" /> Credit note
              </Button>
            )}
            {available.includes('issue') && (
              <Button onClick={() => setAction('issue')}>
                <Send className="h-4 w-4" /> Issue invoice
              </Button>
            )}
            {cancellable && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setAction('cancel')}
              >
                <X className="h-4 w-4" /> Cancel invoice
              </Button>
            )}
            {isDraft && can('invoices.delete') && (
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
        <StatusBadge status={invoice.status} />
        {invoice.orderNo && (
          <span className="text-xs text-muted-foreground">Order {invoice.orderNo}</span>
        )}
        {invoice.direct && <span className="text-xs text-muted-foreground">Direct invoice</span>}
        {invoice.poReference && (
          <span className="text-xs text-muted-foreground">PO ref {invoice.poReference}</span>
        )}
        <span className="text-xs text-muted-foreground">
          Created {formatDateTime(invoice.createdAt)}
          {invoice.createdBy?.name ? ` by ${invoice.createdBy.name}` : ''}
        </span>
      </div>

      {isDraft && (
        <Alert tone="info">
          <AlertTitle>This invoice is a draft</AlertTitle>
          <AlertDescription>
            Drafts do not affect the customer outstanding or the linked order until issued. Edit or
            delete it freely, or issue it to lock it.
          </AlertDescription>
        </Alert>
      )}

      {invoice.status === 'CANCELLED' && (
        <Alert tone="warning">
          <AlertTitle>Invoice cancelled</AlertTitle>
          <AlertDescription>
            {invoice.cancelReason || 'No reason was provided.'}
            {invoice.cancelledBy?.name && (
              <span className="block text-xs opacity-80">
                By {invoice.cancelledBy.name}
                {invoice.cancelledAt ? ` · ${formatDateTime(invoice.cancelledAt)}` : ''}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {invoice.status === 'OVERDUE' && (
        <Alert tone="destructive">
          <AlertTitle>Payment overdue</AlertTitle>
          <AlertDescription>
            This invoice was due on {formatDate(invoice.dueDate)} with {money(invoice.balanceDue)}{' '}
            still outstanding.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Invoice total" value={money(invoice.total)} icon={Receipt} />
        <SummaryCard
          label="Received"
          value={money(invoice.amountPaid)}
          hint={`${progress}% of the invoice`}
          icon={Wallet}
          tone="success"
        />
        <SummaryCard
          label="Credit notes"
          value={money(invoice.creditNoteTotal)}
          hint={creditNoteHint(invoice.creditNoteCount || 0, creditNotes)}
          icon={FileText}
          tone="warning"
        />
        <SummaryCard
          label="Balance due"
          value={money(invoice.balanceDue)}
          hint={invoice.dueDate ? `Due ${formatDate(invoice.dueDate)}` : 'No due date'}
          icon={CheckCircle2}
          tone={Number(invoice.balanceDue) > 0 ? 'destructive' : 'success'}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Line items</CardTitle>
              <CardDescription>
                {formatNumber(invoice.itemCount || 0)} units · {invoice.items?.length || 0} product
                {invoice.items?.length === 1 ? '' : 's'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
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
                    {(invoice.items || []).map((item, index) => (
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

              <div className="flex justify-end border-t px-6 py-4">
                <dl className="w-full max-w-xs space-y-1.5 text-sm">
                  <TotalRow label="Subtotal" value={money(invoice.subtotal)} />
                  <TotalRow label="Discount" value={`− ${money(invoice.discountTotal)}`} />
                  <TotalRow label="Taxable value" value={money(invoice.taxableTotal)} />
                  <TotalRow label="Tax" value={money(invoice.taxTotal)} />
                  {breakupRows(invoice.taxBreakup, taxSettings).map((r) => (
                    <TotalRow key={r.label} label={r.label} value={r.value.map(money).join(' / ')} muted />
                  ))}
                  <TotalRow
                    label="Round off"
                    value={`${Number(invoice.roundOff) >= 0 ? '+' : '−'} ${money(
                      Math.abs(Number(invoice.roundOff) || 0)
                    )}`}
                    muted
                  />
                  <div className="flex items-center justify-between border-t pt-2">
                    <dt className="font-medium">Total</dt>
                    <dd className="text-lg font-bold tabular-nums">{money(invoice.total)}</dd>
                  </div>
                  <TotalRow label="Received" value={`− ${money(invoice.amountPaid)}`} muted />
                  <TotalRow
                    label="Credit notes"
                    value={`− ${money(invoice.creditNoteTotal)}`}
                    muted
                  />
                  <div className="flex items-center justify-between border-t pt-2">
                    <dt className="font-medium">Balance due</dt>
                    <dd className="text-lg font-bold tabular-nums">{money(invoice.balanceDue)}</dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>

          {(invoice.notes || invoice.terms || invoice.footerNote) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Document text</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {invoice.notes && (
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Notes
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{invoice.notes}</p>
                  </div>
                )}
                {invoice.terms && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Terms &amp; conditions
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{invoice.terms}</p>
                  </div>
                )}
                {invoice.footerNote && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Footer note
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{invoice.footerNote}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle>Credit notes</CardTitle>
                <CardDescription>Credits raised against this invoice</CardDescription>
              </div>
              {canCredit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/app/credit-notes/new?invoiceId=${invoice.id}`)}
                >
                  <FileText className="h-4 w-4" /> New credit note
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {creditNotesQuery.isLoading ? (
                <div className="space-y-2 p-6">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : creditNotes.length === 0 ? (
                <p className="px-6 py-6 text-sm text-muted-foreground">
                  No credit notes have been raised against this invoice.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-y bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-6 py-2 font-medium">Credit note</th>
                        <th className="px-3 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Reason</th>
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                        <th className="px-3 py-2 text-right font-medium">Applied</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-6 py-2 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {creditNotes.map((note) => {
                        const noteAvailable = creditNoteActionsFor(note, can);
                        return (
                          <tr key={note.id}>
                            <td className="px-6 py-3">
                              <Link
                                to={`/app/credit-notes/${note.id}`}
                                className="font-semibold text-brand-600 hover:underline dark:text-brand-300"
                              >
                                {note.creditNoteNo || 'Draft'}
                              </Link>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              {formatDate(note.creditNoteDate)}
                            </td>
                            <td className="px-3 py-3 text-xs text-muted-foreground">
                              {creditNoteReasonLabel(note.reason)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              {money(note.total)}
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">
                              {note.status === 'CANCELLED' ? (
                                <span className="text-xs text-muted-foreground">Reversed</span>
                              ) : (
                                money(note.appliedAmount)
                              )}
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge status={note.status} />
                            </td>
                            <td className="px-6 py-3 text-right">
                              <div className="inline-flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openCreditNotePdf(note)}
                                  aria-label={`Print ${note.creditNoteNo || 'credit note'}`}
                                >
                                  <Printer className="h-4 w-4" />
                                </Button>
                                {noteAvailable.includes('issue') && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setNoteAction({ action: 'issue', note })}
                                  >
                                    Issue
                                  </Button>
                                )}
                                {noteAvailable.includes('cancel') && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => setNoteAction({ action: 'cancel', note })}
                                  >
                                    Cancel
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-medium">{invoice.customerName || customer.name || '—'}</p>
                {(invoice.customerCode || customer.code) && (
                  <p className="text-xs text-muted-foreground">
                    {invoice.customerCode || customer.code}
                  </p>
                )}
              </div>
              {(invoice.customerPhone || customer.phone) && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  {invoice.customerPhone || customer.phone}
                </p>
              )}
              {(invoice.customerGstin || customer.gstin) && (
                <p className="text-xs text-muted-foreground">
                  {taxIdLabel} {invoice.customerGstin || customer.gstin}
                </p>
              )}
              {billing && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{billing}</span>
                </div>
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
              <CardTitle>Invoice information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <InfoRow label="Invoice date" value={formatDate(invoice.invoiceDate)} />
              <InfoRow label="Due date" value={formatDate(invoice.dueDate)} />
              <InfoRow label="Payment mode" value={paymentModeLabel(invoice.paymentMode)} />
              <InfoRow
                label="Payment terms"
                value={
                  invoice.paymentTerms === 'NET_7'
                    ? 'Net 7 days'
                    : titleCase((invoice.paymentTerms || '').replace('NET_', 'NET '))
                }
              />
              <InfoRow label="Credit days" value={`${invoice.creditDays ?? 0} days`} />
              <InfoRow label="Salesman" value={invoice.salesman?.name || 'Unassigned'} />
              <InfoRow label="Route" value={invoice.route?.name || '—'} />
              <InfoRow label="Warehouse" value={invoice.warehouse?.name || '—'} />
              {invoice.placeOfSupply && (
                <InfoRow label="Place of supply" value={invoice.placeOfSupply} />
              )}
              {invoice.issuedBy?.name && (
                <InfoRow
                  label="Issued by"
                  value={`${invoice.issuedBy.name}${
                    invoice.issuedAt ? ` · ${formatDate(invoice.issuedAt)}` : ''
                  }`}
                />
              )}
            </CardContent>
          </Card>

          {order?.id && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Source order</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <InfoRow label="Order" value={order.orderNo || '—'} />
                <InfoRow label="Order date" value={formatDate(order.orderDate)} />
                <InfoRow label="Order status" value={titleCase(order.status)} />
                <InfoRow label="Order total" value={money(order.total)} />
                <Link
                  to={`/app/orders/${order.id}`}
                  className="inline-block text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
                >
                  View sales order
                </Link>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>History</CardTitle>
              <CardDescription>Every workflow step on this invoice</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-0">
                {(invoice.statusHistory || []).map((entry, index, list) => (
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
              {(!invoice.statusHistory || invoice.statusHistory.length === 0) && (
                <p className="text-sm text-muted-foreground">No history recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <InvoiceActionDialog
        action={action}
        invoice={invoice}
        open={Boolean(action)}
        onClose={() => setAction(null)}
        onDone={invalidate}
      />

      <CreditNoteActionDialog
        action={noteAction?.action}
        note={noteAction?.note}
        open={Boolean(noteAction)}
        onClose={() => setNoteAction(null)}
        onDone={invalidate}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete this draft invoice?"
        message="This draft will be permanently removed. Only drafts can be deleted."
        confirmLabel="Delete draft"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

/** Small caption under the "Credit notes" summary card on the invoice detail. */
function creditNoteHint(count, notes = []) {
  if (!count && !notes.length) return 'No credit notes';
  const total = notes.reduce((sum, n) => sum + Number(n.total || 0), 0);
  const label = `${count} credit note${count === 1 ? '' : 's'}`;
  return total > 0 ? `${label} · ${formatMoney(total)}` : label;
}

function SummaryCard({ label, value, hint, icon: Icon, tone = 'brand' }) {
  const tones = {
    brand: 'text-brand-600 dark:text-brand-300 bg-brand-500/12',
    success: 'text-success bg-success/12',
    warning: 'text-warning bg-warning/15',
    destructive: 'text-destructive bg-destructive/12',
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
