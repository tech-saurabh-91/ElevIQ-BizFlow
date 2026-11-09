import PriceList from '../../models/PriceList.js';
import Product from '../../models/Product.js';
import { BadRequestError } from '../../utils/errors.js';
import { buildCrudController } from './_crud.js';
import { autoCode, dateOrNull } from './_helpers.js';
import { dayKey, DEFAULT_TZ } from '../../services/fieldForceService.js';

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

// 'YYYY-MM-DD' as sent by the form, else the company-local day of a date.
const dayOf = (value, tz) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dayKey(new Date(value), tz);
};

/** A price list cannot start in the past; an existing start date may stay as it is. */
const assertValidFrom = (validFrom, req, current = null) => {
  if (!validFrom) return;
  const tz = req.company?.timezone || DEFAULT_TZ;
  const day = dayOf(validFrom, tz);
  if (current && day === dayOf(current, tz)) return;
  if (day < dayKey(new Date(), tz)) {
    throw new BadRequestError('Valid from cannot be a past date', 'VALIDATION_ERROR', [
      { field: 'validFrom', message: 'Valid from cannot be a past date' },
    ]);
  }
};

const clean = async (payload) => {
  const out = { ...payload };
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
    assertValidFrom(payload.validFrom, req);
    const out = await clean(payload);
    out.code = await autoCode(req, 'PRICELIST', 'PL', 4);
    out.currency = req.company?.currency || 'INR';
    return out;
  },
  beforeUpdate: async (payload, req) => {
    if (payload.validFrom) {
      const current = await PriceList.findById(req.params.id).select('validFrom').lean();
      assertValidFrom(payload.validFrom, req, current?.validFrom);
    }
    return clean(payload);
  },
});

export const { list, get, create, update, remove } = crud;

export default crud;
