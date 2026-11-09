import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  MapPin,
  PackageCheck,
  Pencil,
  Phone,
  Printer,
  Send,
  Trash2,
  Truck,
  XCircle,
} from 'lucide-react';
import { SavedLineTag, LineItemsPhone } from '@/components/company/sale-pricing';

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
import {
  OrderActionDialog,
  openOrderPdf,
  orderActionsFor,
  paymentModeLabel,
} from '@/components/company/order-shared';
import { breakupRows } from '@/utils/tax';
import { useTaxLabels } from '@/hooks/useLocations';

const ACTION_BUTTONS = {
  submit: { label: 'Submit order', icon: Send },
  approve: { label: 'Approve', icon: CheckCircle2 },
  reject: { label: 'Reject', icon: XCircle, outline: true, destructive: true },
  dispatch: { label: 'Mark dispatched', icon: Truck },
  deliver: { label: 'Mark delivered', icon: PackageCheck },
  cancel: { label: 'Cancel order', icon: XCircle, outline: true, destructive: true },
};

const addressLines = (address = {}) =>
  [address.line1, address.line2, address.city, address.state, address.pincode, address.country]
    .filter(Boolean)
    .join(', ');

export default function OrderDetail() {
  const { tax: taxSettings, taxIdLabel } = useTaxLabels();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const { company } = useAuth();

  const [action, setAction] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: order, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'order', id],
    queryFn: async () => {
      const { data: body } = await api.get(`/v1/orders/${id}`);
      return body?.data;
    },
    enabled: Boolean(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'order', id] });
    queryClient.invalidateQueries({ queryKey: ['company', 'orders'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'customers'] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/v1/orders/${id}`),
    onSuccess: () => {
      toast.success('Draft order deleted');
      invalidate();
      navigate('/app/orders', { replace: true });
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

  if (isError || !order) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Order not found"
          description={apiError(error).message || 'This order may have been deleted or belongs to another team.'}
          action={
            <Button variant="outline" onClick={() => navigate('/app/orders')}>
              <ArrowLeft className="h-4 w-4" /> Back to orders
            </Button>
          }
        />
      </Card>
    );
  }

  const customer = order.customerId && typeof order.customerId === 'object' ? order.customerId : {};
  const available = orderActionsFor(order, can);
  const isDraft = order.status === 'DRAFT';
  const billing = addressLines(order.billingAddress);
  const shipping = addressLines(order.shippingAddress);

  return (
    <div className="space-y-5">
      <PageHeader
        title={order.orderNo || 'Draft order'}
        description={`${order.customerName || customer.name || 'Customer'} · ${formatDate(
          order.orderDate
        )}`}
        breadcrumbs={[{ label: 'Orders', to: '/app/orders' }, { label: order.orderNo || 'Order' }]}
        actions={
          <>
            <Button variant="outline" className="max-sm:hidden" onClick={() => navigate('/app/orders')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="outline" onClick={() => openOrderPdf(order)}>
              <Printer className="h-4 w-4" /> Print / PDF
            </Button>
            {isDraft && can('orders.update') && (
              <Button variant="outline" onClick={() => navigate(`/app/orders/${order.id}/edit`)}>
                <Pencil className="h-4 w-4" /> Edit draft
              </Button>
            )}
            {available.map((key) => {
              const meta = ACTION_BUTTONS[key];
              if (!meta) return null;
              const Icon = meta.icon;
              return (
                <Button
                  key={key}
                  variant={meta.outline ? 'outline' : 'default'}
                  className={meta.destructive ? 'text-destructive hover:text-destructive' : undefined}
                  onClick={() => setAction(key)}
                >
                  <Icon className="h-4 w-4" /> {meta.label}
                </Button>
              );
            })}
            {isDraft && can('orders.delete') && (
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
        <StatusBadge status={order.status} />
        {order.approvalRequired && <span className="text-xs text-warning">Approval pending</span>}
        <span className="text-xs text-muted-foreground">
          Created {formatDateTime(order.createdAt)}
          {order.createdBy?.name ? ` by ${order.createdBy.name}` : ''}
        </span>
        {order.poReference && (
          <span className="text-xs text-muted-foreground">PO ref {order.poReference}</span>
        )}
      </div>

      {order.status === 'PENDING_APPROVAL' && (
        <Alert tone="info">
          <AlertTitle>Awaiting approval</AlertTitle>
          <AlertDescription>
            This order must be approved by a manager before it can be dispatched or invoiced.
          </AlertDescription>
        </Alert>
      )}

      {order.status === 'REJECTED' && (
        <Alert tone="destructive">
          <AlertTitle>Order rejected</AlertTitle>
          <AlertDescription>
            {order.rejectionReason || 'No reason was provided.'}
            {order.rejectedBy?.name && (
              <span className="block text-xs opacity-80">
                By {order.rejectedBy.name}
                {order.rejectedAt ? ` · ${formatDateTime(order.rejectedAt)}` : ''}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {order.status === 'CANCELLED' && (
        <Alert tone="warning">
          <AlertTitle>Order cancelled</AlertTitle>
          <AlertDescription>
            {order.cancelReason || 'No reason was provided.'}
            {order.cancelledBy?.name && (
              <span className="block text-xs opacity-80">
                By {order.cancelledBy.name}
                {order.cancelledAt ? ` · ${formatDateTime(order.cancelledAt)}` : ''}
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Line items</CardTitle>
              <CardDescription>
                {formatNumber(order.itemCount || 0)} units · {order.items?.length || 0} product
                {order.items?.length === 1 ? '' : 's'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <LineItemsPhone items={order.items || []} money={money} />
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
                    {(order.items || []).map((item, index) => (
                      <tr key={item.id || index}>
                        <td className="px-6 py-3 text-muted-foreground">{index + 1}</td>
                        <td className="px-3 py-3">
                          <p className="font-medium">
                            {item.name || '—'}
                            {item.isFree && <SavedLineTag item={item} />}
                          </p>
                          {!item.isFree && <SavedLineTag item={item} />}
                          <p className="text-xs text-muted-foreground">
                            {item.sku || '—'}
                            {item.unit ? ` · ${item.unit}` : ''}
                          </p>
                          {item.note && <p className="mt-1 text-xs italic text-muted-foreground">{item.note}</p>}
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">{item.hsnCode || '—'}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatNumber(item.qty)}
                          {Number(item.freeQty) > 0 && (
                            <span className="block text-xs text-success">+{item.freeQty} free</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(item.unitPrice)}</td>
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
                  <TotalRow label="Subtotal" value={money(order.subtotal)} />
                  <TotalRow label="Discount" value={`− ${money(order.discountTotal)}`} />
                  <TotalRow label="Taxable value" value={money(order.taxableTotal)} />
                  <TotalRow label="Tax" value={money(order.taxTotal)} />
                  {breakupRows(order.taxBreakup, taxSettings).map((r) => (
                    <TotalRow key={r.label} label={r.label} value={r.value.map(money).join(' / ')} muted />
                  ))}
                  <TotalRow
                    label="Round off"
                    value={`${Number(order.roundOff) >= 0 ? '+' : '−'} ${money(
                      Math.abs(Number(order.roundOff) || 0)
                    )}`}
                    muted
                  />
                  <div className="flex items-center justify-between border-t pt-2">
                    <dt className="font-medium">Total</dt>
                    <dd className="text-lg font-bold tabular-nums">{money(order.total)}</dd>
                  </div>
                </dl>
              </div>
            </CardContent>
          </Card>

          {(order.notes || order.deliveryInstructions || order.internalNotes) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {order.notes && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      To customer
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{order.notes}</p>
                  </div>
                )}
                {order.deliveryInstructions && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Delivery instructions
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{order.deliveryInstructions}</p>
                  </div>
                )}
                {order.internalNotes && (
                  <div className="sm:col-span-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Internal notes
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm">{order.internalNotes}</p>
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
                <p className="font-medium">{order.customerName || customer.name || '—'}</p>
                {customer.code && <p className="text-xs text-muted-foreground">{customer.code}</p>}
              </div>
              {(order.customerPhone || customer.phone) && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  {order.customerPhone || customer.phone}
                </p>
              )}
              {(order.customerGstin || customer.gstin) && (
                <p className="text-xs text-muted-foreground">
                  {taxIdLabel} {order.customerGstin || customer.gstin}
                </p>
              )}
              {(billing || customer.address?.line1) && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{billing || addressLines(customer.address)}</span>
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
                <div>
                  <p className="text-muted-foreground">Credit days</p>
                  <p className="font-medium">{customer.creditDays ?? order.creditDays ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Payment terms</p>
                  <p className="font-medium">
                    {titleCase(customer.paymentTerms || order.paymentTerms || '—')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Order information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <InfoRow label="Order date" value={formatDate(order.orderDate)} />
              <InfoRow label="Expected delivery" value={formatDate(order.expectedDeliveryDate)} />
              <InfoRow label="Payment mode" value={paymentModeLabel(order.paymentMode)} />
              <InfoRow label="Salesman" value={order.salesman?.name || 'Unassigned'} />
              <InfoRow label="Route" value={order.route?.name || '—'} />
              <InfoRow label="Warehouse" value={order.warehouse?.name || '—'} />
              <InfoRow label="Price list" value={order.priceList?.name || 'Product price'} />
              {order.approvedBy?.name && (
                <InfoRow
                  label="Approved by"
                  value={`${order.approvedBy.name}${order.approvedAt ? ` · ${formatDate(order.approvedAt)}` : ''}`}
                />
              )}
              {order.dispatchedAt && (
                <InfoRow label="Dispatched" value={formatDateTime(order.dispatchedAt)} />
              )}
              {order.deliveredAt && (
                <InfoRow label="Delivered" value={formatDateTime(order.deliveredAt)} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>History</CardTitle>
              <CardDescription>Every workflow step on this order</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-0">
                {(order.statusHistory || []).map((entry, index, list) => (
                  <li key={`${entry.status}-${entry.at}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < list.length - 1 && (
                      <span className="absolute left-[7px] top-4 h-full w-px bg-border" aria-hidden="true" />
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
              {(!order.statusHistory || order.statusHistory.length === 0) && (
                <p className="text-sm text-muted-foreground">No history recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <OrderActionDialog
        action={action}
        order={order}
        open={Boolean(action)}
        onClose={() => setAction(null)}
        onDone={invalidate}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete this draft order?"
        message="This draft will be permanently removed. Only drafts can be deleted."
        confirmLabel="Delete draft"
        loading={deleteMutation.isPending}
      />
    </div>
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
