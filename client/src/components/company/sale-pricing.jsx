import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Gift, Percent } from 'lucide-react';

import api from '@/api/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNumber } from '@/utils/format';

/**
 * Live pricing from the server while an order / direct invoice is keyed in:
 * price list, discount rules, schemes and the free goods they give - the
 * same engine that prices the document on save.
 *
 * Rows hold `manualPrice` / `manualDiscount` ('1' when the user typed the
 * value). Only those values are sent; everything else is the server's.
 */

const sameLine = (row, sent) =>
  sent && String(row.product) === String(sent.product) && Number(row.qty) === Number(sent.qty) && (row.unit || '') === (sent.unit || '');

/** The item a row sends for pricing (and saving): typed values only. */
export const pricingInput = (row, canOverride) => ({
  product: row.product,
  qty: Number(row.qty),
  unit: row.unit || undefined,
  unitPrice: canOverride && row.manualPrice === '1' && row.unitPrice !== '' ? Number(row.unitPrice) : undefined,
  discountPercent: canOverride && row.manualDiscount === '1' && row.discountPercent !== '' ? Number(row.discountPercent) : undefined,
});

export function useSalePricing({ customerId, date, rows, canOverride, enabled = true }) {
  // Rows that can be priced, with where they sit in the form.
  const sent = useMemo(
    () =>
      (rows || [])
        .map((row, rowIndex) => ({ row, rowIndex }))
        .filter(({ row }) => row.product && Number(row.qty) > 0)
        .map(({ row, rowIndex }) => ({ rowIndex, ...pricingInput(row, canOverride) })),
    [rows, canOverride]
  );
  const key = JSON.stringify({ customerId, date, items: sent.map(({ rowIndex: _r, ...i }) => i) });
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(key), 350);
    return () => clearTimeout(t);
  }, [key]);

  const query = useQuery({
    queryKey: ['company', 'pricing-preview', debounced],
    queryFn: async () => {
      const body = JSON.parse(debounced);
      return (await api.post('/v1/pricing/preview', body)).data?.data ?? null;
    },
    enabled: enabled && Boolean(customerId),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  // Paid lines come back in the order sent; match them to form rows.
  const result = useMemo(() => {
    const data = query.data;
    const byRow = new Map();
    if (!data) return { byRow, freeLines: [], offers: [], applied: [] };
    const sentNow = JSON.parse(debounced).items;
    const paid = (data.lines || []).filter((l) => !l.isFree);
    paid.forEach((line, i) => {
      const s = sent[i];
      if (s && sameLine(rows[s.rowIndex] || {}, sentNow[i])) byRow.set(s.rowIndex, line);
    });
    return {
      byRow,
      freeLines: (data.lines || []).filter((l) => l.isFree),
      offers: data.offers || [],
      applied: data.applied || [],
    };
  }, [query.data, debounced, sent, rows]);

  return { ...result, isFetching: query.isFetching, isError: query.isError, fresh: debounced === key && !query.isFetching };
}

/**
 * Rows for the local summary: each priced row takes the server's price and
 * total discount (trade + scheme), so the summary matches what saving gives.
 */
export const effectiveRows = (rows, byRow) =>
  (rows || []).map((row, i) => {
    const line = byRow.get(i);
    return line ? { ...row, unitPrice: String(line.unitPrice), discountPercent: String(line.discountPercent) } : row;
  });

/** Small notes under a priced line: the discount rule and scheme it got. */
export function LinePricingNote({ line }) {
  if (!line) return null;
  const parts = [];
  if (line.discountRuleName) parts.push(`${line.discountRuleName} ${line.tradeDiscountPercent}%`);
  if (line.schemeName && line.schemeDiscountPercent) parts.push(`Scheme ${line.schemeName} +${line.schemeDiscountPercent}%`);
  if (!parts.length) return null;
  return <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">{parts.join(' · ')}</p>;
}

/** Free goods the schemes give, under the product lines. */
export function FreeGoodsRows({ lines, colSpan = 6 }) {
  if (!lines?.length) return null;
  return lines.map((l, i) => (
    <tr key={`free-${i}`} className="mb-3 block rounded-lg border bg-emerald-500/5 sm:mb-0 sm:table-row sm:rounded-none sm:border-x-0 sm:border-t-0 sm:last:border-0">
      <td className="block p-3 sm:table-cell sm:px-0 sm:py-2 sm:pr-2" colSpan={colSpan}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Gift className="h-4 w-4 text-emerald-600" />
          <span className="font-medium">{l.name}</span>
          <span className="tabular-nums">
            {formatNumber(l.qty)} {l.unit}
          </span>
          <Badge tone="success">Free</Badge>
          <span className="text-xs text-muted-foreground">
            {l.schemeName}
            {l.freeWith ? ` · with ${l.freeWith}` : ''}
          </span>
        </div>
      </td>
    </tr>
  ));
}

/** Schemes running for this customer; the ones on this bill are marked. */
export function OffersCard({ offers, applied }) {
  if (!offers?.length && !applied?.length) return null;
  const used = new Set((applied || []).map((a) => a.id));
  const rules = (applied || []).filter((a) => a.kind === 'DISCOUNT');
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4" /> Schemes & discounts
        </CardTitle>
        <CardDescription>Applied automatically when the quantities qualify.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {(offers || []).map((o) => (
          <div key={o.id} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{o.name}</p>
              <p className="text-xs text-muted-foreground">{o.summary}</p>
            </div>
            {used.has(o.id) ? <Badge tone="success">Applied</Badge> : <Badge tone="muted">Not yet</Badge>}
          </div>
        ))}
        {rules.map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1 font-medium">
                <Percent className="h-3 w-3" /> {r.name}
              </p>
              <p className="text-xs text-muted-foreground">{r.summary}</p>
            </div>
            <Badge tone="success">Applied</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** On a saved order / invoice line: free goods badge, or the discount it got. */
export function SavedLineTag({ item }) {
  if (item?.isFree) {
    return (
      <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        Free{item.schemeName ? ` · ${item.schemeName}` : ''}
      </span>
    );
  }
  return <LinePricingNote line={item} />;
}

/**
 * Saved order / invoice / credit note lines on phones: one compact row per
 * product instead of the wide table (which shows from `sm` up).
 * `extra(item)` can return a short prefix for the sub line (e.g. order no).
 */
export function LineItemsPhone({ items = [], money, showTag = true, extra }) {
  return (
    <ul className="divide-y border-t sm:hidden">
      {items.map((item, index) => {
        const disc = Number(item.discountPercent) > 0 ? `${item.discountPercent}% off` : '';
        return (
          <li key={item.id || index} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">
                  {item.name || '—'}
                  {showTag && item.isFree && <SavedLineTag item={item} />}
                </p>
                <p className="text-xs text-muted-foreground">
                  {extra?.(item) || ''}
                  {item.sku || '—'}
                  {item.unit ? ` · ${item.unit}` : ''}
                  {item.hsnCode ? ` · HSN ${item.hsnCode}` : ''}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums">{money(item.lineTotal)}</p>
            </div>
            <p className="mt-1 text-xs tabular-nums text-muted-foreground">
              {formatNumber(item.qty)} × {money(item.unitPrice)}
              {disc && ` · ${disc}`}
              {item.taxRate != null && ` · Tax ${item.taxRate}%`}
              {Number(item.freeQty) > 0 && <span className="text-success"> · +{item.freeQty} free</span>}
            </p>
            {showTag && !item.isFree && <SavedLineTag item={item} />}
            {item.note && <p className="mt-1 text-xs italic text-muted-foreground">{item.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
