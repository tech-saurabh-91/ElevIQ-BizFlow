import dayjs from 'dayjs';
import { AppError, ErrorCodes, BadRequestError } from '../utils/errors.js';
import { round2 } from '../models/helpers.js';
import { nextSeries, getFinancialYearTag } from '../utils/numberSeries.js';
import { lineUnit, baseQtyOf } from './catalogService.js';

/**
 * Order pricing + workflow rules.
 *
 * The client never decides money: every line, discount, tax and rounding
 * figure returned to the UI is recomputed here from the live product and
 * price-list documents.
 */

/** Price list entry matching a product and quantity (highest qualifying minQty wins). */
export const findPriceListEntry = (priceList, productId, qty) => {
  const items = priceList?.items || [];
  const matches = items
    .filter((i) => String(i.product?._id || i.product) === String(productId))
    .filter((i) => Number(qty) >= Number(i.minQty || 1))
    .sort((a, b) => Number(b.minQty || 1) - Number(a.minQty || 1));
  return matches[0] || null;
};

/**
 * Resolve the effective unit, price and discount for one line.
 *
 * A line may be in the base unit or one of the product's pack units. Price
 * lists price the base unit, so a pack costs entry price x pack factor; with
 * no price-list entry a pack uses its own price, else selling price x factor.
 */
export const resolveLinePricing = (product, priceList, input) => {
  const qty = Number(input.qty || 0);
  const unit = lineUnit(product, input.unit);
  const entry = findPriceListEntry(priceList, product._id, qty * unit.factor);

  const perBase =
    entry && Number(entry.price) > 0
      ? Number(entry.price)
      : Number(product.sellingPrice ?? product.mrp ?? 0);
  const basePrice = !unit.base && !entry && unit.price > 0 ? unit.price : round2(perBase * unit.factor);

  const unitPrice =
    input.unitPrice === undefined || input.unitPrice === null || input.unitPrice === ''
      ? basePrice
      : Number(input.unitPrice);

  const discountPercent =
    input.discountPercent === undefined || input.discountPercent === null || input.discountPercent === ''
      ? Number(entry?.discountPercent || 0)
      : Number(input.discountPercent);

  // The tax rate on a sale is the product's (HSN) rate - a request cannot change it.
  const taxRate = Number(product.gstRate ?? 0);

  return { unitPrice, discountPercent, taxRate, unit: unit.unit, unitFactor: unit.factor, priceListEntry: Boolean(entry) };
};

/**
 * Price one line from explicit values (used by orders, invoices and credit
 * notes so all three documents share a single tax/rounding implementation).
 */
export const priceLineValues = (input, settings) => {
  const taxInclusive = Boolean(settings?.tax?.taxInclusive);
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new BadRequestError('Quantity must be greater than zero', 'VALIDATION_ERROR');
  }

  const unitPrice = Number(input.unitPrice || 0);
  const discountPercent = Number(input.discountPercent || 0);
  // "No tax" regime: nothing is charged whatever the product's rate says.
  const taxRate = settings?.tax?.regime === 'NONE' ? 0 : Number(input.taxRate || 0);

  if (unitPrice < 0) {
    throw new BadRequestError('Unit price cannot be negative', 'VALIDATION_ERROR');
  }
  if (discountPercent < 0 || discountPercent > 100) {
    throw new BadRequestError('Discount must be between 0 and 100', 'VALIDATION_ERROR');
  }
  if (taxRate < 0 || taxRate > 100) {
    throw new BadRequestError('Tax rate must be between 0 and 100%', 'VALIDATION_ERROR');
  }

  const gross = round2(qty * unitPrice);
  const discountAmount = round2((gross * discountPercent) / 100);
  const net = round2(gross - discountAmount);

  let taxableAmount;
  let taxAmount;
  let lineTotal;

  if (taxInclusive) {
    // The entered price already contains tax: back it out for reporting.
    taxableAmount = round2(net / (1 + taxRate / 100));
    taxAmount = round2(net - taxableAmount);
    lineTotal = net;
  } else {
    taxableAmount = net;
    taxAmount = round2((net * taxRate) / 100);
    lineTotal = round2(net + taxAmount);
  }

  return {
    qty,
    freeQty: Number(input.freeQty || 0),
    unitPrice: round2(unitPrice),
    discountPercent: round2(discountPercent),
    discountAmount,
    taxRate: round2(taxRate),
    taxableAmount,
    taxAmount,
    lineTotal,
    note: input.note || '',
  };
};

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** The company's own state for place-of-supply checks. */
export const sellerStateOf = (settings, company) => settings?.tax?.placeOfSupply || company?.address?.state || '';

/** Where the goods go: the customer's shipping state, else the billing state. */
export const buyerStateOf = (party) => party?.shippingAddress?.state || party?.address?.state || '';

/**
 * Split a document's tax into CGST/SGST/IGST.
 *
 * GST with the "split same-state tax" setting: a sale inside the seller's
 * state is CGST + SGST (half each); a sale to another state is IGST. Any other
 * regime (VAT, sales tax, GST without split) keeps one amount in `igst`,
 * which documents label with the tenant's tax label.
 */
export const taxBreakupFor = (taxTotal, settings, { sellerState, buyerState } = {}) => {
  const total = round2(taxTotal || 0);
  const regime = settings?.tax?.regime || 'GST';
  if (regime === 'NONE' || !total) return { cgst: 0, sgst: 0, igst: 0 };
  const split = regime === 'GST' && settings?.tax?.enableCgstSgst !== false;
  const sameState = !buyerState || !sellerState || sameText(buyerState, sellerState);
  return split && sameState
    ? { cgst: round2(total / 2), sgst: round2(total - round2(total / 2)), igst: 0 }
    : { cgst: 0, sgst: 0, igst: total };
};

const round4 = (n) => Math.round(Number(n) * 10000) / 10000;

/** Codes of units counted in whole numbers (PCS, BOX...) - those without "allow decimals". */
export const wholeUnitCodes = async () => {
  const { default: Unit } = await import('../models/Unit.js');
  return new Set((await Unit.find({ allowDecimals: { $ne: true } }).select('code').lean()).map((u) => String(u.code).toUpperCase()));
};

/** A counted unit takes whole quantities only. */
export const assertWholeQty = (qty, unit, wholeUnits, product, index = 0, field = 'qty') => {
  if (wholeUnits.has(String(unit || '').toUpperCase()) && !Number.isInteger(Number(qty))) {
    throw new BadRequestError(`${product.name}: ${unit} must be a whole number (line ${index + 1})`, 'VALIDATION_ERROR', [
      { field: `items.${index}.${field}`, message: `${unit} must be a whole number` },
    ]);
  }
};

/** Packs (boxes, cartons...) are traded in whole numbers. */
export const assertPackQty = (qty, unitFactor, product, unit, index = 0) => {
  if (Number(unitFactor) > 1 && Math.abs(Number(qty) - Math.round(Number(qty))) > 1e-9) {
    throw new BadRequestError(`${product.name}: ${unit} must be a whole number (line ${index + 1})`, 'VALIDATION_ERROR');
  }
};

/** Copy a source line's unit onto a derived line (order -> invoice -> credit note). */
export const unitFieldsFrom = (line, qty) => {
  const unitFactor = Number(line.unitFactor || 1);
  return { unit: line.unit || 'PCS', unitFactor, baseQty: round4(Number(qty) * unitFactor) };
};

/** Whole-document totals from already-priced lines. */
export const computeTotals = (lines, settings) => {
  const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  const discountTotal = round2(lines.reduce((s, l) => s + l.discountAmount, 0));
  const taxableTotal = round2(lines.reduce((s, l) => s + l.taxableAmount, 0));
  const taxTotal = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
  const rawTotal = round2(taxableTotal + taxTotal);

  const mode = settings?.invoice?.rounding || 'NEAREST';
  const rounded = mode === 'NONE' ? rawTotal : mode === 'DOWN' ? Math.floor(rawTotal) : Math.round(rawTotal);
  const roundOff = round2(rounded - rawTotal);
  const total = round2(rounded);

  // Without a buyer state the sale is treated as same-state; document
  // controllers re-split with the real states via taxBreakupFor().
  const taxBreakup = taxBreakupFor(taxTotal, settings);

  return {
    totals: { subtotal, discountTotal, taxableTotal, taxTotal, roundOff, total },
    taxBreakup,
    meta: { taxInclusive: Boolean(settings?.tax?.taxInclusive), rounding: mode },
  };
};

/**
 * Build priced lines + order totals.
 *
 * @param {Array} items     - validated request items [{product, qty, unitPrice?, discountPercent?, taxRate?}]
 * @param {object} opts     - { products: Map<string, doc>, priceList, settings }
 */
export const buildOrderLines = (items, { products, priceList, settings }) => {
  const lines = items.map((input, index) => {
    const product = products.get(String(input.product));
    if (!product) throw new BadRequestError(`Product not found for line ${index + 1}`, 'INVALID_REFERENCE');

    if (!product.isActive) {
      throw new BadRequestError(`"${product.name}" is inactive and cannot be ordered`, 'INACTIVE_PRODUCT');
    }

    const { unitPrice, discountPercent, taxRate, unit, unitFactor } = resolveLinePricing(product, priceList, input);
    assertPackQty(input.qty, unitFactor, product, unit, index);

    const priced = priceLineValues({ ...input, unitPrice, discountPercent, taxRate }, settings);
    return {
      product: product._id,
      name: product.name,
      sku: product.sku || '',
      unit,
      unitFactor,
      baseQty: round4(priced.qty * unitFactor),
      hsnCode: product.hsnCode || '',
      ...priced,
    };
  });

  const { totals, taxBreakup, meta } = computeTotals(lines, settings);

  return { lines, totals, taxBreakup, meta };
};

/**
 * An order only books goods - stock leaves at dispatch / invoice, and that is
 * where a shortage is enforced (order.allowNegativeStock). So an order is never
 * refused for stock: a shortage or a product falling to its low-stock level
 * comes back as a warning.
 */
export const stockWarnings = (lines, products, settings) => {
  const allowNegative = Boolean(settings?.order?.allowNegativeStock);

  // Stock is counted in base units, whatever pack each line is in.
  const wanted = new Map();
  lines.forEach((l) => {
    const key = String(l.product);
    wanted.set(key, (wanted.get(key) || 0) + baseQtyOf(l));
  });

  const warnings = [];
  for (const [productId, qty] of wanted.entries()) {
    const product = products.get(productId);
    if (!product) continue;
    const available = Number(product.stock || 0);
    if (qty > available) {
      warnings.push(
        `${product.name}: only ${available} ${product.unit || 'unit'}(s) in stock, ${qty} ordered` +
          (allowNegative ? ' - stock will go below zero when it is invoiced' : ' - add stock before it can be invoiced')
      );
    } else if (available - qty <= Number(product.lowStockLevel || 0)) {
      warnings.push(`${product.name} will drop to ${round2(available - qty)} in stock`);
    }
  }
  return { warnings };
};

/**
 * Credit control.
 * BLOCK -> hard error; WARN -> returned warning (saved on the response only);
 * NONE  -> ignore.
 */
export const assertCreditLimit = (customer, orderTotal, settings) => {
  const action = settings?.order?.creditLimitAction || 'WARN';
  if (action === 'NONE') return { warning: '' };

  const limit = Number(customer?.creditLimit || 0);
  if (limit <= 0) return { warning: '' };

  const outstanding = Number(customer?.outstanding || 0);
  const exposure = round2(outstanding + Number(orderTotal || 0));
  if (exposure <= limit) return { warning: '' };

  const message = `Credit limit exceeded for ${customer.name}: limit ${limit.toFixed(2)}, outstanding ${outstanding.toFixed(
    2
  )}, this order ${Number(orderTotal).toFixed(2)}`;

  if (action === 'BLOCK') {
    throw new AppError(message, {
      status: 422,
      code: ErrorCodes.CREDIT_LIMIT_EXCEEDED,
      errors: [{ field: 'customerId', message }],
    });
  }
  return { warning: message };
};

/** Approval is required once the order value reaches the configured threshold. */
export const requiresApproval = (total, settings) => {
  const threshold = Number(settings?.order?.approvalThreshold || 0);
  return threshold > 0 && Number(total) >= threshold;
};

/** Next tenant order number, e.g. SO-2627-000001 (prefix/pad come from settings). */
export const nextOrderNumber = async (companyId, settings, date = new Date()) => {
  const prefix = settings?.series?.order?.prefix || 'SO';
  const pad = Number(settings?.series?.order?.pad || 6);
  const startMonth = Number(settings?.financialYearStartMonth || 4);
  const fy = getFinancialYearTag(date, startMonth);
  return nextSeries(companyId, 'ORDER', { prefix, pad, fy });
};

/** Status that a submitted (non-draft) order should start in. */
export const submittedStatus = (total, settings) =>
  requiresApproval(total, settings) ? 'PENDING_APPROVAL' : 'CONFIRMED';

/** Today's start (used by stats). */
export const startOfToday = () => dayjs().startOf('day').toDate();

export default {
  findPriceListEntry,
  resolveLinePricing,
  priceLineValues,
  computeTotals,
  buildOrderLines,
  stockWarnings,
  assertCreditLimit,
  requiresApproval,
  nextOrderNumber,
  submittedStatus,
};
