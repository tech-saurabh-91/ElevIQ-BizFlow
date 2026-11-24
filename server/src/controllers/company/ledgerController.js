import ExcelJS from 'exceljs';
import BalanceConfirmation from '../../models/BalanceConfirmation.js';
import dayjs from 'dayjs';

import Setting from '../../models/Setting.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { success } from '../../utils/apiResponse.js';
import { AppError } from '../../utils/errors.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { pdfLocale } from '../../utils/pdfLocale.js';
import { renderDocumentPdf, companyBlock, addressText, money2 } from '../../services/docPdf.js';
import { renderPdf } from '../../services/documentMail.js';
import { isMailConfigured, sendMail } from '../../services/mailer.js';
import { buildLedger, sideOf } from '../../services/ledgerService.js';
import { DEFAULT_TZ } from '../../services/fieldForceService.js';

/**
 * Statement of account (party ledger) of a customer or supplier:
 *   GET  /ledgers/:kind/:id          the statement (JSON)
 *   GET  /ledgers/:kind/:id/pdf      printable PDF (?confirm=true adds a balance confirmation)
 *   GET  /ledgers/:kind/:id/export   Excel
 *   POST /ledgers/:kind/:id/email    email the PDF
 * Every call takes ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: this financial year to today).
 */

const settingsOf = async (req) => req.settings || (await Setting.forCompany(req.companyId));

const ledgerOf = async (req, source = req.query) => {
  const settings = await settingsOf(req);
  return buildLedger({
    kind: req.params.kind,
    partyId: req.params.id,
    companyId: req.companyId,
    from: source.from,
    to: source.to,
    tz: req.company?.timezone || settings?.timezone || DEFAULT_TZ,
    startMonth: Number(
      req.company?.financialYearStartMonth || settings?.financialYearStartMonth || 4
    ),
  });
};

const dmy = (key) => dayjs(key).format('DD-MM-YYYY');
const withSide = (kind, amount) =>
  `${money2(Math.abs(amount))}${sideOf(kind, amount) ? ` ${sideOf(kind, amount)}` : ''}`;
const fileName = (ledger, ext) =>
  `statement-${String(ledger.party.code || ledger.party.name).replace(/[^a-z0-9-]/gi, '')}-${ledger.period.from}-to-${ledger.period.to}.${ext}`;

/** Plain-words balance: "Balance due to us" / "Balance we owe" / "Nothing due". */
const balanceWords = (kind, amount) => {
  if (Math.abs(amount) < 0.005) return 'Nothing due';
  if (kind === 'customer')
    return amount > 0 ? 'Balance due from you' : 'Balance due to you (advance with us)';
  return amount > 0 ? 'Balance we owe you' : 'Balance due from you';
};

/** GET /ledgers/:kind/:id */
export const show = asyncHandler(async (req, res) => {
  const ledger = await ledgerOf(req);
  // The customer's latest answer from the online portal (confirmed / disputed).
  if (req.params.kind === 'customer') {
    const latest = await BalanceConfirmation.findOne({ customer: req.params.id }).sort({ createdAt: -1 }).lean();
    ledger.confirmation = latest
      ? { status: latest.status, asOf: latest.asOf, balance: latest.balance, note: latest.note, at: latest.createdAt }
      : null;
  }
  return success(res, { data: ledger });
});

/** GET /ledgers/:kind/:id/pdf */
export const pdf = asyncHandler(async (req, res) => {
  const source = req.method === 'POST' ? req.body || {} : req.query;
  const ledger = await ledgerOf(req, source);
  const confirm = String(source.confirm) === 'true';
  const settings = await settingsOf(req);
  const company = req.company || {};
  const loc = await pdfLocale(settings, company);
  const { kind, party } = ledger;
  const who = kind === 'customer' ? 'Customer' : 'Supplier';
  const closingText = withSide(kind, ledger.closing);
  const asOn = dmy(ledger.period.to);

  const rows = [
    [dmy(ledger.period.from), 'Opening balance', '', '', '', '', withSide(kind, ledger.opening)],
    ...ledger.rows.map((r) => ({
      cells: [
        dayjs(r.date).format('DD-MM-YYYY'),
        r.type,
        r.no,
        r.narration,
        r.debit ? money2(r.debit) : '',
        r.credit ? money2(r.credit) : '',
        withSide(kind, r.balance),
      ],
    })),
  ];

  const sections = [];
  if (ledger.advance > 0) {
    sections.push([
      'Advance on account',
      `${money2(ledger.advance)} received but not yet set against any invoice. It is not in the balance above and will be adjusted against your next invoices.`,
    ]);
  }
  if (confirm) {
    sections.push([
      'Balance confirmation',
      `As per our books, the balance of your account as on ${asOn} is ${loc.symbol || ''}${closingText} (${balanceWords(kind, ledger.closing).toLowerCase()}). Please check this statement against your books and sign and return a copy to confirm the balance. If it does not agree, please send us your statement of account. If we do not hear from you within 15 days, we will take the balance as correct.`,
    ]);
  }

  await renderDocumentPdf(res, {
    filename: fileName(ledger, 'pdf'),
    title: confirm ? 'Balance Confirmation' : 'Statement of Account',
    company: companyBlock(company, loc),
    timezone: company.timezone || settings?.timezone,
    printedBy: req.user?.name || '',
    party: [
      [who, party.name],
      ['Code', party.code],
      ['Address', addressText(party.address)],
      ['Phone', party.phone],
      [loc.taxIdLabel, party.gstin],
    ],
    meta: [
      ['Period', `${dmy(ledger.period.from)} to ${asOn}`],
      ['Opening', withSide(kind, ledger.opening)],
      ['Closing', closingText],
      ['Currency', loc.currency || ''],
    ],
    columns: [
      { label: 'Date', w: 1.2 },
      { label: 'Type', w: 1.5 },
      { label: 'Doc No.', w: 1.6 },
      { label: 'Particulars', w: 2.2 },
      { label: 'Debit', w: 1.2, align: 'right' },
      { label: 'Credit', w: 1.2, align: 'right' },
      { label: 'Balance', w: 1.5, align: 'right' },
    ],
    rows,
    summary: [['Entries', String(ledger.rows.length)]],
    totals: [
      ['Opening balance', withSide(kind, ledger.opening)],
      ['Total debit', ledger.totals.debit],
      ['Total credit', ledger.totals.credit],
      ['Closing balance', closingText, { strong: true }],
    ],
    sections,
    signatures: confirm
      ? [`${who}'s signature & seal`, 'Authorised signatory']
      : ['Prepared by', 'Authorised signatory'],
    footer: '---- Dr = due to us, Cr = due from us. This is a computer generated statement ----',
  });
});

/** GET /ledgers/:kind/:id/export */
export const exportXlsx = asyncHandler(async (req, res) => {
  const ledger = await ledgerOf(req);
  const { kind, party } = ledger;
  const company = req.company || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ElevIQ';
  const ws = wb.addWorksheet('Statement');
  ws.addRow([company.businessName || company.name || '']).font = { bold: true, size: 13 };
  ws.addRow([`Statement of account - ${party.name}${party.code ? ` (${party.code})` : ''}`]).font =
    { bold: true };
  ws.addRow([`${dmy(ledger.period.from)} to ${dmy(ledger.period.to)}`]);
  ws.addRow([]);
  const head = ws.addRow([
    'Date',
    'Type',
    'Doc No.',
    'Particulars',
    'Debit',
    'Credit',
    'Balance',
    'Dr/Cr',
  ]);
  head.font = { bold: true };
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } };
  });
  ws.addRow([
    new Date(`${ledger.period.from}T00:00:00`),
    'Opening balance',
    '',
    '',
    '',
    '',
    Math.abs(ledger.opening),
    sideOf(kind, ledger.opening),
  ]);
  ledger.rows.forEach((r) =>
    ws.addRow([
      new Date(r.date),
      r.type,
      r.no,
      r.narration,
      r.debit || '',
      r.credit || '',
      Math.abs(r.balance),
      sideOf(kind, r.balance),
    ])
  );
  const total = ws.addRow([
    '',
    'Total',
    '',
    '',
    ledger.totals.debit,
    ledger.totals.credit,
    Math.abs(ledger.closing),
    sideOf(kind, ledger.closing),
  ]);
  total.font = { bold: true };
  [14, 16, 18, 44, 14, 14, 16, 8].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.getColumn(1).numFmt = 'dd-mm-yyyy';
  [5, 6, 7].forEach((i) => {
    ws.getColumn(i).numFmt = '#,##0.00';
  });
  if (ledger.advance > 0)
    ws.addRow(['', `Advance on account (not in the balance): ${money2(ledger.advance)}`]);
  const buffer = await wb.xlsx.writeBuffer();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(ledger, 'xlsx')}"`);
  return res.send(Buffer.from(buffer));
});

/** POST /ledgers/:kind/:id/email  { to, message?, from?, to?, confirm? } */
export const email = asyncHandler(async (req, res) => {
  if (!isMailConfigured()) {
    throw new AppError(
      'Email sending is not set up yet. Ask your service provider, or download the PDF and share it.',
      { status: 503, code: 'EMAIL_NOT_SET_UP' }
    );
  }
  const recipients = req.body.to;
  const period = { from: req.body.from, to: req.body.periodTo, confirm: req.body.confirm };
  const ledger = await ledgerOf(req, period);
  const { buffer, filename } = await renderPdf(pdf, {
    ...req,
    method: 'POST',
    body: period,
    query: {},
  });
  const company = req.company || {};
  const businessName = company.businessName || company.name || '';
  const note = String(req.body.message || '').trim();
  const confirm = String(period.confirm) === 'true';
  const label = confirm ? 'Balance confirmation' : 'Statement of account';
  const text = [
    `Dear ${ledger.party.name},`,
    '',
    `Please find attached your ${label.toLowerCase()} for ${dmy(ledger.period.from)} to ${dmy(ledger.period.to)}.`,
    `Closing balance: ${withSide(ledger.kind, ledger.closing)} (${balanceWords(ledger.kind, ledger.closing).toLowerCase()}).`,
    ...(confirm
      ? ['Please confirm the balance, or send us your statement if it does not agree.']
      : []),
    ...(note ? ['', note] : []),
    '',
    'Regards,',
    businessName,
    company.phone || '',
  ].join('\n');
  const result = await sendMail({
    to: recipients.join(', '),
    subject: `${label} - ${ledger.party.name}${businessName ? ` - ${businessName}` : ''}`,
    text,
    replyTo: company.email || undefined,
    attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
  });
  if (!result.sent)
    throw new AppError('The email could not be sent. Please try again in a while.', {
      status: 502,
      code: 'EMAIL_FAILED',
    });
  audit(req, {
    action: AUDIT_ACTIONS.EXPORT,
    entityType: ledger.kind === 'customer' ? 'Customer' : 'Supplier',
    entityId: ledger.party.id,
    entityLabel: ledger.party.name,
    description: `${label} (${ledger.period.from} to ${ledger.period.to}) emailed to ${recipients.join(', ')}`,
  });
  return success(res, {
    message: `${label} emailed to ${recipients.join(', ')}`,
    data: { to: recipients },
  });
});

export default { show, pdf, exportXlsx, email };
