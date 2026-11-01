import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/utils/cn';
import { titleCase } from '@/utils/format';

/**
 * Shared Phase 7 inventory helpers: vocabularies, action availability and a
 * reusable product line-item editor used by the adjustment / transfer / PO / GRN
 * forms on the Inventory screen.
 */

// ---------------------------------------------------------------------------
// Vocabularies (mirror server/src/config/constants.js)
// ---------------------------------------------------------------------------

export const MOVEMENT_TYPES = [
  'OPENING',
  'PURCHASE_RECEIPT',
  'SALES_OUT',
  'SALES_RETURN',
  'PURCHASE_RETURN',
  'ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'DAMAGE',
  'COUNT',
];

export const ADJUSTMENT_REASONS = ['COUNT', 'DAMAGE', 'THEFT', 'EXPIRY', 'CORRECTION', 'OTHER'];

export const ADJUSTMENT_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'];
export const TRANSFER_STATUSES = ['DRAFT', 'DISPATCHED', 'RECEIVED', 'CANCELLED'];
export const PO_STATUSES = ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];
export const GRN_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'];

export const humanize = (value) => titleCase(String(value || '').replace(/_/g, ' '));

export const movementLabel = humanize;
export const reasonLabel = humanize;

/** Signed movement types render green (+) / red (-) in the ledger. */
export const isPositiveType = (type) =>
  ['OPENING', 'PURCHASE_RECEIPT', 'SALES_RETURN', 'TRANSFER_IN'].includes(type);

// ---------------------------------------------------------------------------
// Action availability
// ---------------------------------------------------------------------------

export const adjustmentActionsFor = (row, can) => {
  if (!row) return [];
  const manage = can('inventory.adjustments.manage');
  const out = [];
  if (manage && row.status === 'DRAFT') out.push('post', 'delete');
  if (manage && row.status === 'POSTED') out.push('cancel');
  return out;
};

export const transferActionsFor = (row, can) => {
  if (!row) return [];
  const manage = can('inventory.transfers.manage');
  const out = [];
  if (manage && row.status === 'DRAFT') out.push('dispatch', 'delete');
  if (manage && row.status === 'DISPATCHED') out.push('receive');
  return out;
};

export const poActionsFor = (row, can) => {
  if (!row) return [];
  const out = [];
  if (can('purchases.update') && row.status === 'DRAFT') out.push('send', 'delete');
  if (can('purchases.cancel') && ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'].includes(row.status)) {
    out.push('cancel');
  }
  return out;
};

export const grnActionsFor = (row, can) => {
  if (!row) return [];
  const out = [];
  if (can('grn.post') && row.status === 'DRAFT') out.push('post');
  if (can('grn.update') && row.status === 'DRAFT') out.push('delete');
  if (can('grn.update') && row.status === 'POSTED') out.push('cancel');
  return out;
};

// ---------------------------------------------------------------------------
// Line-item editor
// ---------------------------------------------------------------------------

/**
 * Reusable product-lines grid.
 *
 * Each line is `{ product, qty, unitCost, ...extras }`. Picking a product fills
 * `unitCost` (when empty) from the catalogue so the user only overrides it for
 * spot purchases or write-offs.
 *
 * @param {object}   props
 * @param {Array}    props.value     - the lines
 * @param {Function} props.onChange  - setter
 * @param {Array}    props.products  - `{ id, name, sku, unit, purchasePrice }`
 * @param {string}   props.qtyKey    - which field holds the quantity (`qty`, `receivedQty`…)
 * @param {string}   props.qtyLabel  - header for the quantity column
 * @param {string}   props.costLabel - header for the cost column (hide with `showCost=false`)
 * @param {boolean}  props.signed    - allow negative quantities (adjustments)
 * @param {boolean}  props.showCost  - whether to render the cost column
 * @param {boolean}  props.showTax   - render a tax-% column (purchase orders)
 */
export function LineEditor({
  value = [],
  onChange,
  products = [],
  qtyKey = 'qty',
  qtyLabel = 'Qty',
  costLabel = 'Unit cost',
  signed = false,
  showCost = true,
  showTax = false,
  maxRows = 200,
}) {
  const byId = (id) => products.find((p) => p.id === id);

  // Product, qty, cost[, tax] + a trailing remove button (and unit hint row).
  const cols = showCost
    ? showTax
      ? 'grid-cols-[minmax(0,1fr)_5rem_5.5rem_4rem_2rem]'
      : 'grid-cols-[minmax(0,1fr)_5.5rem_6rem_2rem]'
    : 'grid-cols-[minmax(0,1fr)_5.5rem_2rem]';

  const update = (idx, patch) => {
    const next = value.map((line, i) => (i === idx ? { ...line, ...patch } : line));
    onChange(next);
  };

  const setProduct = (idx, productId) => {
    const product = byId(productId);
    const line = value[idx] || {};
    const patch = { product: productId };
    // Prefill cost from the catalogue only when the field is still empty.
    if (product && (line.unitCost === undefined || line.unitCost === '' || line.unitCost === null)) {
      patch.unitCost = Number(product.purchasePrice || 0);
    }
    // Same for tax: inherit the product's GST rate unless the user set one.
    if (showTax && product && (line.taxRate === undefined || line.taxRate === '' || line.taxRate === null)) {
      patch.taxRate = Number(product.gstRate || 0);
    }
    update(idx, patch);
  };

  const addLine = () => {
    if (value.length >= maxRows) return;
    const seed = { product: '', [qtyKey]: '', unitCost: '' };
    if (showTax) seed.taxRate = '';
    onChange([...value, seed]);
  };

  const removeLine = (idx) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'grid items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground',
          cols
        )}
      >
        <span>Product</span>
        <span className="text-right">{qtyLabel}</span>
        {showCost && <span className="text-right">{costLabel}</span>}
        {showTax && <span className="text-right">Tax %</span>}
        <span className="sr-only">Remove</span>
      </div>

      {value.map((line, idx) => {
        const product = byId(line.product);
        return (
          <div key={idx} className={cn('grid items-center gap-2', cols)}>
            <Select
              value={line.product || ''}
              onChange={(e) => setProduct(idx, e.target.value)}
              aria-label={`Product for line ${idx + 1}`}
            >
              <option value="">Select a product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.sku ? ` (${p.sku})` : ''}
                </option>
              ))}
            </Select>

            <Input
              type="number"
              value={line[qtyKey] ?? ''}
              onChange={(e) => update(idx, { [qtyKey]: e.target.value })}
              min={signed ? undefined : 0}
              step="1"
              className="text-right"
              aria-label={`Quantity for line ${idx + 1}`}
            />

            {showCost && (
              <Input
                type="number"
                value={line.unitCost ?? ''}
                onChange={(e) => update(idx, { unitCost: e.target.value })}
                min="0"
                step="0.01"
                className="text-right"
                aria-label={`Unit cost for line ${idx + 1}`}
              />
            )}

            {showTax && (
              <Input
                type="number"
                value={line.taxRate ?? ''}
                onChange={(e) => update(idx, { taxRate: e.target.value })}
                min="0"
                max="28"
                step="0.5"
                className="text-right"
                aria-label={`Tax rate for line ${idx + 1}`}
              />
            )}

            <button
              type="button"
              onClick={() => removeLine(idx)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive focus-ring"
              aria-label={`Remove line ${idx + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>

            {product && (
              <p className="col-span-full -mt-1 text-xs text-muted-foreground">
                {product.unit || 'PCS'}
                {product.purchasePrice ? ` · list cost ₹${product.purchasePrice}` : ''}
              </p>
            )}
          </div>
        );
      })}

      <Button variant="outline" size="sm" onClick={addLine} disabled={value.length >= maxRows}>
        <Plus className="h-4 w-4" />
        Add line
      </Button>

      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">Add at least one product line to continue.</p>
      )}
    </div>
  );
}

export default LineEditor;
