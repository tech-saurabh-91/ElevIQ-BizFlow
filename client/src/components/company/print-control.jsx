import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { apiError } from '@/api/client';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { formatDateTime } from '@/utils/format';

/**
 * Printing of key documents (invoice, credit note, receipt, purchase order):
 * the first print is the ORIGINAL, later ones are a DUPLICATE COPY with a
 * watermark. An admin can print the original again or allow one more original.
 */

export const PRINT_KINDS = {
  INVOICE: { path: 'invoices', label: 'Invoice', permission: 'invoices.print' },
  CREDIT_NOTE: { path: 'credit-notes', label: 'Credit note', permission: 'creditnotes.print' },
  RECEIPT: { path: 'payments', label: 'Receipt', permission: 'payments.print' },
  PURCHASE_ORDER: { path: 'purchase-orders', label: 'Purchase order', permission: 'purchases.print' },
};

const PRINTED_EVENT = 'document-printed';

/** An error body of a blob request is JSON text: read its message. */
const blobError = async (err) => {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const body = JSON.parse(await data.text());
      return body?.message || 'Could not open the PDF';
    } catch {
      /* not JSON */
    }
  }
  return apiError(err).message || 'Could not open the PDF';
};

/** Fetch a document PDF with the user's token and show it in a new tab. */
export const openDocumentPdf = async (path, params = {}) => {
  const win = window.open('', '_blank');
  try {
    const { data } = await api.get(path, { params, responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    if (win) win.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    window.dispatchEvent(new Event(PRINTED_EVENT));
  } catch (err) {
    if (win) win.close();
    toast.error(await blobError(err));
  }
};

/**
 * "Printed 2 times · next print: duplicate copy" under a document, with the
 * admin's "Print original" and "Allow one original".
 */
export function PrintStatus({ docType, id, draft }) {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const isAdmin = can('documents.print.original');
  const key = ['company', 'print-status', docType, String(id)];
  const { data, refetch } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.get(`/v1/print-control/status/${docType}/${id}`)).data?.data,
    enabled: Boolean(id) && !draft && can(PRINT_KINDS[docType]?.permission),
  });
  useEffect(() => {
    const onPrinted = () => setTimeout(() => refetch(), 800);
    window.addEventListener(PRINTED_EVENT, onPrinted);
    return () => window.removeEventListener(PRINTED_EVENT, onPrinted);
  }, [refetch]);
  const [granting, setGranting] = useState(false);
  const [note, setNote] = useState('');
  const grant = useMutation({
    mutationFn: async () => (await api.post(`/v1/print-control/${docType}/${id}/grant`, { note: note.trim() })).data,
    onSuccess: (res) => {
      toast.success(res?.message || 'One more original allowed');
      setGranting(false);
      setNote('');
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  if (draft || !data) return null;
  const kind = PRINT_KINDS[docType];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
      <Printer className="h-3.5 w-3.5 text-muted-foreground" />
      {data.printCount ? (
        <span>
          Printed {data.printCount} time{data.printCount === 1 ? '' : 's'}
          {data.lastPrintedAt ? ` · last ${formatDateTime(data.lastPrintedAt)}${data.lastPrintedBy ? ` by ${data.lastPrintedBy}` : ''}` : ''}
        </span>
      ) : (
        <span>Not printed yet</span>
      )}
      <span className={data.nextIsOriginal ? 'font-semibold text-success' : 'font-semibold text-warning'}>
        Next print: {data.nextIsOriginal ? 'ORIGINAL' : 'DUPLICATE COPY'}
      </span>
      {!data.nextIsOriginal && !isAdmin && <span className="text-muted-foreground">Need the original? Ask your admin.</span>}
      {isAdmin && data.printCount > 0 && (
        <span className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openDocumentPdf(`/v1/${kind.path}/${id}/pdf`, { original: 1 })}>
            <ShieldCheck className="h-3.5 w-3.5" /> Print original
          </Button>
          {!data.nextIsOriginal && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setGranting(true)}>
              Allow one original
            </Button>
          )}
        </span>
      )}
      {granting && (
        <Dialog
          open
          onClose={() => setGranting(false)}
          title="Allow one more original?"
          description={`The next print of this ${kind.label.toLowerCase()}, by anyone allowed to print, will be an ORIGINAL instead of a duplicate copy.`}
          footer={
            <>
              <Button variant="outline" onClick={() => setGranting(false)}>
                Cancel
              </Button>
              <Button onClick={() => grant.mutate()} loading={grant.isPending}>
                Allow
              </Button>
            </>
          }
        >
          <Field label="Reason (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. customer lost the original" />
          </Field>
        </Dialog>
      )}
    </div>
  );
}

export default PrintStatus;
