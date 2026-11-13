import Supplier from '../../models/Supplier.js';
import { buildCrudController } from './_crud.js';
import { autoCode } from './_helpers.js';
import { assertIdentity, panFromGstin } from '../../services/identityRules.js';

// Same contact / tax rules as the company itself (India: GSTIN, PAN, IFSC).
const PATHS = {
  phone: 'phone',
  website: 'website',
  gstin: 'gstin',
  pan: 'pan',
  state: 'address.state',
  ifsc: 'bank.ifsc',
  account: 'bank.accountNumber',
};
const valuesOf = (s, req) => ({
  phone: s.phone,
  website: s.website,
  gstin: s.gstin,
  pan: s.pan,
  state: s.address?.state,
  country: s.address?.country || req.company?.address?.country,
  ifsc: s.bank?.ifsc,
  account: s.bank?.accountNumber,
});
const changedOf = (p) =>
  new Set([
    ...['phone', 'website', 'gstin', 'pan'].filter((k) => p[k] !== undefined),
    ...(p.address?.state !== undefined || p.address?.country !== undefined ? ['state'] : []),
    ...(p.bank?.ifsc !== undefined ? ['ifsc'] : []),
    ...(p.bank?.accountNumber !== undefined ? ['account'] : []),
  ]);
const normalise = (out) => {
  if (out.gstin !== undefined) out.gstin = String(out.gstin || '').trim().toUpperCase();
  const pan = panFromGstin(out.gstin, out.pan);
  if (pan || out.pan !== undefined) out.pan = pan;
  if (out.bank?.ifsc) out.bank = { ...out.bank, ifsc: out.bank.ifsc.trim().toUpperCase() };
  return out;
};

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
    await assertIdentity(valuesOf(payload, req), PATHS);
    const out = normalise({ ...payload });
    if (!out.code) out.code = await autoCode(req, 'SUPPLIER', 'SUP', 5);
    if (out.outstanding === undefined) out.outstanding = out.openingBalance ?? 0;
    return out;
  },
  beforeUpdate: async (payload, req) => {
    const current = (await Supplier.findById(req.params.id).lean()) || {};
    const merged = {
      ...current,
      ...payload,
      address: { ...(current.address || {}), ...(payload.address || {}) },
      bank: { ...(current.bank || {}), ...(payload.bank || {}) },
    };
    await assertIdentity(valuesOf(merged, req), PATHS, changedOf(payload));
    return normalise({ ...payload });
  },
});

export const { list, get, create, update, remove } = crud;

export default crud;
