import PrintLog, { PRINT_DOC_TYPES } from '../models/PrintLog.js';
import { hasPermission } from '../middlewares/rbac.js';
import { ForbiddenError } from '../utils/errors.js';

/**
 * Original / duplicate control for key documents.
 *
 * - Printing needs "documents.print".
 * - The first print is the ORIGINAL; every later one is a DUPLICATE COPY with
 *   a COPY watermark.
 * - An admin ("documents.print.original") can print the original again
 *   (?original=1), or allow one more original for whoever prints next.
 * - Drafts print with a DRAFT watermark and are not counted; emailed PDFs are
 *   not prints either.
 */

const isTrue = (v) => v === '1' || v === 'true' || v === true;

export const printCounts = async (docType, docId) => {
  const rows = await PrintLog.find({ docType, docId }).select('action copy adminOriginal at byName').sort({ at: -1 }).lean();
  const prints = rows.filter((r) => r.action === 'PRINT');
  const originals = prints.filter((r) => r.copy === 'ORIGINAL' && !r.adminOriginal).length;
  const grants = rows.filter((r) => r.action === 'GRANT').length;
  return {
    printCount: prints.length,
    originals: prints.filter((r) => r.copy === 'ORIGINAL').length,
    duplicates: prints.filter((r) => r.copy === 'DUPLICATE').length,
    nextIsOriginal: originals < 1 + grants,
    lastPrintedAt: prints[0]?.at || null,
    lastPrintedBy: prints[0]?.byName || '',
  };
};

/**
 * Decide how this print is labelled and record it.
 * @returns {{ copyLabel: string|null, watermark: string|null, printedBy: string }}
 */
export const notePrint = async (req, { docType, docId, docNo = '', partyName = '', draft = false }) => {
  const printedBy = req.user?.name || '';
  if (req.printMode === 'email') return { copyLabel: null, watermark: draft ? 'DRAFT' : null, printedBy: '' };
  if (draft) return { copyLabel: 'DRAFT', watermark: 'DRAFT', printedBy };
  if (!PRINT_DOC_TYPES.includes(docType)) return { copyLabel: null, watermark: null, printedBy };

  if (!hasPermission(req, 'documents.print')) {
    throw new ForbiddenError('You are not allowed to print this document. Ask your admin.', 'PRINT_NOT_ALLOWED');
  }
  let copy;
  let adminOriginal = false;
  if (isTrue(req.query?.original)) {
    if (!hasPermission(req, 'documents.print.original')) {
      throw new ForbiddenError('Only an admin can print the original again.', 'PRINT_ORIGINAL_NOT_ALLOWED');
    }
    copy = 'ORIGINAL';
    adminOriginal = true;
  } else {
    copy = (await printCounts(docType, docId)).nextIsOriginal ? 'ORIGINAL' : 'DUPLICATE';
  }
  await PrintLog.create({ docType, docId, docNo, partyName, action: 'PRINT', copy, adminOriginal, by: req.user?.id || null, byName: printedBy });
  return {
    copyLabel: copy === 'ORIGINAL' ? 'ORIGINAL' : 'DUPLICATE COPY',
    watermark: copy === 'DUPLICATE' ? 'COPY' : null,
    printedBy,
  };
};

export default { notePrint, printCounts };
