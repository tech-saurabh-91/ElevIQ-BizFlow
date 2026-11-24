import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Minus, Plus, Search, ShoppingCart, Tag, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertDescription, ErrorAlert } from '@/components/ui/alert';
import { apiError } from '@/api/client';
import { cn } from '@/utils/cn';
import portalApi from './portalApi';
import { cartActions, usePortalStore } from './portalStore';
import { STOCK_TEXT, portalPath, useMoney, usePortalCode } from './portal-shared';

// One shared empty cart: a new [] on every read would re-render forever.
const NO_ITEMS = [];

/** − qty + stepper. */
function QtyStepper({ value, onChange, disabled }) {
  const n = Number(value || 0);
  return (
    <div className="inline-flex items-center rounded-lg border bg-background">
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center disabled:opacity-40"
        onClick={() => onChange(Math.max(0, n - 1))}
        disabled={disabled || n <= 0}
        aria-label="Less"
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        value={n || ''}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))}
        inputMode="numeric"
        className="h-9 w-12 border-x bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
        placeholder="0"
        aria-label="Quantity"
        disabled={disabled}
      />
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center disabled:opacity-40"
        onClick={() => onChange(n + 1)}
        disabled={disabled}
        aria-label="More"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function ProductCard({ product, code, inCart }) {
  const money = useMoney();
  const [unit, setUnit] = useState(product.units[0]?.unit || product.unit);
  const line = inCart.find((l) => l.product === product.id && l.unit === unit);
  const chosen = product.units.find((u) => u.unit === unit) || product.units[0];
  const out = product.stock === 'OUT';
  const stock = product.stock ? STOCK_TEXT[product.stock] : null;

  const setQty = (qty) =>
    cartActions(code).setQty(
      { product: product.id, name: product.name, unit, price: chosen?.price || 0, image: product.image, code: product.code },
      qty
    );

  return (
    <Card className={cn('overflow-hidden', line && 'border-primary/50')}>
      <CardContent className="flex gap-3 p-3">
        {product.image ? (
          <img src={product.image} alt="" className="h-16 w-16 shrink-0 rounded-md bg-muted object-contain" loading="lazy" />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">
            {product.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div>
            <p className="font-medium leading-tight">{product.name}</p>
            <p className="text-xs text-muted-foreground">
              {[product.code, product.brand].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-bold tabular-nums">{money(chosen?.price)}</span>
            <span className="text-xs text-muted-foreground">/ {unit}</span>
            {product.mrp > 0 && chosen?.base && product.mrp > chosen.price && (
              <span className="text-xs text-muted-foreground line-through">MRP {money(product.mrp)}</span>
            )}
          </div>
          {(product.offers.length > 0 || stock) && (
            <div className="flex flex-wrap gap-1">
              {stock && <Badge tone={stock[1]}>{stock[0]}</Badge>}
              {product.offers.slice(0, 2).map((o) => (
                <Badge key={o.id} tone="info" title={o.name}>
                  <Tag className="mr-1 inline h-3 w-3" />
                  {o.summary}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {product.units.length > 1 && (
              <Select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-9 w-auto min-w-[5rem]" aria-label="Unit">
                {product.units.map((u) => (
                  <option key={u.unit} value={u.unit}>
                    {u.unit}
                    {u.factor > 1 ? ` (${u.factor})` : ''}
                  </option>
                ))}
              </Select>
            )}
            {line ? (
              <QtyStepper value={line.qty} onChange={setQty} />
            ) : (
              <Button size="sm" variant="outline" onClick={() => setQty(1)} disabled={out}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Products at the customer's own prices. */
export function PortalCatalog() {
  const code = usePortalCode();
  const cart = usePortalStore((s) => s.carts[code] || NO_ITEMS);
  const money = useMoney();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearch(draft.trim()), 350);
    return () => clearTimeout(t);
  }, [draft]);

  const query = useInfiniteQuery({
    queryKey: ['portal', 'catalog', code, search, category],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      (await portalApi.get('/catalog', { params: { search, category, page: pageParam, limit: 30 } })).data,
    getNextPageParam: (last) => (last.meta.page < last.meta.pages ? last.meta.page + 1 : undefined),
  });
  const products = query.data?.pages.flatMap((p) => p.data) || [];
  const [categories, setCategories] = useState([]);
  useEffect(() => {
    const first = query.data?.pages?.[0]?.meta?.categories;
    if (first && !search && !category) setCategories(first);
  }, [query.data, search, category]);

  const cartTotal = cart.reduce((s, l) => s + Number(l.qty) * Number(l.price || 0), 0);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search products, brand or code"
          className="pl-9 pr-9"
          aria-label="Search products"
        />
        {draft && (
          <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1" onClick={() => setDraft('')} aria-label="Clear">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {categories.length > 1 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {['', ...categories].map((c) => (
            <button
              key={c || 'all'}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-sm',
                category === c ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
              )}
            >
              {c || 'All'}
            </button>
          ))}
        </div>
      )}

      {query.isLoading ? (
        Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
      ) : query.isError ? (
        <ErrorAlert message={apiError(query.error).message} />
      ) : products.length === 0 ? (
        <EmptyState icon="search" title="No products found" description="Try another word or category." compact />
      ) : (
        <>
          {products.map((p) => (
            <ProductCard key={p.id} product={p} code={code} inCart={cart} />
          ))}
          {query.hasNextPage && (
            <Button variant="outline" className="w-full" onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
              Show more
            </Button>
          )}
        </>
      )}

      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 px-4">
          <Link
            to={portalPath(code, 'cart')}
            className="mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground shadow-lg"
          >
            <span className="flex items-center gap-2 font-medium">
              <ShoppingCart className="h-5 w-5" /> {cart.length} item{cart.length === 1 ? '' : 's'} · about {money(cartTotal)}
            </span>
            <span className="shrink-0 font-semibold">View cart →</span>
          </Link>
        </div>
      )}
    </div>
  );
}

/** Cart: priced by the server, then sent as an order request. */
export function PortalCart() {
  const code = usePortalCode();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const money = useMoney();
  const cart = usePortalStore((s) => s.carts[code] || NO_ITEMS);
  const [note, setNote] = useState('');
  const items = useMemo(() => cart.map((l) => ({ product: l.product, unit: l.unit, qty: Number(l.qty) })), [cart]);

  const preview = useQuery({
    queryKey: ['portal', 'preview', code, items],
    enabled: items.length > 0,
    queryFn: async () => (await portalApi.post('/orders/preview', { items })).data.data,
    retry: false,
  });

  const place = useMutation({
    mutationFn: async () => (await portalApi.post('/orders', { items, note })).data,
    onSuccess: (payload) => {
      cartActions(code).clear();
      queryClient.invalidateQueries({ queryKey: ['portal'] });
      toast.success('Order sent. You will see here when it is confirmed.');
      navigate(portalPath(code, `orders/${payload.data.id}`), { replace: true });
    },
  });

  if (!cart.length) {
    return (
      <EmptyState
        icon="package"
        title="Your cart is empty"
        description="Add products to place an order."
        action={
          <Button onClick={() => navigate(portalPath(code, 'catalog'))}>
            <Plus className="h-4 w-4" /> Add products
          </Button>
        }
      />
    );
  }

  const data = preview.data;
  const freeLines = (data?.items || []).filter((l) => l.isFree);
  const priceOf = (l) => data?.items?.find((p) => !p.isFree && p.product === l.product && p.unit === l.unit);

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Your order</h1>
      <Card>
        <CardContent className="divide-y p-0">
          {cart.map((l) => {
            const priced = priceOf(l);
            return (
              <div key={`${l.product}|${l.unit}`} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {money(priced?.unitPrice ?? l.price)} / {l.unit}
                    {priced?.discountPercent > 0 ? ` · ${priced.discountPercent}% off` : ''}
                  </p>
                </div>
                <QtyStepper value={l.qty} onChange={(qty) => cartActions(code).setQty(l, qty)} />
                <button
                  type="button"
                  className="p-2 text-muted-foreground hover:text-destructive"
                  onClick={() => cartActions(code).remove(l)}
                  aria-label={`Remove ${l.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          {freeLines.map((l, i) => (
            <div key={`free-${i}`} className="flex items-center justify-between p-3 text-sm">
              <span>
                {l.name} <Badge tone="success">Free</Badge>
              </span>
              <span className="tabular-nums">
                {l.qty} {l.unit}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button variant="outline" className="w-full" onClick={() => navigate(portalPath(code, 'catalog'))}>
        <Plus className="h-4 w-4" /> Add more products
      </Button>

      {preview.isError && <ErrorAlert message={apiError(preview.error).message} />}

      <Card>
        <CardContent className="space-y-1.5 p-4 text-sm">
          {preview.isLoading || !data ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <>
              <Row label="Items" value={money(data.totals.subtotal)} />
              {data.totals.discountTotal > 0 && <Row label="Discount" value={`− ${money(data.totals.discountTotal)}`} />}
              <Row label="Tax" value={money(data.totals.taxTotal)} />
              {Math.abs(data.totals.roundOff || 0) > 0 && <Row label="Round off" value={money(data.totals.roundOff)} />}
              <Row label="Total" value={money(data.totals.total)} strong />
              {data.offers?.length > 0 && (
                <p className="pt-1 text-xs text-emerald-700 dark:text-emerald-400">
                  Offers applied: {data.offers.map((o) => o.name).join(', ')}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {data?.belowMinimum && (
        <Alert tone="warning">
          <AlertDescription>The minimum order is {money(data.minOrderValue)}. Please add more.</AlertDescription>
        </Alert>
      )}

      <Field label="Note for the company (optional)">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="e.g. deliver before noon" />
      </Field>

      {place.error && <ErrorAlert title="Could not send the order" message={apiError(place.error).message} />}

      <Button
        className="h-12 w-full text-base"
        onClick={() => place.mutate()}
        loading={place.isPending}
        disabled={!data || preview.isFetching || data.belowMinimum}
      >
        Place order{data ? ` · ${money(data.totals.total)}` : ''}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        The company confirms your order. They may change quantities if stock is short; you will see it here.
      </p>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className={cn('flex justify-between', strong && 'border-t pt-2 text-base font-bold')}>
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export { Row as SummaryRow };
