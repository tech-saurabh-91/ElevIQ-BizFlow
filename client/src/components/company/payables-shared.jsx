import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ReceiptIndianRupee, Wallet } from 'lucide-react';
import api from '@/api/client';
import { StatCard, STAT_GRID } from '@/components/company/stat-card';
import { Field, Select } from '@/components/ui/input';
import { SearchSelect, partyOptions } from '@/components/ui/search-select';
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
  const { data = {}, isLoading, isError } = usePayablesSummary();
  const failed = isError && !Object.keys(data).length;
  const money = (v) => formatMoney(v || 0, currency);
  return (
    <div className={STAT_GRID}>
      <StatCard label="We owe suppliers" value={money(data.payable)} hint={`${data.openBills || 0} open bill(s)`} icon={Wallet} loading={isLoading} unavailable={failed} />
      <StatCard
        label="Overdue"
        value={money(data.overdueAmount)}
        hint={`${data.overdueBills || 0} bill(s) past due`}
        icon={AlertTriangle}
        tone={data.overdueBills ? 'destructive' : 'muted'}
        loading={isLoading} unavailable={failed}
      />
      <StatCard label="Billed this month" value={money(data.billedThisMonth)} hint={`Input tax ${money(data.inputTaxThisMonth)}`} icon={ReceiptIndianRupee} tone="info" loading={isLoading} unavailable={failed} />
      <StatCard label="Paid this month" value={money(data.paidThisMonth)} icon={CalendarClock} tone="success" loading={isLoading} unavailable={failed} />
    </div>
  );
}

export function SupplierSelect({ value, onChange, label = 'Supplier', required = true, error }) {
  const { lookups } = useLookups();
  return (
    <Field label={label} required={required} error={error}>
      <SearchSelect
        value={value}
        onChange={onChange}
        options={partyOptions(lookups.suppliers || [])}
        placeholder="Type supplier name or code…"
        error={!!error}
        aria-label="Supplier"
      />
    </Field>
  );
}

/** Two-decimal number from a text box ('' -> 0). */
export const amountOf = (v) => Math.round((Number(v) || 0) * 100) / 100;
export const onlyDecimal = (v) => String(v).replace(/[^\d.]/g, '');
