import Warehouse from '../../models/Warehouse.js';
import VanAssignment from '../../models/VanAssignment.js';
import StockBalance from '../../models/StockBalance.js';
import StockMovement from '../../models/StockMovement.js';
import User from '../../models/User.js';
import Setting from '../../models/Setting.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';
import { created, success, paginated } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listDocuments } from '../../utils/query.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { getUserId } from '../../middlewares/tenantContext.js';
import { buildCrudController } from './_crud.js';
import { assertRef, normalizeRefs, markSetup, toPlain } from './_helpers.js';

/**
 * Warehouse master + van-assignment workflow (Phase A).
 *
 * Hierarchy rules enforced here (the model only stores the shape):
 *   MAIN             -> no parent, may be the default
 *   SUB|TRANSIT|DAMAGED -> parent must be an active MAIN
 *   VAN              -> parent must be an active MAIN or SUB
 * A VAN never has children, so the chain is at most MAIN -> SUB -> VAN.
 *
 * Immutability locks (mirroring the financial-settings locks): once a
 * warehouse has stock, movement history or assignment history, its `type`
 * and `parent` can no longer change - re-typing a location that has ledger
 * rows behind it would re-interpret every transaction it ever posted.
 */

/** Parent requirements per type. */
const PARENT_RULES = {
  MAIN: { required: false, parents: [] },
  SUB: { required: true, parents: ['MAIN'] },
  TRANSIT: { required: true, parents: ['MAIN'] },
  DAMAGED: { required: true, parents: ['MAIN'] },
  VAN: { required: true, parents: ['MAIN', 'SUB'] },
};

const TYPE_LABEL = {
  MAIN: 'Main',
  SUB: 'Sub',
  VAN: 'Van',
  TRANSIT: 'Transit',
  DAMAGED: 'Damaged',
};

/** `''`/undefined -> null (only for keys the payload actually carries). */
const refOrNull = (v) => (v === '' || v == null ? null : v);

/** Registration plates are stored tight: no spaces, always upper-case. */
const normVehicle = (v) => (v == null ? '' : String(v).replace(/\s+/g, '').toUpperCase());

/** Re-read the doc inside beforeUpdate (the hook runs before loadDoc). */
const loadForHook = async (id) => {
  const doc = await Warehouse.findOne({ _id: id });
  if (!doc) throw new NotFoundError('Warehouse not found');
  return doc;
};

const hasStock = async (id) =>
  (await StockBalance.countDocuments({ warehouse: id, qty: { $gt: 0 } })) > 0;

const hasMovements = async (id) =>
  (await StockMovement.countDocuments({ warehouse: id })) > 0;

const openAssignments = async (id) =>
  (await VanAssignment.countDocuments({ warehouse: id, active: true })) > 0;

const assignmentHistory = async (id) =>
  (await VanAssignment.countDocuments({ warehouse: id })) > 0;

/**
 * Type + parent become immutable once the warehouse has touched stock,
 * posted a movement or carried a van assignment.
 */
const assertUnlocked = async (doc) => {
  if (await hasStock(doc._id)) {
    throw new ConflictError(
      'This warehouse still has stock. Move it out before changing its type or parent.',
      'WAREHOUSE_LOCKED'
    );
  }
  if (await hasMovements(doc._id)) {
    throw new ConflictError(
      'This warehouse has stock movement history; its type and parent are now locked.',
      'WAREHOUSE_LOCKED'
    );
  }
  if (await assignmentHistory(doc._id)) {
    throw new ConflictError(
      'This van has assignment history; its type and parent are now locked.',
      'WAREHOUSE_LOCKED'
    );
  }
};

/**
 * Enforce the hierarchy rules for the effective (type, parent) pair.
 * `current` is null on create. Returns the normalized parent id or null.
 */
const assertParentRule = async ({ type, parentId, current = null }) => {
  const rules = PARENT_RULES[type];
  if (!rules) throw new BadRequestError(`Unknown warehouse type "${type}"`, 'INVALID_TYPE');

  if (!rules.required) {
    if (parentId) {
      throw new BadRequestError(
        'A main warehouse cannot have a parent warehouse.',
        'WAREHOUSE_PARENT'
      );
    }
    return null;
  }

  if (!parentId) {
    throw new BadRequestError(
      `A ${TYPE_LABEL[type].toLowerCase()} warehouse must be nested under a ${rules.parents
        .map((t) => TYPE_LABEL[t].toLowerCase())
        .join(' or ')} warehouse.`,
      'WAREHOUSE_PARENT'
    );
  }

  const parent = await Warehouse.findOne({ _id: parentId });
  if (!parent) throw new BadRequestError('Parent warehouse not found', 'INVALID_REFERENCE');
  if (current && String(parent._id) === String(current._id)) {
    throw new BadRequestError('A warehouse cannot be its own parent.', 'WAREHOUSE_PARENT');
  }
  if (!rules.parents.includes(parent.type)) {
    throw new BadRequestError(
      `A ${TYPE_LABEL[type].toLowerCase()} warehouse must be nested under a ${rules.parents
        .map((t) => TYPE_LABEL[t].toLowerCase())
        .join(' or ')} warehouse, not a ${TYPE_LABEL[parent.type] || parent.type}.`,
      'WAREHOUSE_PARENT'
    );
  }
  if (parent.isActive === false) {
    throw new BadRequestError('The parent warehouse is inactive.', 'WAREHOUSE_PARENT');
  }
  return String(parent._id);
};

/** Friendly duplicate message ahead of the unique index back-stop. */
const assertVehicleFree = async ({ vehicleNumber, excludeId = null }) => {
  if (!vehicleNumber) return;
  const clash = await Warehouse.findOne({ vehicleNumber });
  if (clash && String(clash._id) !== String(excludeId)) {
    throw new ConflictError(
      `Vehicle number ${vehicleNumber} is already registered to ${clash.code}.`,
      'DUPLICATE'
    );
  }
};

/** Close every open assignment for a van (reassign / deactivate). */
const closeOpenAssignments = async (warehouseId, { toDate = new Date(), reason, closedBy = null } = {}) => {
  await VanAssignment.updateMany(
    { warehouse: warehouseId, active: true },
    { $set: { active: false, toDate, closedAt: new Date(), closedBy, closeNotes: reason } }
  );
};

const crud = buildCrudController({
  Model: Warehouse,
  entityType: 'Warehouse',
  labelField: 'name',
  searchFields: ['name', 'code', 'address.city', 'address.state', 'phone', 'vehicleNumber'],
  filtersSpec: {
    type: { type: 'string' },
    parent: { type: 'objectId' },
    isActive: { type: 'bool' },
  },
  sortAllowed: ['createdAt', 'name', 'code'],
  populate: [
    { path: 'manager', select: 'name email role' },
    { path: 'parent', select: 'name code type' },
  ],
  label: 'Warehouse',
  beforeCreate: async (payload) => {
    const out = normalizeRefs({ ...payload }, ['manager', 'parent']);
    if (out.manager) out.manager = await assertRef(User, out.manager, 'Manager');

    const type = out.type || 'MAIN';
    out.type = type;
    out.parent = await assertParentRule({ type, parentId: out.parent ?? null });

    if (type === 'VAN') {
      out.vehicleNumber = normVehicle(out.vehicleNumber);
      out.vehicleType = out.vehicleType || '';
      await assertVehicleFree({ vehicleNumber: out.vehicleNumber });
    } else {
      // Vehicle fields only ever describe a van.
      out.vehicleNumber = '';
      out.vehicleType = '';
    }

    const existing = await Warehouse.countDocuments({});
    if (existing === 0 && type === 'MAIN') out.isDefault = true;
    if (out.isDefault) {
      if (type !== 'MAIN') {
        throw new BadRequestError(
          'Only the main warehouse can be the default.',
          'DEFAULT_WAREHOUSE'
        );
      }
      await Warehouse.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    }
    return out;
  },
  beforeUpdate: async (payload, req) => {
    const current = await loadForHook(req.params.id);
    const out = normalizeRefs({ ...payload }, ['manager', 'parent']);
    if (out.manager) out.manager = await assertRef(User, out.manager, 'Manager');

    const type = out.type !== undefined ? out.type : current.type;
    const parentChanged =
      out.parent !== undefined && String(out.parent ?? '') !== String(current.parent ?? '');
    const typeChanged = out.type !== undefined && out.type !== current.type;

    // Locks: no re-typing / re-parenting a location with transactions.
    if (typeChanged || parentChanged) await assertUnlocked(current);

    // isDefault may only ever sit on a MAIN warehouse - checked before the
    // parent rule so "retype the default" reports the real reason.
    const willBeDefault = out.isDefault !== undefined ? out.isDefault : current.isDefault;
    if (willBeDefault && type !== 'MAIN') {
      throw new BadRequestError(
        typeChanged
          ? 'The default warehouse must remain a main warehouse.'
          : 'Only the main warehouse can be the default.',
        'DEFAULT_WAREHOUSE'
      );
    }
    if (out.isDefault === true) {
      await Warehouse.updateMany(
        { isDefault: true, _id: { $ne: current._id } },
        { $set: { isDefault: false } }
      );
    }

    out.type = type;
    if (type === 'VAN') {
      if (out.vehicleNumber !== undefined) out.vehicleNumber = normVehicle(out.vehicleNumber);
      await assertVehicleFree({ vehicleNumber: out.vehicleNumber, excludeId: current._id });
    } else {
      out.vehicleNumber = '';
      out.vehicleType = '';
    }
    // Re-validate the hierarchy only when the pair actually moves; an omitted
    // `parent` in a partial update must keep the stored value untouched.
    if (typeChanged || parentChanged) {
      out.parent = await assertParentRule({
        type,
        parentId: out.parent !== undefined ? out.parent : current.parent ?? null,
        current,
      });
    }

    // Deactivation guards (stock must move out first; the default cannot go).
    if (out.isActive === false && current.isActive !== false) {
      if (current.isDefault) {
        throw new BadRequestError(
          'Cannot deactivate the default warehouse. Set another warehouse as default first.',
          'DEFAULT_WAREHOUSE'
        );
      }
      if (await hasStock(current._id)) {
        throw new ConflictError(
          'This warehouse still holds stock. Transfer it out before deactivating.',
          'WAREHOUSE_HAS_STOCK'
        );
      }
    }
    void req;
    return out;
  },
  afterUpdate: async (doc) => {
    // Keep the tenant's resolved default in sync when the flag moves here.
    if (doc.isDefault) {
      await Setting.updateOne({}, { $set: { 'inventory.defaultWarehouse': doc._id } });
    }
    // A deactivated van can no longer be driven - close its open spell.
    if (doc.type === 'VAN' && doc.isActive === false) {
      await closeOpenAssignments(doc._id, {
        reason: 'Van warehouse deactivated',
        closedBy: getUserId(),
      });
    }
  },
  afterCreate: async (doc) => {
    await markSetup('warehouse');
    if (doc.isDefault) {
      await Setting.updateOne({}, { $set: { 'inventory.defaultWarehouse': doc._id } });
    }
  },
  beforeDelete: async (doc) => {
    if (doc.isDefault) {
      throw new BadRequestError(
        'Cannot delete the default warehouse. Set another warehouse as default first.',
        'DEFAULT_WAREHOUSE'
      );
    }
    if (await hasStock(doc._id)) {
      throw new ConflictError(
        'This warehouse still has stock. Transfer it out before deleting.',
        'WAREHOUSE_HAS_STOCK'
      );
    }
    if (await hasMovements(doc._id)) {
      throw new ConflictError(
        'This warehouse has stock movement history and cannot be deleted.',
        'WAREHOUSE_HAS_MOVEMENTS'
      );
    }
    if (await openAssignments(doc._id)) {
      throw new ConflictError(
        'Close the active van assignment before deleting this van.',
        'ASSIGNMENT_ACTIVE'
      );
    }
  },
});

export const { list, get, create, update, remove } = crud;

/** Mark this warehouse as the tenant default (and sync Setting). */
export const setDefault = async (req, res) => {
  const doc = await Warehouse.findOne({ _id: req.params.id });
  if (!doc) {
    throw new NotFoundError('Warehouse not found');
  }
  if (doc.type !== 'MAIN') {
    throw new BadRequestError('Only a main warehouse can be the default.', 'DEFAULT_WAREHOUSE');
  }
  await Warehouse.updateMany({ isDefault: true }, { $set: { isDefault: false } });
  doc.isDefault = true;
  await doc.save();
  await Setting.updateOne({}, { $set: { 'inventory.defaultWarehouse': doc._id } });
  return success(res, { message: 'Default warehouse updated', data: { id: String(doc._id) } });
};

// ---------------------------------------------------------------------------
// Van assignments
// ---------------------------------------------------------------------------

const assignmentPopulate = [
  { path: 'executive', select: 'name email role' },
  { path: 'warehouse', select: 'name code type vehicleNumber' },
  { path: 'assignedBy', select: 'name' },
  { path: 'closedBy', select: 'name' },
];

/** History for one van (newest first). */
export const listAssignments = asyncHandler(async (req, res) => {
  const wh = await Warehouse.findOne({ _id: req.params.id });
  if (!wh) throw new NotFoundError('Warehouse not found');

  const result = await listDocuments(VanAssignment, {
    filter: { warehouse: wh._id },
    query: req.query,
    filtersSpec: {
      active: { type: 'bool' },
      executive: { type: 'objectId' },
    },
    sortAllowed: ['fromDate', 'createdAt'],
    defaultSort: '-fromDate',
    populate: assignmentPopulate,
  });

  return paginated(res, {
    data: result.data.map((d) => toPlain(d)),
    ...result.meta,
  });
});

/**
 * Assign a van to an executive. Reassignment wins: whatever is currently
 * open for this van *or* this executive is closed first, then the new spell
 * opens. The partial unique indexes back-stop concurrent races (E11000 ->
 * 409 ASSIGNMENT_CONFLICT).
 */
export const assign = asyncHandler(async (req, res) => {
  const wh = await Warehouse.findOne({ _id: req.params.id });
  if (!wh) throw new NotFoundError('Warehouse not found');
  if (wh.type !== 'VAN') {
    throw new BadRequestError('Only van warehouses can be assigned.', 'NOT_A_VAN');
  }
  if (wh.isActive === false) {
    throw new BadRequestError('This van is inactive. Activate it first.', 'WAREHOUSE_INACTIVE');
  }

  const executiveId = refOrNull(req.body.executive);
  if (!executiveId) {
    throw new BadRequestError('Executive is required', 'INVALID_REFERENCE');
  }
  const executive = await User.findOne({ _id: executiveId });
  if (!executive) throw new BadRequestError('Executive not found', 'INVALID_REFERENCE');
  if (executive.isActive === false) {
    throw new BadRequestError('That executive is inactive.', 'USER_INACTIVE');
  }

  const fromDate = req.body.fromDate ? new Date(req.body.fromDate) : new Date();
  if (Number.isNaN(fromDate.getTime())) {
    throw new BadRequestError('Enter a valid start date', 'INVALID_DATE');
  }

  const userId = getUserId();

  // Close the previous spells (van and executive sides) before opening a new
  // one so the partial unique indexes stay satisfied.
  await VanAssignment.updateMany(
    { $or: [{ warehouse: wh._id }, { executive: executive._id }], active: true },
    {
      $set: {
        active: false,
        toDate: fromDate,
        closedAt: new Date(),
        closedBy: userId,
        closeNotes: 'Reassigned',
      },
    }
  );

  let doc;
  try {
    doc = await VanAssignment.create({
      warehouse: wh._id,
      executive: executive._id,
      fromDate,
      toDate: null,
      active: true,
      dayCloseMandatory: req.body.dayCloseMandatory ?? true,
      assignedBy: userId,
      notes: req.body.notes || '',
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new ConflictError(
        'This van or executive already has an active assignment.',
        'ASSIGNMENT_CONFLICT'
      );
    }
    throw err;
  }

  audit(req, {
    action: AUDIT_ACTIONS.CREATE,
    entityType: 'VanAssignment',
    entityId: doc._id,
    entityLabel: `${wh.code} -> ${executive.name}`,
    after: toPlain(doc),
    description: `Van "${wh.code}" assigned to ${executive.name}`,
  });

  const full = await VanAssignment.findOne({ _id: doc._id }).populate(assignmentPopulate);
  return created(res, { message: 'Van assigned', data: toPlain(full) });
});

/** Close an open assignment (history is never edited or deleted). */
export const closeAssignment = asyncHandler(async (req, res) => {
  const doc = await VanAssignment.findOne({
    _id: req.params.assignmentId,
    warehouse: req.params.id,
  });
  if (!doc) throw new NotFoundError('Assignment not found');
  if (!doc.active) {
    throw new BadRequestError('That assignment is already closed.', 'ASSIGNMENT_CLOSED');
  }

  const toDate = req.body?.toDate ? new Date(req.body.toDate) : new Date();
  if (Number.isNaN(toDate.getTime())) {
    throw new BadRequestError('Enter a valid close date', 'INVALID_DATE');
  }
  if (toDate.getTime() < new Date(doc.fromDate).getTime()) {
    throw new BadRequestError(
      'The close date cannot be before the start date.',
      'INVALID_DATE'
    );
  }

  const before = toPlain(doc);
  doc.active = false;
  doc.toDate = toDate;
  doc.closedAt = new Date();
  doc.closedBy = getUserId();
  doc.closeNotes = req.body?.closeNotes || '';
  await doc.save();

  audit(req, {
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    entityType: 'VanAssignment',
    entityId: doc._id,
    entityLabel: String(doc._id),
    before,
    after: toPlain(doc),
    description: 'Van assignment closed',
  });

  const full = await VanAssignment.findOne({ _id: doc._id }).populate(assignmentPopulate);
  return success(res, { message: 'Van assignment closed', data: toPlain(full) });
});

export default crud;
