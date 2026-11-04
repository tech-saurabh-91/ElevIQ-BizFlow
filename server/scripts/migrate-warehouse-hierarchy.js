import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import logger from '../src/utils/logger.js';
import Company from '../src/models/Company.js';
import Setting from '../src/models/Setting.js';
import Warehouse from '../src/models/Warehouse.js';
import VanAssignment from '../src/models/VanAssignment.js';

/**
 * Phase A migration: warehouse hierarchy + van tracking.
 *
 *  1. BRANCH  -> SUB             (the type was folded into SUB)
 *  2. nest orphan children       (SUB/TRANSIT/DAMAGED/VAN without a parent
 *                                 is placed under the tenant's default MAIN)
 *  3. heal the default invariant (a non-MAIN default moves to the earliest
 *                                 MAIN, and Setting.inventory follows)
 *  4. ensure the new unique indexes exist (autoIndex is off in production)
 *
 * Safe to re-run: every step is idempotent. Tenant scoping is explicit
 * (companyId in every filter + .skipTenant()), because this script runs
 * outside a request context.
 */

const CHILD_TYPES = ['SUB', 'TRANSIT', 'DAMAGED', 'VAN'];

const migrateCompany = async (company) => {
  const scope = { companyId: company._id, isDeleted: { $ne: true } };

  // 1. Legacy BRANCH rows become SUB.
  const renamed = await Warehouse.updateMany(
    { ...scope, type: 'BRANCH' },
    { $set: { type: 'SUB' } }
  ).skipTenant();

  // 2. Pick the default MAIN (then any MAIN, then anything) as backfill parent.
  const pick = async (extra) => {
    const [doc] = await Warehouse.find({ ...scope, ...extra })
      .sort({ isDefault: -1, createdAt: 1 })
      .select('_id')
      .limit(1)
      .skipTenant()
      .lean();
    return doc || null;
  };
  const fallbackParent = (await pick({ type: 'MAIN', isDefault: true })) || (await pick({ type: 'MAIN' })) || (await pick({}));

  let nested = { modifiedCount: 0 };
  if (fallbackParent?._id) {
    nested = await Warehouse.updateMany(
      { ...scope, type: { $in: CHILD_TYPES }, $or: [{ parent: null }, { parent: { $exists: false } }] },
      { $set: { parent: fallbackParent._id } }
    ).skipTenant();
  }

  // 3. Default invariant: isDefault only ever sits on a MAIN warehouse.
  const def = await Warehouse.findOne({ ...scope, isDefault: true })
    .sort({ createdAt: 1 })
    .skipTenant();
  let healedDefault = false;
  if (def && def.type !== 'MAIN') {
    const main = await Warehouse.findOne({ ...scope, type: 'MAIN' })
      .sort({ createdAt: 1 })
      .skipTenant();
    if (main) {
      await Warehouse.updateMany({ ...scope, isDefault: true }, { $set: { isDefault: false } }).skipTenant();
      await Warehouse.updateOne({ ...scope, _id: main._id }, { $set: { isDefault: true } }).skipTenant();
      await Setting.updateOne(
        { companyId: company._id },
        { $set: { 'inventory.defaultWarehouse': main._id } }
      ).skipTenant();
      healedDefault = true;
    } else {
      logger.warn(
        `[warehouse-migration] ${company.code}: default warehouse "${def.code}" is ${def.type} and no MAIN exists - leaving as-is.`
      );
    }
  }

  return { renamed: renamed.modifiedCount || 0, nested: nested.modifiedCount || 0, healedDefault };
};

const run = async () => {
  await connectDB();
  try {
    const companies = await Company.find({}).skipTenant().select('code businessName').lean();
    logger.info(`[warehouse-migration] ${companies.length} company/companies to scan.`);

    for (const company of companies) {
      const r = await migrateCompany(company);
      logger.info(
        `[warehouse-migration] ${company.code}: ${r.renamed} BRANCH->SUB, ${r.nested} re-parented, default healed=${r.healedDefault}.`
      );
    }

    // 4. Build the new unique indexes (prod runs with autoIndex off).
    await Warehouse.init();
    await VanAssignment.init();
    logger.info('[warehouse-migration] Warehouse + VanAssignment indexes ensured.');
    logger.info('[warehouse-migration] Done.');
  } finally {
    await disconnectDB();
  }
};

run().catch((err) => {
  logger.error('[warehouse-migration] Failed: ' + (err?.stack || err));
  process.exitCode = 1;
});
