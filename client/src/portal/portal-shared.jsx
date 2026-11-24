import { useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/utils/format';
import { usePortalStore } from './portalStore';

/** Words a shop owner understands, for each order status. */
export const ORDER_STATUS_TEXT = {
  REQUESTED: ['Waiting for confirmation', 'warning'],
  PENDING_APPROVAL: ['Being reviewed', 'warning'],
  CONFIRMED: ['Confirmed', 'success'],
  PARTIALLY_INVOICED: ['Partly billed', 'info'],
  FULLY_INVOICED: ['Billed', 'success'],
  DISPATCHED: ['On the way', 'info'],
  DELIVERED: ['Delivered', 'success'],
  CANCELLED: ['Cancelled', 'muted'],
  REJECTED: ['Not accepted', 'destructive'],
  EXPIRED: ['Expired', 'muted'],
  DRAFT: ['Draft', 'muted'],
};

export const OrderStatus = ({ status }) => {
  const [label, tone] = ORDER_STATUS_TEXT[status] || [status, 'muted'];
  return <Badge tone={tone}>{label}</Badge>;
};

const INVOICE_TEXT = {
  ISSUED: ['Unpaid', 'warning'],
  PARTIALLY_PAID: ['Part paid', 'info'],
  PAID: ['Paid', 'success'],
  OVERDUE: ['Overdue', 'destructive'],
  CANCELLED: ['Cancelled', 'muted'],
};
export const InvoiceStatus = ({ status }) => {
  const [label, tone] = INVOICE_TEXT[status] || [String(status || '').replace(/_/g, ' ').toLowerCase(), 'muted'];
  return <Badge tone={tone}>{label}</Badge>;
};

export const STOCK_TEXT = {
  IN_STOCK: ['In stock', 'success'],
  LOW: ['Few left', 'warning'],
  OUT: ['Out of stock', 'destructive'],
};

/** The company code from the URL (/portal/:code/...), upper-cased. */
export const usePortalCode = () => String(useParams().code || '').toUpperCase();

/** Money in the company's currency. */
export const useMoney = () => {
  const currency = usePortalStore((s) => s.session?.company?.currency || 'INR');
  return (value) => formatMoney(value, currency);
};

export const portalPath = (code, rest = '') => `/portal/${code}${rest ? `/${rest}` : ''}`;
