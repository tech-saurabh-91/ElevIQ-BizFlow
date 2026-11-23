import crypto from 'node:crypto';
import zlib from 'node:zlib';
import mongoose from 'mongoose';
import dayjs from 'dayjs';

import { AppError, BadRequestError, ConflictError, NotFoundError } from '../utils/errors.js';
import { COMPANY_STATUS } from '../config/constants.js';

/**
 * Company data backup, purge and restore (provider / super admin only).
 *
 * BACKUP   every record of one company - the company itself, every tenant
 *          collection (masters, documents, stock ledger, users, settings,
 *          audit trail...), its document number counters, subscriptions and
 *          subscription payments - into one gzip'd Extended-JSON file. Ids,
 *          dates and numbers keep their exact types, so a restore puts back
 *          the very same records and every link between them still works.
 * PURGE    after a recent backup, removes every one of those records for
 *          good. Only for a company that is no longer active. The company row
 *          stays (marked purged) so its code is not given to someone else and
 *          the backup can be restored under it later.
 * RESTORE  loads a backup file back. Records already present are skipped, so
 *          re-running a restore that stopped half way finishes it.
 *
 * The raw MongoDB driver is used throughout: tenant hooks (soft delete,
 * company filter) must not touch a backup copy.
 *
 * Not included: uploaded files on the server's disk (images, receipts) and
 * login sessions.
 */

const { EJSON } = mongoose.mongo.BSON;
export const BACKUP_FORMAT = 'eleviq-company-backup';
export const BACKUP_VERSION = 1;
/** A purge needs a backup taken within this many hours. */
export const BACKUP_FRESH_HOURS = 24;

// Collections that hold a company's records but must not travel in a backup.
const NOT_IN_BACKUP = new Set(['Company', 'PlatformAuditLog', 'Announcement', 'Session']);

const db = () => mongoose.connection.db;
const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** { modelName: collectionName } of every collection keyed by companyId. */
export const tenantCollections = () => {
  const out = {};
  mongoose.modelNames().forEach((name) => {
    const model = mongoose.model(name);
    if (NOT_IN_BACKUP.has(name) || !model.schema.path('companyId')) return;
    out[name] = model.collection.collectionName;
  });
  return out;
};

const counterFilter = (companyId) => ({ _id: { $regex: `^${String(companyId)}:` } });
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const loadCompany = async (companyId) => {
  const company = await db().collection('companies').findOne({ _id: oid(companyId) });
  if (!company) throw new NotFoundError('Company not found', 'COMPANY_NOT_FOUND');
  return company;
};

/** How many records the company has in each collection. */
export const countRecords = async (companyId) => {
  const id = oid(companyId);
  const counts = {};
  for (const [name, collection] of Object.entries(tenantCollections())) {
    const n = await db().collection(collection).countDocuments({ companyId: id });
    if (n) counts[name] = n;
  }
  const counters = await db().collection('counters').countDocuments(counterFilter(id));
  if (counters) counts.Counter = counters;
  return counts;
};

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/**
 * Build the backup file of one company.
 * @returns {{ buffer: Buffer, filename: string, sha256: string, records: number, counts: object }}
 */
export const buildBackup = async (companyId, actor = {}) => {
  const company = await loadCompany(companyId);
  if (company.purgedAt) throw new ConflictError('This company was purged: restore its backup first', 'COMPANY_PURGED');
  const id = company._id;

  const collections = {};
  const counts = {};
  for (const [name, collection] of Object.entries(tenantCollections())) {
    const docs = await db().collection(collection).find({ companyId: id }).toArray();
    if (docs.length) {
      collections[name] = { collection, docs };
      counts[name] = docs.length;
    }
  }
  const counters = await db().collection('counters').find(counterFilter(id)).toArray();
  if (counters.length) {
    collections.Counter = { collection: 'counters', docs: counters };
    counts.Counter = counters.length;
  }

  const records = Object.values(counts).reduce((s, n) => s + n, 0);
  // The checksum covers the data; the header says what it is.
  const data = EJSON.stringify({ company, collections }, { relaxed: false });
  const header = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    createdBy: actor.email || actor.name || '',
    company: { id: String(id), code: company.code, name: company.businessName, status: company.status },
    counts,
    records,
    sha256: sha256(data),
  };
  const text = `{"header":${JSON.stringify(header)},"data":${data}}`;
  const buffer = zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 });

  await db()
    .collection('companies')
    .updateOne(
      { _id: id },
      { $set: { dataBackup: { lastAt: new Date(), lastBy: header.createdBy, sha256: header.sha256, bytes: buffer.length, records } } }
    );

  const filename = `backup-${company.code}-${dayjs().format('YYYYMMDD-HHmm')}.json.gz`;
  return { buffer, filename, sha256: header.sha256, records, counts, company };
};

/** Read and check a backup file. Throws on anything that is not a sound backup. */
export const readBackup = (buffer) => {
  let text;
  try {
    text = zlib.gunzipSync(buffer).toString('utf8');
  } catch {
    throw new BadRequestError('This is not a backup file (it could not be unzipped)', 'INVALID_BACKUP');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequestError('The backup file is damaged (it is not valid JSON)', 'INVALID_BACKUP');
  }
  const { header } = parsed || {};
  if (header?.format !== BACKUP_FORMAT) throw new BadRequestError('This is not an ElevIQ company backup', 'INVALID_BACKUP');
  if (Number(header.version) > BACKUP_VERSION) {
    throw new BadRequestError('This backup was made by a newer version of the app', 'INVALID_BACKUP');
  }
  // The data part exactly as written: after `{"header":<header>,"data":`, before the last `}`.
  const start = '{"header":'.length + JSON.stringify(header).length + ',"data":'.length;
  const dataText = text.slice(start, -1);
  if (sha256(dataText) !== header.sha256) {
    throw new BadRequestError('The backup file is damaged (checksum does not match)', 'INVALID_BACKUP');
  }
  const data = EJSON.parse(dataText, { relaxed: false });
  return { header, data };
};

// ---------------------------------------------------------------------------
// Purge
// ---------------------------------------------------------------------------

const LIVE_STATUSES = [COMPANY_STATUS.ACTIVE, COMPANY_STATUS.TRIAL];

/** Why the company cannot be purged now ('' = it can). */
export const purgeBlocker = (company, now = new Date()) => {
  if (company.purgedAt) return 'Its data was already purged';
  if (LIVE_STATUSES.includes(company.status)) return 'Suspend or cancel the company first';
  const last = company.dataBackup?.lastAt;
  if (!last) return 'Download a backup first';
  if (dayjs(now).diff(dayjs(last), 'hour', true) > BACKUP_FRESH_HOURS) {
    return `The last backup is older than ${BACKUP_FRESH_HOURS} hours: download a fresh one first`;
  }
  return '';
};

/**
 * Remove every record of the company (after a fresh backup).
 * @param {{ confirmCode: string }} input  the company code typed by the user
 */
export const purgeCompany = async (companyId, { confirmCode }, actor = {}) => {
  const company = await loadCompany(companyId);
  const blocker = purgeBlocker(company);
  if (blocker) throw new ConflictError(blocker, 'PURGE_NOT_ALLOWED');
  if (String(confirmCode || '').trim().toUpperCase() !== company.code) {
    throw new AppError('Type the company code exactly to confirm', {
      status: 422,
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'confirmCode', message: `Type ${company.code} to confirm` }],
    });
  }
  const id = company._id;
  const removed = {};
  for (const [name, collection] of Object.entries(tenantCollections())) {
    const res = await db().collection(collection).deleteMany({ companyId: id });
    if (res.deletedCount) removed[name] = res.deletedCount;
  }
  const counters = await db().collection('counters').deleteMany(counterFilter(id));
  if (counters.deletedCount) removed.Counter = counters.deletedCount;
  // Nobody stays signed in to a company that no longer has users.
  const sessions = await db().collection('sessions').deleteMany({ companyId: id });
  if (sessions.deletedCount) removed.Session = sessions.deletedCount;

  await db()
    .collection('companies')
    .updateOne({ _id: id }, { $set: { purgedAt: new Date(), purgedBy: actor.email || actor.name || '', status: COMPANY_STATUS.CANCELLED } });
  const records = Object.entries(removed)
    .filter(([k]) => k !== 'Session')
    .reduce((s, [, n]) => s + n, 0);
  return { company, removed, records };
};

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

const BATCH = 1000;

/**
 * Check a backup against the database; with `apply`, load it.
 * @returns {{ header, company, conflicts: string[], counts, inserted?, skipped? }}
 */
export const restoreBackup = async (buffer, { apply = false } = {}) => {
  const { header, data } = readBackup(buffer);
  const backupCompany = data.company;
  const id = backupCompany._id;
  const companies = db().collection('companies');
  const existing = await companies.findOne({ _id: id });

  // Another company took the code or slug meanwhile: restoring would clash.
  const conflicts = [];
  const clash = await companies.findOne({ _id: { $ne: id }, $or: [{ code: backupCompany.code }, { slug: backupCompany.slug }] });
  if (clash) conflicts.push(`Code ${backupCompany.code} or its web address is now used by ${clash.businessName} (${clash.code})`);
  // A company that is still running with its own data is never overwritten.
  if (existing && !existing.purgedAt) {
    const live = await countRecords(id);
    if (Object.keys(live).length) conflicts.push(`${existing.businessName} (${existing.code}) still has its data: restore is only for a purged or removed company`);
  }

  const result = { header, company: { id: String(id), code: backupCompany.code, name: backupCompany.businessName, exists: Boolean(existing) }, conflicts, counts: header.counts };
  if (!apply) return result;
  if (conflicts.length) throw new ConflictError(conflicts[0], 'RESTORE_CONFLICT');

  // The company row: back to how it was, marked restored.
  const { _id: _ignore, ...fields } = backupCompany;
  await companies.updateOne(
    { _id: id },
    { $set: { ...fields, purgedAt: null, purgedBy: '', restoredAt: new Date(), isDeleted: false } },
    { upsert: true }
  );

  let inserted = 0;
  let skipped = 0;
  for (const { collection, docs } of Object.values(data.collections || {})) {
    for (let i = 0; i < docs.length; i += BATCH) {
      const chunk = docs.slice(i, i + BATCH);
      try {
        const res = await db().collection(collection).insertMany(chunk, { ordered: false });
        inserted += res.insertedCount;
      } catch (err) {
        // Records already there (a restore run twice): keep them, count them.
        const ok = err?.result?.insertedCount ?? err?.insertedCount ?? 0;
        const dupes = (err?.writeErrors || []).filter((e) => (e.code ?? e.err?.code) === 11000).length;
        const others = (err?.writeErrors || []).length - dupes;
        if (!err?.writeErrors || others > 0) throw err;
        inserted += ok;
        skipped += dupes;
      }
    }
  }
  return { ...result, inserted, skipped };
};

export default { tenantCollections, countRecords, buildBackup, readBackup, purgeBlocker, purgeCompany, restoreBackup, BACKUP_FRESH_HOURS };
