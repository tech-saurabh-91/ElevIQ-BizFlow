import { findCountry } from '../services/locationService.js';

/**
 * Country/tax wording for generated PDFs.
 *
 * PDFKit's built-in Helvetica only covers Latin-1, so non-ASCII currency
 * symbols (₹, د.إ, ...) are printed as the ISO code (INR, AED) instead of
 * turning into garbage glyphs.
 */
export const pdfLocale = async (settings, company) => {
  const country = await findCountry(company?.address?.country).catch(() => null);
  const symbol = settings?.currencySymbol || company?.currencySymbol || '';
  const currency = settings?.currency || company?.currency || '';
  const regime = settings?.tax?.regime || 'GST';
  const taxLabel = settings?.tax?.taxLabel || country?.tax?.label || 'Tax';

  return {
    money: symbol && /^[\x20-\x7E]+$/.test(symbol) ? symbol : currency,
    currency,
    regime,
    taxLabel,
    taxIdLabel: country?.tax?.taxIdLabel || 'Tax ID',
    // HSN/SAC codes are an Indian GST concept; elsewhere it is just an item code.
    codeLabel: country?.code === 'IN' ? 'HSN' : 'Code',
    showTaxId: settings?.invoice?.showGstin !== false,
    splitGst: regime === 'GST' && settings?.tax?.enableCgstSgst !== false,
  };
};

/** Tax summary rows for the totals block: [label, amount][]. */
export const taxRows = (taxTotal, breakup = {}, loc) => {
  if (loc.regime === 'NONE') return [];
  const rows = [[loc.taxLabel, taxTotal]];
  const cgst = Number(breakup?.cgst || 0);
  const sgst = Number(breakup?.sgst || 0);
  const igst = Number(breakup?.igst || 0);
  if (cgst || sgst) rows.push(['  CGST', cgst], ['  SGST', sgst]);
  else if (igst && loc.splitGst) rows.push(['  IGST', igst]);
  return rows;
};

export default { pdfLocale, taxRows };
