import Customer from '../../models/Customer.js';
import Route from '../../models/Route.js';
import Warehouse from '../../models/Warehouse.js';
import PriceList from '../../models/PriceList.js';
import User from '../../models/User.js';
import { escapeRegex } from '../../utils/query.js';
import { buildCrudController } from './_crud.js';
import {
  salesScope,
  autoCode,
  markSetup,
  assertRef,
  normalizeRefs,
  assertLimit,
} from './_helpers.js';

const REFS = ['route', 'warehouse', 'priceList', 'assignedTo'];

const validateRefs = async (payload) => {
  const out = normalizeRefs(payload, REFS);

  if (out.route !== undefined) out.route = await assertRef(Route, out.route, 'Route');
  if (out.warehouse !== undefined) out.warehouse = await assertRef(Warehouse, out.warehouse, 'Warehouse');
  if (out.priceList !== undefined) out.priceList = await assertRef(PriceList, out.priceList, 'Price list');
  if (out.assignedTo !== undefined) out.assignedTo = await assertRef(User, out.assignedTo, 'Salesman');

  return out;
};

const crud = buildCrudController({
  Model: Customer,
  entityType: 'Customer',
  labelField: 'name',
  searchFields: ['name', 'code', 'phone', 'email', 'gstin', 'contactPerson', 'address.city'],
  filtersSpec: {
    type: { type: 'string' },
    isActive: { type: 'bool' },
    route: { type: 'objectId' },
    assignedTo: { type: 'objectId' },
    priceList: { type: 'objectId' },
    territory: { type: 'string' },
  },
  sortAllowed: ['createdAt', 'name', 'code', 'outstanding', 'creditLimit', 'lastOrderAt'],
  populate: [
    { path: 'route', select: 'name code' },
    { path: 'warehouse', select: 'name code' },
    { path: 'priceList', select: 'name code type' },
    { path: 'assignedTo', select: 'name email role' },
  ],
  label: 'Customer',
  listFilter: (req) => {
    const filter = { ...salesScope(req) };
    if (req.query.city) filter['address.city'] = new RegExp(escapeRegex(req.query.city), 'i');
    return filter;
  },
  detailFilter: (req) => ({ ...salesScope(req) }),
  beforeCreate: async (payload, req) => {
    const limit = req.company?.limits?.maxCustomers;
    if (limit) {
      const current = await Customer.countDocuments({});
      await assertLimit(
        req,
        current,
        limit,
        `Customer limit reached (${limit}). Upgrade your plan to add more customers.`
      );
    }

    const out = await validateRefs(payload);
    if (!out.code) out.code = await autoCode(req, 'CUSTOMER', 'CUS', 5);
    if (out.outstanding === undefined) out.outstanding = out.openingBalance ?? 0;
    return out;
  },
  beforeUpdate: async (payload) => validateRefs(payload),
  beforeDelete: async (doc, req) => {
    const orders = doc.totalOrders || 0;
    if (orders > 0) {
      const { BadRequestError } = await import('../../utils/errors.js');
      throw new BadRequestError(
        'Customer has transactions and cannot be deleted. Mark it inactive instead.',
        'CUSTOMER_HAS_TRANSACTIONS'
      );
    }
    void req;
  },
  afterCreate: async () => {
    await markSetup('customers');
  },
});

export const { list, get, create, update, remove } = crud;

export default crud;
