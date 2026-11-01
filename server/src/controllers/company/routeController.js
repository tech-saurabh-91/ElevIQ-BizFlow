import Route from '../../models/Route.js';
import Warehouse from '../../models/Warehouse.js';
import User from '../../models/User.js';
import { buildCrudController } from './_crud.js';
import { autoCode, assertRef, normalizeRefs } from './_helpers.js';

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

export default crud;
