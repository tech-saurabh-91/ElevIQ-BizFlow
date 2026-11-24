import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Copy, KeyRound, MessageCircle } from 'lucide-react';
import api, { apiError } from '@/api/client';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle, ErrorAlert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/ui/misc';
import { formatDateTime } from '@/utils/format';

/**
 * Staff: turn online ordering on/off for one customer, set the mobile it signs
 * in with, and hand over a PIN (shown once; the customer then sets their own).
 */
export default function PortalAccessDialog({ customer, open, onClose }) {
  const queryClient = useQueryClient();
  const key = ['company', 'customer', customer?.id, 'portal-access'];
  const [enabled, setEnabled] = useState(false);
  const [mobile, setMobile] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [pin, setPin] = useState(null);

  const query = useQuery({
    queryKey: key,
    enabled: open && Boolean(customer?.id),
    queryFn: async () => (await api.get(`/v1/customers/${customer.id}/portal-access`)).data.data,
  });
  const info = query.data;

  useEffect(() => {
    if (!open) return;
    setPin(null);
  }, [open]);
  useEffect(() => {
    if (!info) return;
    setEnabled(info.hasAccount ? info.enabled : true);
    setMobile(info.mobile || info.suggestedMobile || '');
    setTrusted(Boolean(info.autoConfirm));
  }, [info]);

  const done = (payload) => {
    queryClient.setQueryData(key, payload.data);
    if (payload.data.pin) setPin(payload.data.pin);
    toast.success(payload.message);
  };
  const save = useMutation({
    mutationFn: async () => (await api.put(`/v1/customers/${customer.id}/portal-access`, { enabled, mobile, autoConfirm: trusted })).data,
    onSuccess: done,
  });
  const reset = useMutation({
    mutationFn: async () => (await api.post(`/v1/customers/${customer.id}/portal-access/reset-pin`)).data,
    onSuccess: done,
  });

  const link = info ? `${window.location.origin}${info.link}` : '';
  const shareText = pin
    ? `Order from us online: ${link}\nMobile: ${mobile}\nPIN: ${pin}\n(You will set your own PIN when you first sign in.)`
    : `Order from us online: ${link}`;
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy. Select the text and copy it.');
    }
  };
  const whatsappNumber = String(mobile || '').replace(/\D/g, '');
  const waTo = whatsappNumber.length === 10 ? `91${whatsappNumber}` : whatsappNumber;

  const error = save.error || reset.error;
  const busy = save.isPending || reset.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="md"
      title="Online ordering"
      description={customer ? `${customer.name}${customer.code ? ` · ${customer.code}` : ''}` : ''}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!info || busy}>
            Save
          </Button>
        </>
      }
    >
      {query.isError ? (
        <ErrorAlert message={apiError(query.error).message} />
      ) : !info ? (
        <LoadingState />
      ) : (
        <div className="space-y-4">
          {!info.portalOn && (
            <Alert tone="warning">
              <AlertDescription>
                Online ordering is switched off for the company. Customers can sign in once it is switched on in
                Settings → Operations → Customer portal.
              </AlertDescription>
            </Alert>
          )}

          <Checkbox
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            label="This customer can order online"
            description="They sign in on your company link with their mobile and a PIN, and see only their own orders, invoices and statement."
          />
          <Field label="Mobile number they sign in with" hint="One mobile can sign in for one customer.">
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" disabled={!enabled} />
          </Field>

          <Checkbox
            checked={trusted}
            onChange={(e) => setTrusted(e.target.checked)}
            disabled={!enabled}
            label="Trusted: confirm their orders automatically"
            description={
              info.autoConfirmOn
                ? 'Confirmed at once when stock is free, their credit limit is not crossed and the order is below the approval limit.'
                : 'Takes effect once "Confirm orders from trusted customers automatically" is on in Settings.'
            }
          />

          {info.hasAccount && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge tone={info.enabled ? 'success' : 'muted'}>{info.enabled ? 'On' : 'Off'}</Badge>
              {info.locked && <Badge tone="destructive">Locked (wrong PINs)</Badge>}
              {info.mustChangePin && <Badge tone="warning">Has not set own PIN yet</Badge>}
              <span>{info.lastLoginAt ? `Last signed in ${formatDateTime(info.lastLoginAt)}` : 'Never signed in'}</span>
            </div>
          )}

          {pin && (
            <Alert tone="success" icon={KeyRound}>
              <AlertTitle>PIN for {customer?.name}: {pin}</AlertTitle>
              <AlertDescription>
                Shown only now. Share it with the customer; they will choose their own PIN when they first sign in.
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => copy(shareText)}>
                    <Copy className="h-4 w-4" /> Copy link and PIN
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => window.open(`https://wa.me/${waTo}?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener')}>
                    <MessageCircle className="h-4 w-4" /> Send on WhatsApp
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {info.hasAccount && info.enabled && !pin && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => copy(link)}>
                <Copy className="h-4 w-4" /> Copy ordering link
              </Button>
              <Button size="sm" variant="outline" onClick={() => reset.mutate()} loading={reset.isPending}>
                <KeyRound className="h-4 w-4" /> New PIN
              </Button>
            </div>
          )}

          {error && <ErrorAlert message={apiError(error).message} />}
        </div>
      )}
    </Dialog>
  );
}
