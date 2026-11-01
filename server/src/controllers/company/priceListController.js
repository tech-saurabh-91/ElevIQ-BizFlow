import PriceList from '../../models/PriceList.js';
import Product from '../../models/Product.js';
import { BadRequestError } from '../../utils/errors.js';
import { buildCrudController } from './_crud.js';
import { autoCode, dateOrNull } from './_helpers.js';

const validateItems = async (items = []) => {
  if (!items.length) return items;
  const ids = [...new Set(items.map((i) => String(i.product)))];
  const found = await Product.find({ _id: { $in: ids } }).select('_id').lean();
  const foundIds = new Set(found.map((p) => String(p._id)));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length) {
    throw new BadRequestError(`Unknown product(s) in price list: ${missing.join(', ')}`, 'INVALID_REFERENCE');
  }
  return items;
};

const clean = async (payload) => {
  const out = { ...payload };
  if (out.currency === '') delete out.currency;
  if ('validFrom' in out) out.validFrom = dateOrNull(out.validFrom);
  if ('validTo' in out) out.validTo = dateOrNull(out.validTo);
  if (out.items) out.items = await validateItems(out.items);
  return out;
};

const crud = buildCrudController({
  Model: PriceList,
  entityType: 'PriceList',
  labelField: 'name',
  searchFields: ['name', 'code', 'description'],
  filtersSpec: {
    type: { type: 'string' },
    isActive: { type: 'bool' },
  },
  sortAllowed: ['createdAt', 'name', 'code'],
  label: 'Price list',
  beforeCreate: async (payload, req) => {
    const out = await clean(payload);
    if (!out.code) out.code = await autoCode(req, 'PRICELIST', 'PL', 4);
    return out;
  },
  beforeUpdate: async (payload) => clean(payload),
});

export const { list, get, create, update, remove } = crud;

export default crud;
