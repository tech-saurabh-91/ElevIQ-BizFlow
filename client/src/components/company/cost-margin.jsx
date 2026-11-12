import { AlertTriangle, TrendingUp, Wand2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { cn } from '@/utils/cn';

/**
 * The company's pricing defaults and modules. `purchase` is off for a
 * company on a plan without the Purchase module (set by the platform).
 */
export const useInventoryMode = () => {
  const inv = useAuthStore((s) => s.settings?.inventory);
  const flags = useAuthStore((s) => s.company?.featureFlags);
  return {
    purchase: flags?.purchase !== false,
    markup: Number(inv?.defaultMarkupPercent || 0),
  };
};

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Margin is on the selling price, markup is on the cost. */
export const marginOf = (price, cost) => (price > 0 && cost > 0 ? round2(((price - cost) / price) * 100) : null);
export const markupOf = (price, cost) => (price > 0 && cost > 0 ? round2(((price - cost) / cost) * 100) : null);
export const suggestFrom = (cost, markup, mrp) => {
  if (!(cost > 0) || !(markup > 0)) return 0;
  const price = round2(cost * (1 + markup / 100));
  return mrp > 0 ? Math.min(price, mrp) : price;
};

/**
 * Live cost / margin read-out under a product's prices: what a unit costs,
 * the margin and markup the selling price gives, a warning when it is below
 * cost or thin, and the price the company's default markup suggests.
 */
export function CostMargin({ cost, lastPurchase, price, dealerPrice, mrp, markup, money, onUseSuggested, costLabel = 'Avg cost', className }) {
  const margin = marginOf(price, cost);
  const markupNow = markupOf(price, cost);
  const dealerMargin = marginOf(dealerPrice, cost);
  const suggested = suggestFrom(cost, markup, mrp);
  const below = price > 0 && cost > 0 && price < cost;
  const thin = !below && margin != null && margin < 5;

  return (
    <div className={cn('rounded-xl border bg-muted/30 p-3 text-sm', className)}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <span>
          <span className="text-muted-foreground">{costLabel} </span>
          <span className="font-semibold tabular-nums">{cost > 0 ? money(cost) : '—'}</span>
        </span>
        {lastPurchase > 0 && lastPurchase !== cost && (
          <span>
            <span className="text-muted-foreground">Last purchase </span>
            <span className="font-medium tabular-nums">{money(lastPurchase)}</span>
          </span>
        )}
        {margin != null && (
          <span className={cn('inline-flex items-center gap-1 font-semibold tabular-nums', below ? 'text-destructive' : thin ? 'text-warning' : 'text-success')}>
            <TrendingUp className="h-3.5 w-3.5" />
            Margin {margin}% · Markup {markupNow}%
          </span>
        )}
        {dealerMargin != null && (
          <span className="text-muted-foreground tabular-nums">Dealer margin {dealerMargin}%</span>
        )}
      </div>

      {below && (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Selling price is below cost - every sale loses {money(cost - price)} per unit.
        </p>
      )}
      {thin && (
        <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Thin margin - under 5% leaves little room for discounts and schemes.
        </p>
      )}
      {cost > 0 && !markup && (
        <p className="mt-2 text-xs text-muted-foreground">
          Set a default markup in Settings → Operations to get a suggested selling price.
        </p>
      )}
      {suggested > 0 && Math.abs(suggested - price) >= 0.01 && onUseSuggested && (
        <button
          type="button"
          onClick={() => onUseSuggested(suggested)}
          className="mt-2 inline-flex items-center gap-1 rounded-md text-xs font-medium text-primary hover:underline focus-ring"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Use suggested {money(suggested)} (cost + {markup}%{mrp > 0 && suggested === mrp ? ', capped at MRP' : ''})
        </button>
      )}
    </div>
  );
}

export default CostMargin;
