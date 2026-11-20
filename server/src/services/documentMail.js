import { Writable } from 'node:stream';

import { asyncHandler } from '../utils/asyncHandler.js';
import { success } from '../utils/apiResponse.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { audit } from '../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../config/constants.js';
import { isMailConfigured, sendMail } from './mailer.js';

/**
 * Email a sales document (order, invoice, receipt, credit note) with its PDF.
 *
 * The PDF comes from the document's own `/pdf` handler, run against an
 * in-memory response, so the attachment is exactly what "Print / PDF" shows
 * and the same access rules apply (a salesman can only send his own).
 */

/** Run an Express PDF handler and collect what it writes. */
export const renderPdf = (handler, req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    const headers = {};
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    res.setHeader = (k, v) => {
      headers[String(k).toLowerCase()] = v;
    };
    res.getHeader = (k) => headers[String(k).toLowerCase()];
    res.on('finish', () => {
      const name = /filename="([^"]+)"/.exec(headers['content-disposition'] || '')?.[1] || 'document.pdf';
      resolve({ buffer: Buffer.concat(chunks), filename: name });
    });
    res.on('error', reject);
    Promise.resolve(handler(req, res, (err) => (err ? reject(err) : null))).catch(reject);
  });

/**
 * @param {{ pdf: Function, model: import('mongoose').Model, noField: string, label: string, entityType: string }} kind
 */
export const emailDocument = ({ pdf, model, noField, label, entityType }) =>
  asyncHandler(async (req, res) => {
    if (!isMailConfigured()) {
      throw new AppError('Email sending is not set up yet. Ask your service provider, or use "Open in mail app".', {
        status: 503,
        code: 'EMAIL_NOT_SET_UP',
      });
    }
    const doc = await model.findById(req.params.id).select(`${noField} status`).lean();
    if (!doc) throw new NotFoundError(`${label} not found`);

    // An emailed PDF is not a print: it does not use up the original.
    req.printMode = 'email';
    const { buffer, filename } = await renderPdf(pdf, req);
    const company = req.company || {};
    const businessName = company.businessName || company.name || '';
    const number = doc[noField] || '';
    const to = req.body.to;
    const note = String(req.body.message || '').trim();

    const text = [
      'Hello,',
      '',
      `Please find attached ${label.toLowerCase()} ${number}.`,
      ...(note ? ['', note] : []),
      '',
      'Regards,',
      businessName,
      company.phone || '',
    ]
      .filter((l, i, all) => !(l === '' && all[i - 1] === ''))
      .join('\n');

    const result = await sendMail({
      to: to.join(', '),
      subject: `${label} ${number}${businessName ? ` - ${businessName}` : ''}`,
      text,
      replyTo: company.email || undefined,
      attachments: [{ filename, content: buffer, contentType: 'application/pdf' }],
    });
    if (!result.sent) {
      throw new AppError('The email could not be sent. Please try again in a while.', { status: 502, code: 'EMAIL_FAILED' });
    }

    audit(req, {
      action: AUDIT_ACTIONS.EXPORT,
      entityType,
      entityId: doc._id,
      entityLabel: number,
      description: `${label} ${number} emailed to ${to.join(', ')}`,
    });
    return success(res, { message: `${label} emailed to ${to.join(', ')}`, data: { to } });
  });

export default { renderPdf, emailDocument };
