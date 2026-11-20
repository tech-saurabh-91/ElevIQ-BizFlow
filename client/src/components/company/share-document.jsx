import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Mail, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { apiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useCountries, findCountry } from '@/hooks/useLocations';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { formatDate, formatMoney } from '@/utils/format';

/**
 * Email and WhatsApp buttons for a sales document (order, invoice, receipt,
 * credit note).
 *
 * Email: the server sends the document's PDF as an attachment; when email is
 * not set up, "Open in mail app" drafts the same message in the user's own
 * mail app instead. WhatsApp opens a chat with the customer's number and a
 * short summary (WhatsApp links cannot carry a file: share the PDF from
 * "Print / PDF" if they need it).
 */

const KINDS = {
  invoice: { path: 'invoices', label: 'Invoice', no: 'invoiceNo', date: 'invoiceDate' },
  order: { path: 'orders', label: 'Order', no: 'orderNo', date: 'orderDate' },
  payment: { path: 'payments', label: 'Receipt', no: 'paymentNo', date: 'paymentDate' },
  creditNote: { path: 'credit-notes', label: 'Credit note', no: 'creditNoteNo', date: 'creditNoteDate' },
};

/** Customer phone as WhatsApp wants it: country code + number, digits only. */
export const whatsappNumber = (phone, dialCode = '') => {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') || raw.startsWith('00')) return digits.replace(/^00/, '');
  const code = String(dialCode || '').replace(/\D/g, '');
  digits = digits.replace(/^0+/, ''); // local trunk 0 (e.g. 0712... in Kenya)
  if (code && !digits.startsWith(code)) return code + digits;
  return digits;
};

const summaryOf = (kind, doc, company) => {
  const k = KINDS[kind];
  const money = (v) => formatMoney(v || 0, company?.currency);
  const no = doc[k.no] || '';
  const date = doc[k.date] ? formatDate(doc[k.date]) : '';
  const lines = [`Dear ${doc.customerName || 'customer'},`, ''];
  if (kind === 'invoice') {
    lines.push(`Invoice ${no} dated ${date} for ${money(doc.total)}.`);
    if (Number(doc.balanceDue) > 0) lines.push(`Balance due: ${money(doc.balanceDue)}${doc.dueDate ? ` by ${formatDate(doc.dueDate)}` : ''}.`);
  } else if (kind === 'order') {
    lines.push(`We have received your order ${no} dated ${date} for ${money(doc.total)}. Thank you.`);
  } else if (kind === 'payment') {
    lines.push(`Thank you for your payment of ${money(doc.amount)} on ${date}. Receipt no. ${no}.`);
  } else {
    lines.push(`Credit note ${no} dated ${date} for ${money(doc.total)} has been issued to your account.`);
  }
  lines.push('', 'Regards,', company?.name || '');
  return lines.join('\n');
};

function EmailDialog({ kind, doc, onClose }) {
  const k = KINDS[kind];
  const { company } = useAuth();
  const customerId = doc.customerId?.id || doc.customerId?._id || doc.customerId || doc.customer?.id;
  const { data: customer } = useQuery({
    queryKey: ['company', 'customers', 'detail', String(customerId)],
    queryFn: async () => (await api.get(`/v1/customers/${customerId}`)).data?.data,
    enabled: Boolean(customerId),
    retry: false,
  });
  const [to, setTo] = useState(null); // null = not edited yet: use the customer's email
  const [message, setMessage] = useState('');
  const address = to ?? (customer?.email || doc.customerId?.email || '');
  const list = address.split(/[,;\s]+/).filter(Boolean);
  const badEmail = list.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const toError = !list.length ? 'Enter an email address' : badEmail ? `"${badEmail}" is not a valid email` : list.length > 5 ? 'At most 5 addresses' : '';

  const send = useMutation({
    mutationFn: async () => (await api.post(`/v1/${k.path}/${doc.id}/email`, { to: list.join(','), message: message.trim() })).data,
    onSuccess: (res) => {
      toast.success(res?.message || 'Email sent');
      onClose();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const openMailApp = () => {
    const subject = `${k.label} ${doc[k.no] || ''} - ${company?.name || ''}`;
    const body = [summaryOf(kind, doc, company), message.trim()].filter(Boolean).join('\n\n');
    window.location.href = `mailto:${encodeURIComponent(list.join(','))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Email ${k.label.toLowerCase()} ${doc[k.no] || ''}`}
      description="The PDF is attached to the email."
      footer={
        <>
          <Button variant="outline" onClick={openMailApp} disabled={!!toError || send.isPending}>
            Open in mail app
          </Button>
          <Button onClick={() => send.mutate()} disabled={!!toError} loading={send.isPending}>
            <Mail className="h-4 w-4" /> Send with PDF
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="To" error={address && toError ? toError : undefined} hint="Separate more than one address with a comma (up to 5).">
          <Input type="text" inputMode="email" value={address} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" maxLength={400} />
        </Field>
        <Field label="Message (optional)">
          <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} placeholder="Added above your signature" />
        </Field>
      </div>
    </Dialog>
  );
}

export function ShareDocumentButtons({ kind, doc }) {
  const [emailing, setEmailing] = useState(false);
  const { company } = useAuth();
  const { data: countries = [] } = useCountries();
  if (!doc?.id) return null;

  const whatsapp = () => {
    const country = findCountry(countries, company?.country);
    // The customer master's current number, not the one copied onto the document.
    const master = doc.customerId && typeof doc.customerId === 'object' ? doc.customerId : {};
    const number = whatsappNumber(master.phone || doc.customerPhone, country?.phoneCode || (country ? '' : '+91'));
    const text = encodeURIComponent(summaryOf(kind, doc, company));
    // No number on the customer: WhatsApp asks who to send it to.
    window.open(number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <Button variant="outline" onClick={() => setEmailing(true)}>
        <Mail className="h-4 w-4" /> Email
      </Button>
      <Button variant="outline" onClick={whatsapp}>
        <MessageCircle className="h-4 w-4" /> WhatsApp
      </Button>
      {emailing && <EmailDialog kind={kind} doc={doc} onClose={() => setEmailing(false)} />}
    </>
  );
}

export default ShareDocumentButtons;
