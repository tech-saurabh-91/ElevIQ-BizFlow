import Invoice from '../../models/Invoice.js';
import CreditNote from '../../models/CreditNote.js';
import Payment from '../../models/Payment.js';
import PurchaseOrder from '../../models/PurchaseOrder.js';
import PrintLog from '../../models/PrintLog.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { success, paginated } from '../../utils/apiResponse.js';
import { NotFoundError, ForbiddenError } from '../../utils/errors.js';
import { hasPermission } from '../../middlewares/rbac.js';
import { searchRegex } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { printCounts, PRINT_PERMISSION } from '../../services/printControl.js';

/**
 * /api/v1/print-control - who printed which key document and when, the
 * status of one document (next print original or duplicate), and the admin's
 * "allow one more original".
 */

const DOCS = {
  INVOICE: { model: Invoice, no: 'invoiceNo', party: 'customerName', label: 'Invoice' },
  CREDIT_NOTE: { model: CreditNote, no: 'creditNoteNo', party: 'customerName', label: 'Credit note' },
  RECEIPT: { model: Payment, no: 'paymentNo', party: 'customerName', label: 'Receipt' },
  PURCHASE_ORDER: { model: PurchaseOrder, no: 'poNo', party: 'supplierName', label: 'Purchase order' },
};

const loadTarget = async (docType, id) => {
  const kind = DOCS[docType];
  const doc = await kind.model.findById(id).select(`${kind.no} ${kind.party} status`).lean();
  if (!doc) throw new NotFoundError(`${kind.label} not found`);
  return { kind, doc };
};

/** GET /print-control - the print history, newest first. */
export const list = asyncHandler(async (req, res) => {
  const { docType, search, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (docType) filter.docType = docType;
  if (search) {
    const rx = searchRegex(search);
    filter.$or = [{ docNo: rx }, { partyName: rx }, { byName: rx }];
  }
  const [rows, total] = await Promise.all([
    PrintLog.find(filter)
      .sort({ at: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PrintLog.countDocuments(filter),
  ]);
  return paginated(res, {
    data: rows.map((r) => ({ ...r, id: String(r._id), docId: String(r.docId) })),
    page,
    limit,
    total,
  });
});

/** GET /print-control/status/:docType/:id - prints so far and what the next one will be. */
export const status = asyncHandler(async (req, res) => {
  if (!hasPermission(req, PRINT_PERMISSION[req.params.docType])) {
    throw new ForbiddenError('You are not allowed to print this document. Ask your admin.', 'PRINT_NOT_ALLOWED');
  }
  await loadTarget(req.params.docType, req.params.id);
  return success(res, { data: await printCounts(req.params.docType, req.params.id) });
});

/** POST /print-control/:docType/:id/grant - the next print of this document is an original again. */
export const grant = asyncHandler(async (req, res) => {
  const { docType, id } = req.params;
  const { kind, doc } = await loadTarget(docType, id);
  const docNo = doc[kind.no] || '';
  await PrintLog.create({
    docType,
    docId: doc._id,
    docNo,
    partyName: doc[kind.party] || '',
    action: 'GRANT',
    by: req.user.id,
    byName: req.user.name || '',
    note: req.body.note || '',
  });
  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: kind.model.modelName,
    entityId: doc._id,
    entityLabel: docNo,
    description: `${kind.label} ${docNo}: one more original print allowed${req.body.note ? ` (${req.body.note})` : ''}`,
  });
  return success(res, {
    message: `The next print of ${kind.label.toLowerCase()} ${docNo} will be an original`,
    data: await printCounts(docType, id),
  });
});

export default { list, status, grant };
