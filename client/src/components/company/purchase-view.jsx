import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api, { apiError } from '@/api/client';
import { ConfirmDialog } from '@/components/ui/dialog';
import { CancelDialog } from '@/components/company/payables-shared-dialogs';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { FormShell } from '@/components/ui/form-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/badge';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/utils/format';
import { Ban, FileText, PackagePlus, Printer, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PrintStatus, openDocumentPdf } from '@/components/company/print-control';
import { useTaxLabels } from '@/hooks/useLocations';

/**
 * Read-only view of a saved purchase document: purchase order, goods receipt,
 * supplier payment or purchase return. Same layout as the supplier bill view.
 */
const KINDS = {
  po: { path: 'purchase-orders', no: 'poNo', date: 'poDate', label: 'Purchase order', list: 'Purchase Orders' },
  grn: { path: 'goods-receipts', no: 'grnNo', date: 'grnDate', label: 'Goods receipt', list: 'Goods Receipts' },
  payment: { path: 'supplier-payments', no: 'paymentNo', date: 'paymentDate', label: 'Supplier payment', list: 'Supplier Payments' },
  return: { path: 'purchase-returns', no: 'returnNo', date: 'returnDate', label: 'Purchase return', list: 'Purchase Returns' },
};

const Row = ({ label, value, strong }) => (
  <div className={`flex justify-between gap-4 ${strong ? 'border-t pt-1 font-semibold' : ''}`}>
    <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
);

const Fact = ({ label, children }) =>
  children ? (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  ) : null;

const humanize = (v) => String(v || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Tax lines: CGST + SGST inside the state, IGST across states. */
function TaxRows({ doc, money, label = 'Tax' }) {
  const t = doc.taxBreakup || {};
  if (!(t.cgst || t.sgst || t.igst)) return doc.taxTotal ? <Row label={label} value={money(doc.taxTotal)} /> : null;
  return (
    <>
      {t.cgst > 0 && <Row label="CGST" value={money(t.cgst)} />}
      {t.sgst > 0 && <Row label="SGST" value={money(t.sgst)} />}
      {t.igst > 0 && <Row label="IGST" value={money(t.igst)} />}
    </>
  );
}

const idOf = (v) => (v && typeof v === 'object' ? v.id || v._id : v) || '';

/**
 * What can be done next with a saved purchase document, as buttons on its own
 * screen (the same actions as the list's row menu, plus the next step of the
 * cycle: PO -> receive goods, goods receipt -> book the bill).
 */
function PurchaseDocActions({ kind, doc, id }) {
  const cfg = KINDS[kind];
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = usePermissions();
  const [confirmSend, setConfirmSend] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['company', 'purchase-view', kind, id] });
    queryClient.invalidateQueries({ queryKey: ['company', 'inventory'] });
    queryClient.invalidateQueries({ queryKey: ['company', 'payables'] });
  };
  const send = useMutation({
    mutationFn: () => api.post(`/v1/purchase-orders/${id}/send`, {}),
    onSuccess: () => {
      toast.success('Purchase order marked as sent');
      setConfirmSend(false);
      refresh();
    },
    onError: (err) => toast.error(apiError(err).message),
  });
  const cancel = useMutation({
    mutationFn: (reason) => api.post(`/v1/${cfg.path}/${id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success(`${cfg.label} cancelled`);
      setCancelling(false);
      refresh();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const status = doc.status;
  const supplier = idOf(doc.supplierId);
  const canCancel =
    (kind === 'po' && can('purchases.cancel') && ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'].includes(status)) ||
    (kind === 'grn' && can('grn.update') && status === 'POSTED') ||
    (kind === 'payment' && can('supplierpayments.cancel') && status !== 'CANCELLED') ||
    (kind === 'return' && can('purchasereturns.cancel') && status !== 'CANCELLED');

  return (
    <>
      {kind === 'po' && status === 'DRAFT' && can('purchases.update') && (
        <Button variant="outline" onClick={() => setConfirmSend(true)}>
          <Send className="h-4 w-4" /> Mark as sent
        </Button>
      )}
      {kind === 'po' && ['SENT', 'PARTIALLY_RECEIVED'].includes(status) && can('grn.create') && (
        <Button onClick={() => navigate(`/app/goods-receipts/new?po=${id}`)}>
          <PackagePlus className="h-4 w-4" /> Receive goods
        </Button>
      )}
      {kind === 'grn' && status === 'POSTED' && can('bills.create') && (
        <Button onClick={() => navigate(`/app/purchase-bills/new${supplier ? `?supplier=${supplier}` : ''}`)}>
          <FileText className="h-4 w-4" /> Book bill
        </Button>
      )}
      {canCancel && (
        <Button variant="outline" className="text-destructive" onClick={() => setCancelling(true)}>
          <Ban className="h-4 w-4" /> Cancel
        </Button>
      )}
      <ConfirmDialog
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        onConfirm={() => send.mutate()}
        title="Mark this purchase order as sent?"
        message="This records that the order has been placed with the supplier."
        confirmLabel="Mark as sent"
        tone="default"
        loading={send.isPending}
      />
      <CancelDialog
        open={cancelling}
        title={`Cancel ${doc[cfg.no] || cfg.label.toLowerCase()}?`}
        message={
          kind === 'po'
            ? 'No more goods can be received against it.'
            : kind === 'grn'
              ? 'The goods come out of stock again.'
              : kind === 'payment'
                ? 'The bills it paid become due again and what you owe the supplier goes back up.'
                : 'The goods go back into stock and the bill amounts come back.'
        }
        onClose={() => setCancelling(false)}
        onConfirm={(reason) => cancel.mutate(reason)}
        loading={cancel.isPending}
      />
    </>
  );
}

/** The saved document - as a dialog, or with `asPage` as its own full screen. */
export function PurchaseDocDialog({ kind, id, onClose, asPage = false }) {
  const cfg = KINDS[kind];
  const { company } = useAuth();
  const { can } = usePermissions();
  const { taxIdLabel, taxLabel } = useTaxLabels();
  const money = (v) => formatMoney(v || 0, company?.currency);
  const { data: doc, isLoading } = useQuery({
    queryKey: ['company', 'purchase-view', kind, id],
    queryFn: async () => (await api.get(`/v1/${cfg.path}/${id}`)).data?.data,
    enabled: Boolean(id),
  });

  const title = doc ? `${doc[cfg.no] || cfg.label} · ${doc.supplierName || ''}` : cfg.label;
  const description = doc ? `${cfg.label} dated ${formatDate(doc[cfg.date])}` : '';

  return (
    <FormShell
      asPage={asPage}
      open
      onClose={onClose}
      size="lg"
      title={title}
      description={description}
      breadcrumbs={[{ label: 'Purchase', to: '/app/purchase-bills' }, { label: cfg.list, to: `/app/${cfg.path}` }, { label: doc?.[cfg.no] || cfg.label }]}
      headerActions={asPage && doc ? <PurchaseDocActions kind={kind} doc={doc} id={id} /> : null}
    >
      {isLoading || !doc ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={doc.status}>{humanize(doc.status)}</StatusBadge>
            {kind === 'po' && doc.receiveProgress !== undefined && (
              <span className="text-muted-foreground">Received {Math.round((Number(doc.receiveProgress) || 0) * 100)}%</span>
            )}
            {doc.supplierGstin && <span className="text-muted-foreground">{taxIdLabel} {doc.supplierGstin}</span>}
            {kind === 'po' && can('purchases.print') && (
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => openDocumentPdf(`/v1/purchase-orders/${id}/pdf`)}>
                <Printer className="h-4 w-4" /> Print / PDF
              </Button>
            )}
          </div>
          {kind === 'po' && <PrintStatus docType="PURCHASE_ORDER" id={id} draft={doc.status === 'DRAFT'} />}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border bg-muted/30 p-3 sm:grid-cols-3">
            <Fact label="Supplier">{doc.supplierName}</Fact>
            <Fact label="Warehouse">{doc.warehouseName || doc.warehouse?.name}</Fact>
            {kind === 'po' && <Fact label="Expected delivery">{doc.expectedDate ? formatDate(doc.expectedDate) : ''}</Fact>}
            {kind === 'po' && <Fact label="Payment terms">{doc.paymentTerms && humanize(doc.paymentTerms)}</Fact>}
            {kind === 'po' && <Fact label="Supplier ref.">{doc.poReference}</Fact>}
            {kind === 'grn' && <Fact label="Against PO">{doc.poNo}</Fact>}
            {kind === 'grn' && <Fact label="Supplier invoice">{doc.invoiceNo}</Fact>}
            {kind === 'grn' && <Fact label="Vehicle">{doc.vehicleNo}</Fact>}
            {kind === 'grn' && <Fact label="E-way bill">{doc.eWayBillNo}</Fact>}
            {kind === 'payment' && <Fact label="Mode">{humanize(doc.mode)}</Fact>}
            {kind === 'payment' && <Fact label="Reference">{doc.reference}</Fact>}
            {kind === 'return' && <Fact label="Against GRN">{doc.grnNo}</Fact>}
            {kind === 'return' && <Fact label="Reason">{doc.reason}</Fact>}
          </dl>

          {/* ---- lines ---- */}
          {kind === 'po' && (
            <ul className="divide-y rounded-xl border">
              {doc.items.map((l) => (
                <li key={l.id || l._id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(l.qty)} {l.unit} × {money(l.unitPrice)}
                      {l.discountPercent ? ` · less ${l.discountPercent}%` : ''} · tax {l.taxRate}% ({money(l.taxAmount)})
                      {' · '}received {formatNumber(l.receivedQty || 0)} of {formatNumber(l.qty)}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">{money(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
          )}
          {kind === 'grn' && (
            <ul className="divide-y rounded-xl border">
              {doc.items.map((l) => (
                <li key={l.id || l._id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.orderedQty ? `ordered ${formatNumber(l.orderedQty)} · ` : ''}received {formatNumber(l.receivedQty)} {l.unit}
                      {l.rejectedQty ? ` · rejected ${formatNumber(l.rejectedQty)}${l.rejectReason ? ` (${l.rejectReason})` : ''}` : ''}
                      {' · '}accepted {formatNumber(l.acceptedQty)} × {money(l.unitCost)}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">{money(Number(l.acceptedQty || 0) * Number(l.unitCost || 0))}</span>
                </li>
              ))}
            </ul>
          )}
          {kind === 'return' && (
            <ul className="divide-y rounded-xl border">
              {doc.items.map((l) => (
                <li key={l.id || l._id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{l.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(l.qty)} {l.unit} × {money(l.unitPrice)} · tax {l.taxRate}%{l.billNo ? ` · bill ${l.billNo}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">{money(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
          )}
          {kind === 'payment' && (
            <div className="space-y-1">
              <h3 className="font-semibold">Set against bills</h3>
              {(doc.allocations || []).length ? (
                <ul className="divide-y rounded-xl border">
                  {doc.allocations.map((a, i) => (
                    <li key={a.bill || i} className="flex justify-between gap-3 px-3 py-2">
                      <span>
                        {a.billNo}
                        {a.supplierInvoiceNo ? <span className="text-muted-foreground"> · supplier invoice {a.supplierInvoiceNo}</span> : null}
                      </span>
                      <span className="tabular-nums">{money(a.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">Not set against any bill - kept as an advance.</p>
              )}
            </div>
          )}

          {/* ---- totals ---- */}
          <div className="ml-auto max-w-xs space-y-1">
            {kind === 'po' && (
              <>
                <Row label="Subtotal" value={money(doc.subtotal)} />
                {doc.discountTotal > 0 && <Row label="Discount" value={`− ${money(doc.discountTotal)}`} />}
                <Row label="Taxable value" value={money(doc.taxableTotal)} />
                <TaxRows doc={doc} money={money} label={taxLabel} />
                {doc.roundOff ? <Row label="Round off" value={money(doc.roundOff)} /> : null}
                <Row label="Total" value={money(doc.total)} strong />
              </>
            )}
            {kind === 'grn' && (
              <>
                <Row label="Received" value={formatNumber(doc.totalReceivedQty)} />
                {doc.totalRejectedQty > 0 && <Row label="Rejected" value={formatNumber(doc.totalRejectedQty)} />}
                <Row label="Accepted into stock" value={formatNumber(doc.totalAcceptedQty)} />
                <Row label="Stock value (before tax)" value={money(doc.totalValue)} strong />
              </>
            )}
            {kind === 'return' && (
              <>
                <Row label="Taxable value" value={money(doc.taxableTotal)} />
                <TaxRows doc={doc} money={money} label={taxLabel} />
                <Row label="Total" value={money(doc.total)} strong />
              </>
            )}
            {kind === 'payment' && (
              <>
                <Row label="Amount paid" value={money(doc.amount)} strong />
                <Row label="Set against bills" value={money(doc.allocatedAmount)} />
                {doc.advanceAmount > 0 && <Row label="Advance (unused)" value={money(doc.advanceAmount)} />}
              </>
            )}
          </div>

          {kind === 'po' && doc.grns?.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-semibold">Goods receipts</h3>
              {doc.grns.map((g) => (
                <p key={g.id || g._id} className="flex justify-between text-muted-foreground">
                  <span>
                    {g.grnNo} · {formatDate(g.grnDate)} · {humanize(g.status)}
                  </span>
                  <span className="tabular-nums">{formatNumber(g.totalAcceptedQty ?? g.totalReceivedQty ?? 0)} accepted</span>
                </p>
              ))}
            </div>
          )}

          {(doc.notes || doc.cancelReason) && (
            <div className="rounded-lg bg-muted/40 p-3 text-xs">
              {doc.notes && <p>Notes: {doc.notes}</p>}
              {doc.cancelReason && <p className="text-destructive">Cancelled: {doc.cancelReason}</p>}
            </div>
          )}

          {doc.statusHistory?.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-semibold">History</h3>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {doc.statusHistory.map((h, i) => (
                  <li key={i}>
                    {humanize(h.status)} · {formatDateTime(h.at)}
                    {h.byName ? ` · ${h.byName}` : ''}
                    {h.note ? ` - ${h.note}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </FormShell>
  );
}

export default PurchaseDocDialog;
