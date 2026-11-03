import Route from '../../models/Route.js';
import Customer from '../../models/Customer.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { BadRequestError } from '../../utils/errors.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import Warehouse from '../../models/Warehouse.js';
import User from '../../models/User.js';
import { buildCrudController } from './_crud.js';
import { autoCode, assertRef, normalizeRefs, loadDoc } from './_helpers.js';

const crud = buildCrudController({
  Model: Route,
  entityType: 'Route',
  labelField: 'name',
  searchFields: ['name', 'code', 'territory', 'description'],
  filtersSpec: {
    isActive: { type: 'bool' },
    assignedTo: { type: 'objectId' },
    territory: { type: 'string' },
  },
  sortAllowed: ['createdAt', 'name', 'code', 'sequence'],
  populate: [
    { path: 'warehouse', select: 'name code' },
    { path: 'assignedTo', select: 'name email role' },
  ],
  label: 'Route',
  beforeCreate: async (payload, req) => {
    const out = normalizeRefs({ ...payload }, ['warehouse', 'assignedTo']);
    if (out.warehouse) out.warehouse = await assertRef(Warehouse, out.warehouse, 'Warehouse');
    if (out.assignedTo) out.assignedTo = await assertRef(User, out.assignedTo, 'Salesman');
    if (!out.code) out.code = await autoCode(req, 'ROUTE', 'RTE', 4);
    return out;
  },
  beforeUpdate: async (payload) => {
    const out = normalizeRefs({ ...payload }, ['warehouse', 'assignedTo']);
    if (out.warehouse) out.warehouse = await assertRef(Warehouse, out.warehouse, 'Warehouse');
    if (out.assignedTo) out.assignedTo = await assertRef(User, out.assignedTo, 'Salesman');
    return out;
  },
});

export const { list, get, create, update, remove } = crud;

const customerRow = (c) => ({
  id: String(c._id),
  code: c.code,
  name: c.name,
  phone: c.phone || '',
  city: c.address?.city || '',
  isActive: c.isActive !== false,
});

/** GET /routes/:id/customers - the customers on this beat. */
export const customers = asyncHandler(async (req, res) => {
  const route = await loadDoc(Route, req.params.id, { label: 'Route' });
  const rows = await Customer.find({ route: route._id }).select('code name phone address.city isActive').sort({ name: 1 }).lean();
  return success(res, { data: rows.map(customerRow) });
});

/**
 * PUT /routes/:id/customers { customerIds } - set exactly which customers are
 * on this beat. Customers added here leave their previous route.
 */
export const setCustomers = asyncHandler(async (req, res) => {
  const route = await loadDoc(Route, req.params.id, { label: 'Route' });
  const ids = [...new Set((req.body.customerIds || []).map(String))];
  const found = await Customer.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) throw new BadRequestError('One or more customers do not exist', 'INVALID_REFERENCE');

  const removed = await Customer.updateMany({ route: route._id, _id: { $nin: ids } }, { $set: { route: null } });
  const added = await Customer.updateMany({ _id: { $in: ids } }, { $set: { route: route._id } });

  audit(req, {
    action: AUDIT_ACTIONS.UPDATE,
    entityType: 'Route',
    entityId: route._id,
    entityLabel: route.name,
    description: `Route "${route.name}" now has ${ids.length} customers`,
  });
  return success(res, {
    message: 'Route customers updated',
    data: { count: ids.length, added: added.modifiedCount || 0, removed: removed.modifiedCount || 0 },
  });
});

export default crud;
