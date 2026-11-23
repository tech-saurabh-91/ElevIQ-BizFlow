import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, FileText, Mail, MessageCircle, Printer, RefreshCw } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useCountries, findCountry } from '@/hooks/useLocations';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { whatsappNumber } from '@/components/company/share-document';
import { formatDate, formatMoney } from '@/utils/format';
import { periodOptions } from '@/utils/periods';
import { cn } from '@/utils/cn';

/**
 * Statement of account of one customer or supplier: opening balance, every
 * invoice / receipt / credit note (bill / payment / return) of the period
 * with a running balance, and the closing balance. Print it (optionally as a
 * balance confirmation), download it to Excel, email it or send a WhatsApp
 * summary. Dr = due to us, Cr = due from us.
 */

const KIND = {
  customer: { label: 'Customer', list: '/app/customers', listLabel: 'Customers' },
  supplier: { label: 'Supplier', list: '/app/suppliers', listLabel: 'Suppliers' },
};

const sideOf = (kind, amount) => {
  if (Math.abs(amount) < 0.005) return '';
  const owedToUs = kind === 'customer' ? amount > 0 : amount < 0;
  return owedToUs ? 'Dr' : 'Cr';
};

function EmailDialog({ kind, ledger, period, confirm, onClose }) {
  const [to, setTo] = useState(ledger.party.email || '');
  const [message, setMessage] = useState('');
  const list = to.split(/[,;\s]+/).filter(Boolean);
  const bad = list.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const error = !list.length
    ? 'Enter an email address'
    : bad
      ? `"${bad}" is not a valid email`
      : list.length > 5
        ? 'At most 5 addresses'
        : '';
  const send = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/v1/ledgers/${kind}/${ledger.party.id}/email`, {
          to: list.join(','),
          message: message.trim(),
          from: period.from,
          periodTo: period.to,
          confirm,
        })
      ).data,
    onSuccess: (res) => {
      toast.success(res?.message || 'Statement emailed');
      onClose();
    },
    onError: (err) => toast.error(apiError(err).message),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Email ${confirm ? 'balance confirmation' : 'statement'} to ${ledger.party.name}`}
      description="The statement PDF is attached to the email."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button onClick={() => send.mutate()} disabled={Boolean(error)} loading={send.isPending}>
            <Mail className="h-4 w-4" /> Send
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="To"
          error={to && error ? error : undefined}
          hint="Separate more than one address with a comma (up to 5)."
        >
          <Input
            type="text"
            inputMode="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="accounts@shop.com"
            maxLength={400}
          />
        </Field>
        <Field label="Message (optional)">
          <Textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
          />
        </Field>
      </div>
    </Dialog>
  );
}

export default function PartyLedger() {
  const { kind = 'customer', id } = useParams();
  const meta = KIND[kind] || KIND.customer;
  const { company } = useAuth();
  const { data: countries = [] } = useCountries();
  const [params, setParams] = useSearchParams();
  const periods = useMemo(
    () => periodOptions(company?.financialYearStartMonth),
    [company?.financialYearStartMonth]
  );
  const thisFy = periods.find((p) => p.group === 'Financial year');
  const period = {
    from: params.get('from') || thisFy.range[0],
    to: params.get('to') || thisFy.range[1],
  };
  const chosen =
    periods.find((p) => p.range[0] === period.from && p.range[1] === period.to)?.value || 'custom';
  const [confirm, setConfirm] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [busy, setBusy] = useState('');
  const money = (v) => formatMoney(Math.abs(v || 0), company?.currency);
  const withSide = (v) => `${money(v)}${sideOf(kind, v) ? ` ${sideOf(kind, v)}` : ''}`;

  const setPeriod = (from, to) => {
    const next = new URLSearchParams(params);
    next.set('from', from);
    next.set('to', to);
    setParams(next, { replace: true });
  };

  const {
    data: ledger,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['company', 'ledger', kind, id, period.from, period.to],
    queryFn: async () => (await api.get(`/v1/ledgers/${kind}/${id}`, { params: period })).data.data,
    keepPreviousData: true,
    retry: false,
  });

  const download = async (what) => {
    setBusy(what);
    try {
      const path = what === 'excel' ? 'export' : 'pdf';
      const res = await api.get(`/v1/ledgers/${kind}/${id}/${path}`, {
        params: { ...period, ...(what === 'pdf' && confirm ? { confirm: 'true' } : {}) },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(
        new Blob([res.data], {
          type: what === 'excel' ? res.headers['content-type'] : 'application/pdf',
        })
      );
      if (what === 'pdf') {
        window.open(url, '_blank', 'noopener');
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `statement-${ledger?.party?.code || id}-${period.from}-to-${period.to}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      toast.error(apiError(err).message);
    } finally {
      setBusy('');
    }
  };

  const whatsapp = () => {
    if (!ledger) return;
    const country = findCountry(countries, company?.country);
    const number = whatsappNumber(ledger.party.phone, country?.phoneCode || (country ? '' : '+91'));
    const lines = [
      `Dear ${ledger.party.name},`,
      '',
      `Your account with ${company?.name || 'us'} for ${formatDate(period.from)} to ${formatDate(period.to)}:`,
      `Opening balance: ${withSide(ledger.opening)}`,
      `${kind === 'customer' ? 'Invoices' : 'Bills'}: ${money(kind === 'customer' ? ledger.totals.debit : ledger.totals.credit)}`,
      `${kind === 'customer' ? 'Payments and credits' : 'Payments and returns'}: ${money(kind === 'customer' ? ledger.totals.credit : ledger.totals.debit)}`,
      `Closing balance: ${withSide(ledger.closing)}`,
      ...(confirm
        ? ['', 'Please confirm this balance, or send us your statement if it does not agree.']
        : []),
      '',
      'Regards,',
      company?.name || '',
    ];
    const text = encodeURIComponent(lines.join('\n'));
    window.open(
      number ? `https://wa.me/${number}?text=${text}` : `https://wa.me/?text=${text}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  const rows = ledger?.rows || [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={ledger ? `Statement - ${ledger.party.name}` : 'Statement of account'}
        description={
          ledger
            ? [ledger.party.code, ledger.party.phone].filter(Boolean).join(' · ')
            : `${meta.label} ledger with a running balance`
        }
        breadcrumbs={[{ label: meta.listLabel, to: meta.list }, { label: 'Statement' }]}
        actions={
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <Field label="Period" className="w-full sm:w-56">
            <Select
              value={chosen}
              onChange={(e) => {
                const p = periods.find((x) => x.value === e.target.value);
                if (p) setPeriod(p.range[0], p.range[1]);
              }}
            >
              {periods.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom dates</option>
            </Select>
          </Field>
          <Field label="From" className="w-[calc(50%-6px)] sm:w-40">
            <Input
              type="date"
              value={period.from}
              max={period.to}
              onChange={(e) => e.target.value && setPeriod(e.target.value, period.to)}
            />
          </Field>
          <Field label="To" className="w-[calc(50%-6px)] sm:w-40">
            <Input
              type="date"
              value={period.to}
              min={period.from}
              onChange={(e) => e.target.value && setPeriod(period.from, e.target.value)}
            />
          </Field>
          <label
            className="flex items-center gap-2 pb-2 text-sm"
            title="Adds a request to confirm the balance, and a place for the party's signature"
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            Balance confirmation
          </label>
          <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
            <Button
              variant="outline"
              onClick={() => download('pdf')}
              loading={busy === 'pdf'}
              disabled={!ledger}
            >
              <Printer className="h-4 w-4" /> PDF
            </Button>
            <Button
              variant="outline"
              onClick={() => download('excel')}
              loading={busy === 'excel'}
              disabled={!ledger}
            >
              <Download className="h-4 w-4" /> Excel
            </Button>
            <Button variant="outline" onClick={() => setEmailing(true)} disabled={!ledger}>
              <Mail className="h-4 w-4" /> Email
            </Button>
            <Button variant="outline" onClick={whatsapp} disabled={!ledger}>
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </Button>
          </div>
        </CardContent>
      </Card>

      {ledger && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Opening', withSide(ledger.opening)],
            [
              kind === 'customer' ? 'Debit (invoices)' : 'Debit (payments, returns)',
              money(ledger.totals.debit),
            ],
            [
              kind === 'customer' ? 'Credit (receipts, credit notes)' : 'Credit (bills)',
              money(ledger.totals.credit),
            ],
            ['Closing', withSide(ledger.closing)],
          ].map(([label, value], i) => (
            <div
              key={label}
              className={cn(
                'rounded-xl border bg-card p-3 shadow-sm',
                i === 3 && 'border-brand-500/40 bg-brand-500/5'
              )}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      )}
      {ledger?.advance > 0 && (
        <p className="text-xs text-muted-foreground">
          <FileText className="mr-1 inline h-3.5 w-3.5" />
          {money(ledger.advance)} was received as an advance (not set against any invoice). It is
          not in the balance and will be adjusted against the next invoices.
        </p>
      )}

      <Card className={cn('transition-opacity', isFetching && 'opacity-70')}>
        {isError ? (
          <EmptyState
            icon="error"
            title="Could not load the statement"
            description={apiError(error).message}
          />
        ) : isLoading || !ledger ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <Table cards className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Doc No.</TableHead>
                <TableHead>Particulars</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/50">
                <TableCell data-label="Date">{formatDate(period.from)}</TableCell>
                <TableCell data-label="Type" className="font-medium">
                  Opening balance
                </TableCell>
                <TableCell data-label="Doc No." />
                <TableCell data-label="Particulars" />
                <TableCell data-label="Debit" />
                <TableCell data-label="Credit" />
                <TableCell data-label="Balance" className="text-right font-medium tabular-nums">
                  {withSide(ledger.opening)}
                </TableCell>
              </TableRow>
              {rows.map((r, i) => (
                <TableRow key={`${r.id || 'row'}-${i}`}>
                  <TableCell data-label="Date" className="whitespace-nowrap">
                    {formatDate(r.date)}
                  </TableCell>
                  <TableCell data-label="Type">{r.type}</TableCell>
                  <TableCell data-label="Doc No." className="font-mono text-xs">
                    {r.no || '—'}
                  </TableCell>
                  <TableCell data-label="Particulars" className="text-muted-foreground">
                    {r.narration || '—'}
                  </TableCell>
                  <TableCell data-label="Debit" className="text-right tabular-nums">
                    {r.debit ? money(r.debit) : ''}
                  </TableCell>
                  <TableCell data-label="Credit" className="text-right tabular-nums">
                    {r.credit ? money(r.credit) : ''}
                  </TableCell>
                  <TableCell data-label="Balance" className="text-right font-medium tabular-nums">
                    {withSide(r.balance)}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                    No documents in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-semibold">
                  Closing balance ({rows.length} entr{rows.length === 1 ? 'y' : 'ies'})
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {money(ledger.totals.debit)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {money(ledger.totals.credit)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {withSide(ledger.closing)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">
        Dr = due to us, Cr = due from us. Cancelled and draft documents are not included.
      </p>

      {emailing && ledger && (
        <EmailDialog
          kind={kind}
          ledger={ledger}
          period={period}
          confirm={confirm}
          onClose={() => setEmailing(false)}
        />
      )}
    </div>
  );
}
