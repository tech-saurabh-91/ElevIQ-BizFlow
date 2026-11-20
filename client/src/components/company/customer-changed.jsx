import { Info } from 'lucide-react';

/**
 * Issued documents keep the customer's name, tax ID and address as they were
 * on the day (the legal copy). When the customer master has changed since,
 * say so, so nobody wonders why the document and the master differ.
 * Phone and email are always shown from the master, so they are not compared.
 */
const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const addressKey = (a = {}) => [a.line1, a.city, a.pincode || a.postalCode].map(norm).join('|');

export function CustomerChangedNote({ doc, customer, draft, taxIdLabel = 'Tax ID' }) {
  if (draft || !doc || !customer?.id) return null;
  const changed = [];
  if (customer.name && norm(customer.name) !== norm(doc.customerName)) changed.push('name');
  if (customer.gstin && norm(customer.gstin) !== norm(doc.customerGstin)) changed.push(taxIdLabel);
  const docAddress = addressKey(doc.billingAddress);
  if (customer.address?.line1 && docAddress.replace(/\|/g, '') && addressKey(customer.address) !== docAddress) changed.push('address');
  if (!changed.length) return null;
  const list = changed.length > 1 ? `${changed.slice(0, -1).join(', ')} and ${changed.at(-1)}` : changed[0];
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning-foreground dark:text-warning">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        The customer&apos;s {list} changed in the master after this document. It keeps the details of its date; new documents use the new
        details.
      </span>
    </p>
  );
}

export default CustomerChangedNote;
