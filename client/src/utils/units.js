/**
 * Pack units on the client, mirroring server/src/services/catalogService.js.
 * Stock is counted in a product's base unit; a pack (PKT, CTN...) holds
 * `factor` base units and may carry its own price.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Base unit first, then the product's packs. */
export const unitOptions = (product) =>
  product
    ? [
        { unit: product.unit || 'PCS', factor: 1, price: 0, base: true },
        ...(product.packUnits || []).map((u) => ({ unit: u.unit, factor: Number(u.factor), price: Number(u.price || 0), base: false })),
      ]
    : [];

export const unitOf = (product, unit) => {
  const options = unitOptions(product);
  return options.find((o) => o.unit === unit) || options[0] || { unit: 'PCS', factor: 1, price: 0, base: true };
};

/**
 * Price of one `unit` of a product. Price lists price the base unit, so a
 * pack is entry x factor; otherwise its own price, else selling price x factor.
 */
export const unitPriceFor = (product, unit, perBasePrice, hasListEntry) => {
  const u = unitOf(product, unit);
  if (!u.base && !hasListEntry && u.price > 0) return u.price;
  return round2(Number(perBasePrice || 0) * u.factor);
};

/** 53 -> "5 PKT + 3 PCS" (largest packs first). */
export const describeQty = (baseQty, product) => {
  if (!product) return String(baseQty ?? 0);
  let left = Number(baseQty || 0);
  const parts = [];
  [...(product.packUnits || [])]
    .sort((a, b) => b.factor - a.factor)
    .forEach((p) => {
      const n = Math.floor((left + 1e-6) / p.factor);
      if (n > 0 && left > 0) {
        parts.push(`${n} ${p.unit}`);
        left -= n * p.factor;
      }
    });
  if (Math.abs(left) > 1e-6 || !parts.length) parts.push(`${Math.round(left * 1000) / 1000} ${product.unit || 'PCS'}`);
  return parts.join(' + ');
};

/** Stock line for pickers: "477 PCS (47 PKT + 7 PCS)". */
export const stockLabel = (product) => {
  const qty = Number(product?.stock || 0);
  const base = `${qty} ${product?.unit || ''}`.trim();
  return product?.packUnits?.length && qty > 0 ? `${base} (${describeQty(qty, product)})` : base;
};
