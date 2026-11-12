import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ReceiptIndianRupee, Wallet } from 'lucide-react';
import api from '@/api/client';
import { StatCard, STAT_GRID } from '@/components/company/stat-card';
import { Field, Select } from '@/components/ui/input';
import { useLookups } from '@/hooks/useLookups';
import { formatMoney } from '@/utils/format';

/** Shared bits of the supplier bills / payments / returns screens. */

export const PAYABLES_KEY = ['company', 'payables'];

export const usePayablesSummary = (enabled = true) =>
  useQuery({
    queryKey: [...PAYABLES_KEY, 'summary'],
    queryFn: async () => (await api.get('/v1/purchase-bills/summary')).data?.data || {},
    enabled,
  });

/** Payable / overdue / billed / paid this month. */
export function PayablesStats({ currency }) {
  const { data = {}, isLoading } = usePayablesSummary();
  const money = (v) => formatMoney(v || 0, currency);
  return (
    <div className={STAT_GRID}>
      <StatCard label="We owe suppliers" value={money(data.payable)} hint={`${data.openBills || 0} open bill(s)`} icon={Wallet} loading={isLoading} />
      <StatCard
        label="Overdue"
        value={money(data.overdueAmount)}
        hint={`${data.overdueBills || 0} bill(s) past due`}
        icon={AlertTriangle}
        tone={data.overdueBills ? 'destructive' : 'muted'}
        loading={isLoading}
      />
      <StatCard label="Billed this month" value={money(data.billedThisMonth)} hint={`Input tax ${money(data.inputTaxThisMonth)}`} icon={ReceiptIndianRupee} tone="info" loading={isLoading} />
      <StatCard label="Paid this month" value={money(data.paidThisMonth)} icon={CalendarClock} tone="success" loading={isLoading} />
    </div>
  );
}

export function SupplierSelect({ value, onChange, label = 'Supplier', required = true, error }) {
  const { lookups } = useLookups();
  return (
    <Field label={label} required={required} error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Supplier">
        <option value="">Select a supplier…</option>
        {(lookups.suppliers || []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.code ? ` (${s.code})` : ''}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Two-decimal number from a text box ('' -> 0). */
export const amountOf = (v) => Math.round((Number(v) || 0) * 100) / 100;
export const onlyDecimal = (v) => String(v).replace(/[^\d.]/g, '');
