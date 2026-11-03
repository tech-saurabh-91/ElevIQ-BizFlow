/**
 * Client mirror of the server tax rules (server/src/services/orderService.js)
 * so editor previews match what the server will save.
 */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Where the goods go: the party's shipping state, else the billing state. */
export const buyerStateOf = (party) => party?.shippingAddress?.state || party?.address?.state || '';

/**
 * GST with "split same-state tax": same state -> CGST + SGST, other state ->
 * IGST. Every other regime keeps a single amount in `igst`.
 */
export const taxBreakupFor = (taxTotal, settings, buyerState) => {
  const total = round2(taxTotal || 0);
  const tax = settings?.tax || {};
  if (tax.regime === 'NONE' || !total) return { cgst: 0, sgst: 0, igst: 0 };
  const split = (tax.regime || 'GST') === 'GST' && tax.enableCgstSgst !== false;
  const sameState = !buyerState || !tax.sellerState || same(buyerState, tax.sellerState);
  return split && sameState
    ? { cgst: round2(total / 2), sgst: round2(total - round2(total / 2)), igst: 0 }
    : { cgst: 0, sgst: 0, igst: total };
};

/** Line tax rate after applying the "no tax" regime. */
export const effectiveTaxRate = (rate, settings) => (settings?.tax?.regime === 'NONE' ? 0 : Number(rate || 0));

/**
 * Rows to show for a saved or previewed breakup:
 * [{ label, value }] - CGST/SGST when split, IGST for inter-state GST, or the
 * tenant's own label (VAT, Sales tax...) for single-amount regimes.
 */
export const breakupRows = (breakup = {}, tax = {}) => {
  const cgst = Number(breakup.cgst || 0);
  const sgst = Number(breakup.sgst || 0);
  const igst = Number(breakup.igst || 0);
  if (cgst || sgst) return [{ label: 'CGST / SGST', value: [cgst, sgst] }];
  if (!igst) return [];
  const gstSplit = (tax.regime || 'GST') === 'GST' && tax.enableCgstSgst !== false;
  return [{ label: gstSplit ? 'IGST' : tax.label || tax.taxLabel || 'Tax', value: [igst] }];
};
