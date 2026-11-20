import PDFDocument from 'pdfkit';
import dayjs from 'dayjs';

import logger from '../utils/logger.js';

/**
 * One printed layout for every transaction document (invoice, credit note,
 * receipt, sales order, purchase order), in the style of a classic ERP
 * print-out:
 *
 *   [logo]                                   COMPANY NAME
 *                                            address / phone / tax ID
 *   ------------------- * Tax Invoice * -------------------
 *   Party name  : ...                 Invoice No. : ...
 *   Address     : ...                 Date        : ...
 *   Sr | Code | Description | Qty Unit | Rate | Disc % | Tax % | Amount
 *   Item count / total qty                        Totals ... Grand total
 *   Amount in words
 *   Terms / notes / bank details
 *   Prepared by                                   Authorised signatory
 *   ==================== computer generated ====== Page 1 of 1
 *
 * Everything printed comes from the spec, so the same layout serves every
 * country and tax regime. `copyLabel` prints ORIGINAL / DUPLICATE in the
 * corner and `watermark` a large diagonal COPY / DRAFT across each page.
 */

const PAGE = { left: 36, right: 559, top: 36, bottom: 790 };
const WIDTH = PAGE.right - PAGE.left;
const GREY = '#555555';
const LINE = '#333333';

export const money2 = (n) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Now as DD-MM-YYYY HH:mm in the company's time zone (servers run on UTC). */
const printedAt = (timeZone) => {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: timeZone || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(new Date())
        .map((x) => [x.type, x.value])
    );
    return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}`;
  } catch {
    return dayjs().format('DD-MM-YYYY HH:mm');
  }
};

/** Logo as an image buffer: data URLs and http(s) URLs (2 s timeout); anything else is skipped. */
const loadLogo = async (logo) => {
  if (!logo || typeof logo !== 'string') return null;
  try {
    const data = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(logo);
    if (data) return Buffer.from(data[2], 'base64');
    if (/^https?:\/\//i.test(logo)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(logo, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || '';
      if (!/png|jpe?g/i.test(type)) return null; // PDFKit draws PNG and JPEG only
      return Buffer.from(await res.arrayBuffer());
    }
  } catch (err) {
    logger.warn(`[pdf] logo skipped: ${err.message}`);
  }
  return null;
};

/**
 * @param {import('stream').Writable} out  response (or any writable)
 * @param {object} spec  see the file comment
 */
export const renderDocumentPdf = async (out, spec) => {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.left, bufferPages: true });
  if (out.setHeader) {
    out.setHeader('Content-Type', 'application/pdf');
    out.setHeader('Content-Disposition', `inline; filename="${spec.filename || 'document.pdf'}"`);
  }
  doc.pipe(out);
  const logo = await loadLogo(spec.company?.logo);

  // ------------------------------------------------------------- header
  const drawHeader = (compact = false) => {
    let y = PAGE.top;
    if (spec.copyLabel) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
      const w = doc.widthOfString(spec.copyLabel) + 12;
      doc.rect(PAGE.right - w, y - 14, w, 12).lineWidth(0.6).strokeColor(LINE).stroke();
      doc.text(spec.copyLabel, PAGE.right - w, y - 11.5, { width: w, align: 'center' });
    }
    if (logo && !compact) {
      try {
        doc.image(logo, PAGE.left, y, { fit: [90, 55] });
      } catch {
        /* unreadable image: print without it */
      }
    }
    const c = spec.company || {};
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(compact ? 11 : 15);
    doc.text(c.name || '', PAGE.left + 100, y, { width: WIDTH - 100, align: 'right' });
    y = doc.y + 1;
    if (!compact) {
      doc.font('Helvetica').fontSize(7.5).fillColor(GREY);
      (c.lines || []).filter(Boolean).forEach((l) => {
        doc.text(l, PAGE.left + 100, y, { width: WIDTH - 100, align: 'right' });
        y = doc.y;
      });
      y = Math.max(y, PAGE.top + (logo ? 58 : 0));
    }
    y += 6;
    // Title between two rules: ----- * Tax Invoice * -----
    const title = `* ${spec.title} *`;
    doc.font('Helvetica-Bold').fontSize(compact ? 9 : 11).fillColor('#000');
    const tw = doc.widthOfString(title) + 16;
    const mid = PAGE.left + WIDTH / 2;
    doc.moveTo(PAGE.left, y + 6).lineTo(mid - tw / 2, y + 6).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.moveTo(mid + tw / 2, y + 6).lineTo(PAGE.right, y + 6).stroke();
    doc.text(title, mid - tw / 2, y, { width: tw, align: 'center' });
    return y + 18;
  };

  // ------------------------------------------------------------- party + meta
  const pairBlock = (pairs, x, y, labelW, width) => {
    pairs
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .forEach(([label, value]) => {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#000').text(label, x, y, { width: labelW });
        doc.font('Helvetica').text(`: ${value}`, x + labelW, y, { width: width - labelW });
        y = Math.max(doc.y, y + 10) + 1;
      });
    return y;
  };

  let y = drawHeader();
  const leftEnd = pairBlock(spec.party || [], PAGE.left, y, 78, 290);
  const rightEnd = pairBlock(spec.meta || [], PAGE.left + 330, y, 78, WIDTH - 330);
  y = Math.max(leftEnd, rightEnd) + 6;

  // ------------------------------------------------------------- lines table
  const cols = spec.columns || [];
  const totalWeight = cols.reduce((t, c) => t + (c.w || 1), 0);
  let x = PAGE.left;
  const placed = cols.map((c) => {
    const w = (WIDTH * (c.w || 1)) / totalWeight;
    const out2 = { ...c, x, w };
    x += w;
    return out2;
  });
  const tableHeader = () => {
    doc.moveTo(PAGE.left, y).lineTo(PAGE.right, y).lineWidth(0.8).strokeColor(LINE).stroke();
    y += 3;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#000');
    let h = 0;
    placed.forEach((c) => {
      doc.text(c.label, c.x + 2, y, { width: c.w - 4, align: c.align || 'left' });
      h = Math.max(h, doc.y - y);
    });
    y += h + 3;
    doc.moveTo(PAGE.left, y).lineTo(PAGE.right, y).stroke();
    y += 4;
  };
  tableHeader();
  doc.font('Helvetica').fontSize(8);
  (spec.rows || []).forEach((row) => {
    const cells = Array.isArray(row) ? row : row.cells;
    const note = Array.isArray(row) ? '' : row.note;
    doc.font('Helvetica').fontSize(8);
    const rowH = Math.max(...placed.map((c, i) => doc.heightOfString(String(cells[i] ?? ''), { width: c.w - 4 }))) + (note ? 9 : 0);
    if (y + rowH > PAGE.bottom - 150) {
      doc.addPage();
      y = drawHeader(true);
      tableHeader();
      doc.font('Helvetica').fontSize(8);
    }
    placed.forEach((c, i) => doc.fillColor('#000').text(String(cells[i] ?? ''), c.x + 2, y, { width: c.w - 4, align: c.align || 'left' }));
    if (note) {
      doc.fontSize(6.5).fillColor(GREY).text(note, placed[Math.min(2, placed.length - 1)].x + 2, y + rowH - 9, { width: 260 });
      doc.fontSize(8).fillColor('#000');
    }
    y += rowH + 3;
  });
  doc.moveTo(PAGE.left, y).lineTo(PAGE.right, y).lineWidth(0.8).strokeColor(LINE).stroke();
  y += 5;

  // ------------------------------------------------------------- summary + totals
  if (y > PAGE.bottom - 170) {
    doc.addPage();
    y = drawHeader(true);
  }
  const top = y;
  pairBlock(spec.summary || [], PAGE.left, y, 70, 200);
  const tx = PAGE.left + WIDTH - 230;
  (spec.totals || []).forEach(([label, value, opts = {}]) => {
    if (opts.strong) {
      doc.moveTo(tx, y - 1).lineTo(PAGE.right, y - 1).lineWidth(0.6).strokeColor(LINE).stroke();
      y += 2;
    }
    doc.font(opts.strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.strong ? 9.5 : 8).fillColor('#000');
    doc.text(label, tx, y, { width: 135 });
    doc.text(typeof value === 'number' ? money2(value) : String(value ?? ''), tx + 135, y, { width: 95, align: 'right' });
    y = doc.y + 2;
    if (opts.strong) {
      doc.moveTo(tx, y).lineTo(PAGE.right, y).lineWidth(0.6).stroke();
      doc.moveTo(tx, y + 2).lineTo(PAGE.right, y + 2).stroke();
      y += 5;
    }
  });
  y = Math.max(y, top + 30) + 4;

  if (spec.words) {
    doc.font('Helvetica-Bold').fontSize(8).text('Amount in words', PAGE.left, y, { width: 90 });
    doc.font('Helvetica').text(`: ${spec.words}`, PAGE.left + 90, y, { width: WIDTH - 90 });
    y = doc.y + 6;
  }

  // ------------------------------------------------------------- terms, notes, QR
  if (spec.qr?.png) {
    try {
      doc.image(spec.qr.png, PAGE.right - 78, y, { width: 78 });
      doc.font('Helvetica').fontSize(6.5).fillColor(GREY).text(spec.qr.caption || '', PAGE.right - 110, y + 80, { width: 110, align: 'center' });
      doc.fillColor('#000');
    } catch {
      /* skip */
    }
  }
  (spec.sections || [])
    .filter(([, text]) => text)
    .forEach(([heading, text]) => {
      if (y > PAGE.bottom - 90) {
        doc.addPage();
        y = drawHeader(true);
      }
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#000').text(heading, PAGE.left, y, { width: spec.qr?.png ? 330 : WIDTH });
      doc.font('Helvetica').fontSize(7.5).text(String(text), PAGE.left, doc.y + 1, { width: spec.qr?.png ? 330 : WIDTH });
      y = doc.y + 6;
    });

  // ------------------------------------------------------------- signatures
  const signY = Math.max(y + 24, PAGE.bottom - 70);
  if (signY > PAGE.bottom - 40) {
    doc.addPage();
  }
  const sY = Math.min(signY, PAGE.bottom - 70);
  const [leftSign, rightSign] = spec.signatures || ['Prepared by', 'Authorised signatory'];
  doc.moveTo(PAGE.left, sY).lineTo(PAGE.right, sY).lineWidth(0.4).strokeColor('#999').stroke();
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
  if (leftSign) doc.text(leftSign, PAGE.left, sY + 24, { width: 220 });
  if (rightSign) doc.text(rightSign, PAGE.right - 220, sY + 24, { width: 220, align: 'right' });
  doc.font('Helvetica').fontSize(7).fillColor(GREY);
  if (spec.company?.name && rightSign) doc.text(`For ${spec.company.name}`, PAGE.right - 220, sY + 4, { width: 220, align: 'right' });

  // ------------------------------------------------------------- footer + watermark on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // The footer sits in the bottom margin: without this PDFKit would start a new page for it.
    doc.page.margins.bottom = 0;
    if (spec.watermark) {
      doc.save();
      doc.rotate(-35, { origin: [297, 421] });
      doc.font('Helvetica-Bold').fontSize(96).fillColor('#9ca3af').fillOpacity(0.18);
      doc.text(spec.watermark, 0, 360, { width: 595, align: 'center', lineBreak: false });
      doc.restore();
      doc.fillOpacity(1);
    }
    const fy = PAGE.bottom + 6;
    doc.moveTo(PAGE.left, fy).lineTo(PAGE.right, fy).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.moveTo(PAGE.left, fy + 2).lineTo(PAGE.right, fy + 2).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(GREY);
    doc.text(spec.footer || '---- This is a computer generated document ----', PAGE.left, fy + 6, { width: WIDTH, align: 'center', lineBreak: false });
    doc.text(`Printed ${printedAt(spec.timezone)}${spec.printedBy ? ` by ${spec.printedBy}` : ''}`, PAGE.left, fy + 16, { width: 250, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, PAGE.right - 100, fy + 16, { width: 100, align: 'right', lineBreak: false });
  }
  doc.end();
};

/** Company block lines shared by every document. */
export const companyBlock = (company = {}, loc = {}, extra = []) => {
  const a = company.address || {};
  return {
    name: company.businessName || company.name || '',
    logo: company.logo || '',
    lines: [
      company.legalName && company.legalName !== company.businessName ? company.legalName : '',
      [a.line1, a.line2].filter(Boolean).join(', '),
      [a.city, a.state, a.pincode || a.postalCode, a.country].filter(Boolean).join(', '),
      [company.phone ? `Phone: ${company.phone}` : '', company.email ? `Email: ${company.email}` : ''].filter(Boolean).join('   '),
      company.gstin && loc.showTaxId !== false ? `${loc.taxIdLabel || 'Tax ID'}: ${company.gstin}` : '',
      ...extra,
    ],
  };
};

export const addressText = (a = {}) => [a.line1, a.line2, a.city, a.state, a.pincode || a.postalCode, a.country].filter(Boolean).join(', ');
export const dateText = (d) => (d ? dayjs(d).format('DD-MM-YYYY') : '');

/** Item table columns for sales / purchase documents (HSN only where it applies). */
export const lineColumns = (loc = {}) =>
  [
    { label: 'Sr.', w: 0.45 },
    { label: 'Code', w: 1 },
    { label: 'Description', w: 3 },
    loc.codeLabel === 'HSN' ? { label: 'HSN', w: 0.8 } : null,
    { label: 'Qty Unit', w: 1.05, align: 'right' },
    { label: 'Rate', w: 1.05, align: 'right' },
    { label: 'Disc %', w: 0.6, align: 'right' },
    loc.regime === 'NONE' ? null : { label: `${loc.taxLabel || 'Tax'} %`, w: 0.65, align: 'right' },
    { label: 'Amount', w: 1.25, align: 'right' },
  ].filter(Boolean);

export const lineRow = (item, index, loc = {}, note = '') => ({
  cells: [
    index + 1,
    item.sku || item.product?.sku || '',
    `${item.name || ''}${item.isFree ? ' (FREE)' : ''}`,
    ...(loc.codeLabel === 'HSN' ? [item.hsnCode || ''] : []),
    `${Number(item.qty || 0)} ${item.unit || ''}`.trim(),
    money2(item.unitPrice),
    Number(item.discountPercent || 0) ? `${Number(item.discountPercent)}` : '0.00',
    ...(loc.regime === 'NONE' ? [] : [`${Number(item.taxRate || 0)}`]),
    money2(item.lineTotal),
  ],
  note,
});

/** Subtotal / discount / taxable / tax / round off rows of a priced document. */
export const priceTotals = (d, loc, taxRowsOf) => [
  ['Item value', d.subtotal],
  ...(Number(d.discountTotal) ? [['Less: discount', -Number(d.discountTotal)]] : []),
  ['Taxable value', d.taxableTotal],
  ...taxRowsOf(d.taxTotal, d.taxBreakup, loc).map(([label, v]) => [String(label).trim().startsWith('C') || String(label).trim().startsWith('S') || String(label).trim().startsWith('I') ? `   ${String(label).trim()}` : `${label}`, v]),
  ...(Number(d.roundOff) ? [['Round off', d.roundOff]] : []),
];

export const itemSummary = (items = []) => [
  ['Item count', String(items.length)],
  ['Total qty', String(Math.round(items.reduce((t, i) => t + Number(i.qty || 0), 0) * 1000) / 1000)],
];

export default { renderDocumentPdf, companyBlock, addressText, dateText, money2, lineColumns, lineRow, priceTotals, itemSummary };
