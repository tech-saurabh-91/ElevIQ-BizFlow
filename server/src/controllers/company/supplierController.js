import Supplier from '../../models/Supplier.js';
import { buildCrudController } from './_crud.js';
import { autoCode } from './_helpers.js';

const crud = buildCrudController({
  Model: Supplier,
  entityType: 'Supplier',
  labelField: 'name',
  searchFields: ['name', 'code', 'phone', 'email', 'gstin', 'contactPerson'],
  filtersSpec: {
    isActive: { type: 'bool' },
  },
  sortAllowed: ['createdAt', 'name', 'code', 'outstanding'],
  label: 'Supplier',
  beforeCreate: async (payload, req) => {
    const out = { ...payload };
    if (!out.code) out.code = await autoCode(req, 'SUPPLIER', 'SUP', 5);
    if (out.outstanding === undefined) out.outstanding = out.openingBalance ?? 0;
    return out;
  },
});

export const { list, get, create, update, remove } = crud;

export default crud;
