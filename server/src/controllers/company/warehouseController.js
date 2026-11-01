import Warehouse from '../../models/Warehouse.js';
import User from '../../models/User.js';
import Setting from '../../models/Setting.js';
import { BadRequestError, NotFoundError } from '../../utils/errors.js';
import { success } from '../../utils/apiResponse.js';
import { buildCrudController } from './_crud.js';
import { assertRef, normalizeRefs, markSetup } from './_helpers.js';

const crud = buildCrudController({
  Model: Warehouse,
  entityType: 'Warehouse',
  labelField: 'name',
  searchFields: ['name', 'code', 'address.city', 'address.state', 'phone'],
  filtersSpec: {
    type: { type: 'string' },
    isActive: { type: 'bool' },
  },
  sortAllowed: ['createdAt', 'name', 'code'],
  populate: [{ path: 'manager', select: 'name email role' }],
  label: 'Warehouse',
  beforeCreate: async (payload, req) => {
    const out = normalizeRefs({ ...payload }, ['manager']);
    if (out.manager) out.manager = await assertRef(User, out.manager, 'Manager');

    const existing = await Warehouse.countDocuments({});
    if (existing === 0) out.isDefault = true;
    if (out.isDefault) {
      await Warehouse.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    }
    void req;
    return out;
  },
  beforeUpdate: async (payload) => {
    const out = normalizeRefs({ ...payload }, ['manager']);
    if (out.manager) out.manager = await assertRef(User, out.manager, 'Manager');
    if (out.isDefault === true) {
      await Warehouse.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    }
    return out;
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
  },
});

export const { list, get, create, update, remove } = crud;

/** Mark this warehouse as the tenant default (and sync Setting). */
export const setDefault = async (req, res) => {
  const doc = await Warehouse.findOne({ _id: req.params.id });
  if (!doc) {
    throw new NotFoundError('Warehouse not found');
  }
  await Warehouse.updateMany({ isDefault: true }, { $set: { isDefault: false } });
  doc.isDefault = true;
  await doc.save();
  await Setting.updateOne({}, { $set: { 'inventory.defaultWarehouse': doc._id } });
  return success(res, { message: 'Default warehouse updated', data: { id: String(doc._id) } });
};

export default crud;
