import Order from '../models/Order.js';
import Invoice from '../models/Invoice.js';
import Payment from '../models/Payment.js';
import CreditNote from '../models/CreditNote.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import { AppError } from '../utils/errors.js';

/**
 * Settings that must not change once a company has transactions.
 *
 * HARD: changing them would re-interpret money, numbering or tax already on
 *   saved documents (currency, country, financial year, tax regime). Nobody can
 *   change them after the first transaction, not even the platform.
 * SUPPORT: legitimate corrections exist (registration number fixed, office
 *   moved), so the service provider may change them, never the company admin.
 *   Inside the company workspace that means an impersonation session.
 */
export const HARD_LOCKED = {
  currency: 'Currency',
  country: 'Country',
  financialYearStartMonth: 'Financial year start',
  taxRegime: 'Tax regime',
};

export const SUPPORT_LOCKED = {
  gstin: 'Tax registration number',
  state: 'Registered state',
  placeOfSupply: 'Place of supply',
  taxInclusive: 'Prices include tax',
  splitTax: 'CGST/SGST split',
};

const TRANSACTION_MODELS = [Order, Invoice, Payment, CreditNote, PurchaseOrder];

/** Number of transactions (any status) the company has. 0 = nothing locked yet. */
export const countTransactions = async (companyId) => {
  const filter = { companyId, isDeleted: { $ne: true } };
  const counts = await Promise.all(TRANSACTION_MODELS.map((M) => M.countDocuments(filter).skipTenant()));
  return counts.reduce((a, b) => a + b, 0);
};

export const lockInfo = async (companyId) => {
  const transactions = await countTransactions(companyId);
  return {
    locked: transactions > 0,
    transactions,
    hard: transactions ? Object.keys(HARD_LOCKED) : [],
    support: transactions ? Object.keys(SUPPORT_LOCKED) : [],
  };
};

const norm = (v) => (v === undefined || v === null ? '' : String(v).trim().toLowerCase());

/**
 * Throw 409 SETTING_LOCKED when `next` changes a locked value of `current`.
 * Both are flat maps keyed like HARD_LOCKED / SUPPORT_LOCKED; keys missing
 * from `next` are not being changed.
 *
 * @param {object} opts.errorPaths - key -> client field path for inline errors
 * @param {boolean} opts.allowSupport - service-provider edit (platform/impersonation)
 */
export const assertUnlocked = async (companyId, current, next, { errorPaths = {}, allowSupport = false } = {}) => {
  const changed = Object.keys(next).filter((k) => next[k] !== undefined && norm(next[k]) !== norm(current[k]));
  if (!changed.length) return;

  const blocked = changed.filter((k) => k in HARD_LOCKED || (!allowSupport && k in SUPPORT_LOCKED));
  if (!blocked.length) return;

  const transactions = await countTransactions(companyId);
  if (!transactions) return;

  const label = (k) => HARD_LOCKED[k] || SUPPORT_LOCKED[k];
  const errors = blocked.map((k) => ({
    field: errorPaths[k] || `body.${k}`,
    message:
      k in HARD_LOCKED
        ? `${label(k)} cannot change after transactions exist`
        : `${label(k)} can only be changed by your service provider`,
  }));
  throw new AppError(
    `${blocked.map(label).join(', ')} ${blocked.length > 1 ? 'are' : 'is'} locked: this company already has ${transactions} transaction(s).`,
    { status: 409, code: 'SETTING_LOCKED', errors }
  );
};

export default { HARD_LOCKED, SUPPORT_LOCKED, countTransactions, lockInfo, assertUnlocked };
