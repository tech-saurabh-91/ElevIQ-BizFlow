import dayjs from 'dayjs';
import Product from '../models/Product.js';
import DiscountRule from '../models/DiscountRule.js';
import Scheme from '../models/Scheme.js';
import { BadRequestError } from '../utils/errors.js';
import { round2 } from '../models/helpers.js';
import { resolveLinePricing, priceLineValues, assertPackQty, computeTotals, wholeUnitCodes, assertWholeQty } from './orderService.js';

/**
 * Sale pricing: price list -> discount master -> schemes.
 *
 *  1. Price      price list entry (else product price), or a manual price
 *                when the user may override prices.
 *  2. Trade disc the best matching discount rule (else the price list's own
 *                discount), or a manual discount when the user may override.
 *  3. Scheme     the best quantity / value slab discount, added on top, and
 *                free goods as separate zero-priced lines.
 *
 * Orders and direct invoices are priced here; an invoice made from an order
 * keeps the order's lines (what the customer agreed to).
 */

const round4 = (n) => Math.round(Number(n) * 10000) / 10000;
const has = (v) => v !== undefined && v !== null && v !== '';
const ids = (list) => (list || []).map((v) => String(v?._id || v));

/** Active on `date` (validTo counts the whole day). */
const liveOn = (doc, date) => {
  const d = dayjs(date || new Date());
  if (doc.validFrom && d.isBefore(dayjs(doc.validFrom).startOf('day'))) return false;
  if (doc.validTo && d.isAfter(dayjs(doc.validTo).endOf('day'))) return false;
  return true;
};

/** How specifically a rule / scheme names this customer (-1 = not for them). */
export const customerFit = (doc, customer) => {
  if (doc.customerScope === 'CUSTOMER') return ids(doc.customers).includes(String(customer?._id)) ? 2 : -1;
  if (doc.customerScope === 'CUSTOMER_TYPE') return (doc.customerTypes || []).includes(customer?.type) ? 1 : -1;
  return 0;
};

/** How specifically it names this product (-1 = not covered). */
export const productFit = (doc, product) => {
  if (doc.productScope === 'PRODUCT') return ids(doc.products).includes(String(product?._id)) ? 3 : -1;
  if (doc.productScope === 'BRAND') return product?.brand && (doc.brands || []).includes(product.brand) ? 2 : -1;
  if (doc.productScope === 'CATEGORY') return (doc.categories || []).includes(product?.category) ? 1 : -1;
  return 0;
};

/** Discount rules and schemes in force for a customer on a date. */
export const loadPricingContext = async ({ customer, date }) => {
  const [rules, schemes] = await Promise.all([
    DiscountRule.find({ isActive: true }).lean(),
    Scheme.find({ isActive: true }).lean(),
  ]);
  const fits = (doc) => liveOn(doc, date) && customerFit(doc, customer) >= 0;
  return { customer, date, rules: rules.filter(fits), schemes: schemes.filter(fits) };
};

/** The discount rule for one product: most specific first, then the larger %. */
export const bestRule = (rules, customer, product) => {
  let best = null;
  let bestScore = -1;
  for (const rule of rules) {
    const p = productFit(rule, product);
    if (p < 0) continue;
    const score = customerFit(rule, customer) * 10 + p;
    if (score > bestScore || (score === bestScore && Number(rule.discountPercent) > Number(best.discountPercent))) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
};

/** Highest slab reached by `amount`. */
const slabFor = (slabs, amount) =>
  [...(slabs || [])].filter((s) => Number(amount) >= Number(s.from)).sort((a, b) => Number(b.from) - Number(a.from))[0] || null;

/** A one-line description of what a scheme gives. */
export const schemeSummary = (scheme, productName = (id) => id) => {
  if (scheme.type === 'FREE_GOODS') {
    const free = scheme.freeProduct ? productName(String(scheme.freeProduct._id || scheme.freeProduct)) : 'same item';
    return `Buy ${scheme.buyQty} get ${scheme.freeQty} ${free} free${scheme.repeat ? ' (every multiple)' : ''}`;
  }
  const slabs = [...(scheme.slabs || [])].sort((a, b) => a.from - b.from);
  const unit = scheme.type === 'VALUE_DISCOUNT' ? 'value ' : 'qty ';
  return slabs.map((s) => `${unit}${s.from}+: ${s.discountPercent}% off`).join(', ');
};

const loadProductsFor = async (productMap, wanted) => {
  const missing = [...new Set(wanted.map(String))].filter((id) => !productMap.has(id));
  if (!missing.length) return productMap;
  const docs = await Product.find({ _id: { $in: missing } }).lean();
  docs.forEach((d) => productMap.set(String(d._id), d));
  return productMap;
};

/**
 * Price a sale's lines with rules and schemes.
 *
 * @param {Array} items  [{product, qty, unit?, unitPrice?, discountPercent?, taxRate?, note?}]
 *                       (free lines from an earlier save are ignored - they are rebuilt)
 * @param {object} opts  { products: Map, priceList, settings, customer, date, canOverride, verb }
 * @returns {{ lines, totals, taxBreakup, meta, applied, offers }}
 */
export const buildSaleLines = async (items, opts) => {
  const { priceList, settings, customer, date, canOverride = false, verb = 'sold' } = opts;
  const products = opts.products || new Map();
  const paid = (items || []).filter((i) => !i.isFree);
  if (!paid.length) throw new BadRequestError('Add at least one product', 'VALIDATION_ERROR');

  const ctx = opts.context || (await loadPricingContext({ customer, date }));
  await loadProductsFor(products, [
    ...paid.map((i) => String(i.product?._id || i.product)),
    ...ctx.schemes.filter((s) => s.freeProduct).map((s) => String(s.freeProduct)),
  ]);

  // Units that are counted, not measured (PCS, BOX...) take whole quantities.
  const wholeUnits = await wholeUnitCodes();

  // 1-2. price + trade discount per line
  const rows = paid.map((input, index) => {
    const product = products.get(String(input.product?._id || input.product));
    if (!product) throw new BadRequestError(`Product not found for line ${index + 1}`, 'INVALID_REFERENCE');
    if (!product.isActive) throw new BadRequestError(`"${product.name}" is inactive and cannot be ${verb}`, 'INACTIVE_PRODUCT');

    const manualPrice = canOverride && has(input.unitPrice);
    const manualDiscount = canOverride && has(input.discountPercent);
    const base = resolveLinePricing(product, priceList, {
      qty: input.qty,
      unit: input.unit,
      unitPrice: manualPrice ? input.unitPrice : undefined,
      discountPercent: manualDiscount ? input.discountPercent : undefined,
      // GST is the product's rate by law - never taken from the request.
      taxRate: undefined,
    });
    assertPackQty(input.qty, base.unitFactor, product, base.unit, index);
    assertWholeQty(input.qty, base.unit, wholeUnits, product, index);
    // A hand-entered price may go down, never above the printed MRP.
    const mrpForUnit = round2(Number(product.mrp || 0) * Number(base.unitFactor || 1));
    if (manualPrice && mrpForUnit > 0 && Number(base.unitPrice) > mrpForUnit + 0.001) {
      throw new BadRequestError(`${product.name}: price ${base.unitPrice} is more than the MRP ${mrpForUnit}`, 'VALIDATION_ERROR', [
        { field: `items.${index}.unitPrice`, message: `Cannot be more than the MRP ${mrpForUnit}` },
      ]);
    }

    let tradeDiscount = Number(base.discountPercent || 0);
    let discountRule = null;
    if (!manualDiscount) {
      const rule = bestRule(ctx.rules, customer, product);
      if (rule) {
        tradeDiscount = Number(rule.discountPercent);
        discountRule = rule;
      }
    }
    const qty = Number(input.qty);
    return {
      input,
      product,
      qty,
      baseQty: round4(qty * base.unitFactor),
      unit: base.unit,
      unitFactor: base.unitFactor,
      unitPrice: Number(base.unitPrice),
      taxRate: Number(base.taxRate),
      tradeDiscount,
      discountRule,
      manualPrice,
      manualDiscount,
      scheme: null,
      schemeDiscount: 0,
    };
  });

  // 3a. discount schemes: best quantity slab per line, value slabs on covered lines together
  const applied = [];
  for (const scheme of ctx.schemes.filter((s) => s.type !== 'FREE_GOODS')) {
    const covered = rows.filter((r) => productFit(scheme, r.product) >= 0);
    if (!covered.length) continue;
    if (scheme.type === 'VALUE_DISCOUNT') {
      const value = round2(covered.reduce((s, r) => s + r.qty * r.unitPrice, 0));
      const slab = slabFor(scheme.slabs, value);
      if (!slab) continue;
      covered.forEach((r) => {
        if (Number(slab.discountPercent) > r.schemeDiscount) Object.assign(r, { scheme, schemeDiscount: Number(slab.discountPercent) });
      });
    } else {
      covered.forEach((r) => {
        const slab = slabFor(scheme.slabs, r.baseQty);
        if (slab && Number(slab.discountPercent) > r.schemeDiscount) Object.assign(r, { scheme, schemeDiscount: Number(slab.discountPercent) });
      });
    }
  }

  const lines = rows.map((r) => {
    const discountPercent = Math.min(100, round2(r.tradeDiscount + r.schemeDiscount));
    return {
      product: r.product._id,
      name: r.product.name,
      sku: r.product.sku || '',
      unit: r.unit,
      unitFactor: r.unitFactor,
      baseQty: r.baseQty,
      hsnCode: r.product.hsnCode || '',
      ...priceLineValues(
        { qty: r.qty, unitPrice: r.unitPrice, discountPercent, taxRate: r.taxRate, note: r.input.note || '' },
        settings
      ),
      manualPrice: r.manualPrice,
      manualDiscount: r.manualDiscount,
      tradeDiscountPercent: round2(r.tradeDiscount),
      discountRule: r.discountRule?._id || null,
      discountRuleName: r.discountRule?.name || '',
      schemeDiscountPercent: round2(r.schemeDiscount),
      scheme: r.scheme?._id || null,
      schemeName: r.scheme?.name || '',
      isFree: false,
    };
  });

  // 3b. free goods: per product (lines of one product count together)
  const byProduct = new Map();
  rows.forEach((r, i) => {
    const key = String(r.product._id);
    const entry = byProduct.get(key) || { product: r.product, baseQty: 0, last: i };
    entry.baseQty = round4(entry.baseQty + r.baseQty);
    entry.last = i;
    byProduct.set(key, entry);
  });
  const freeAfter = new Map(); // line index -> free lines
  for (const { product, baseQty, last } of byProduct.values()) {
    let best = null;
    let bestQty = 0;
    for (const scheme of ctx.schemes.filter((s) => s.type === 'FREE_GOODS')) {
      if (productFit(scheme, product) < 0 || !(Number(scheme.buyQty) > 0) || !(Number(scheme.freeQty) > 0)) continue;
      const times = scheme.repeat ? Math.floor(baseQty / Number(scheme.buyQty) + 1e-9) : baseQty >= Number(scheme.buyQty) ? 1 : 0;
      const qty = round4(times * Number(scheme.freeQty));
      if (qty > bestQty) {
        best = scheme;
        bestQty = qty;
      }
    }
    if (!best) continue;
    const freeProduct = products.get(String(best.freeProduct || product._id));
    if (!freeProduct || !freeProduct.isActive) continue;
    const line = {
      product: freeProduct._id,
      name: freeProduct.name,
      sku: freeProduct.sku || '',
      unit: freeProduct.unit || 'PCS',
      unitFactor: 1,
      baseQty: bestQty,
      hsnCode: freeProduct.hsnCode || '',
      ...priceLineValues({ qty: bestQty, unitPrice: 0, discountPercent: 0, taxRate: 0, note: `Free - ${best.name}` }, settings),
      manualPrice: false,
      manualDiscount: false,
      tradeDiscountPercent: 0,
      discountRule: null,
      discountRuleName: '',
      schemeDiscountPercent: 0,
      scheme: best._id,
      schemeName: best.name,
      isFree: true,
      freeWith: product.name,
    };
    freeAfter.set(last, [...(freeAfter.get(last) || []), line]);
  }

  const out = [];
  lines.forEach((line, i) => {
    out.push(line);
    (freeAfter.get(i) || []).forEach((f) => out.push(f));
  });

  // What was applied, once per scheme / rule (for the editor and the audit).
  const seen = new Set();
  out.forEach((l) => {
    if (l.scheme && !seen.has(`s${l.scheme}`)) {
      seen.add(`s${l.scheme}`);
      const scheme = ctx.schemes.find((s) => String(s._id) === String(l.scheme));
      applied.push({ kind: 'SCHEME', id: String(l.scheme), name: l.schemeName, type: scheme?.type, summary: scheme ? schemeSummary(scheme, (id) => products.get(id)?.name || 'item') : '' });
    }
    if (l.discountRule && !seen.has(`r${l.discountRule}`)) {
      seen.add(`r${l.discountRule}`);
      applied.push({ kind: 'DISCOUNT', id: String(l.discountRule), name: l.discountRuleName, summary: `${l.tradeDiscountPercent}% trade discount` });
    }
  });

  const offers = ctx.schemes.map((s) => ({
    id: String(s._id),
    name: s.name,
    type: s.type,
    summary: schemeSummary(s, (id) => products.get(id)?.name || 'item'),
    validTo: s.validTo,
  }));

  const { totals, taxBreakup, meta } = computeTotals(out, settings);
  return { lines: out, totals, taxBreakup, meta, applied, offers };
};

/** The stored line as input for re-pricing: manual values kept, scheme parts dropped. */
export const repriceInput = (line) => ({
  product: String(line.product?._id || line.product),
  qty: Number(line.qty),
  unit: line.unit || undefined,
  unitPrice: line.manualPrice ? line.unitPrice : undefined,
  discountPercent: line.manualDiscount ? round2(Number(line.discountPercent || 0) - Number(line.schemeDiscountPercent || 0)) : undefined,
  note: line.note || '',
  isFree: Boolean(line.isFree),
});

export default { buildSaleLines, loadPricingContext, bestRule, schemeSummary, repriceInput };
