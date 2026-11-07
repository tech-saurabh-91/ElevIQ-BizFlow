import DiscountRule from '../../models/DiscountRule.js';
import Scheme from '../../models/Scheme.js';
import Customer from '../../models/Customer.js';
import Product from '../../models/Product.js';
import PriceList from '../../models/PriceList.js';
import Setting from '../../models/Setting.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { BadRequestError } from '../../utils/errors.js';
import { hasPermission } from '../../middlewares/rbac.js';
import { buildCrudController } from './_crud.js';
import { autoCode, dateOrNull, refOrNull, toPlain } from './_helpers.js';
import { buildSaleLines, loadPricingContext, schemeSummary } from '../../services/pricingService.js';

/**
 * Discount master + trade schemes (CRUD) and the pricing preview the order /
 * invoice editors call while lines are being keyed in.
 */

const POPULATE = [
  { path: 'customers', select: 'name code' },
  { path: 'products', select: 'name sku unit' },
];

/** Every id sent must exist in this workspace. */
const assertExisting = async (Model, list, label) => {
  const wanted = [...new Set((list || []).map(String))];
  if (!wanted.length) return [];
  const found = await Model.find({ _id: { $in: wanted } }).select('_id').lean();
  const have = new Set(found.map((d) => String(d._id)));
  const missing = wanted.filter((id) => !have.has(id));
  if (missing.length) throw new BadRequestError(`Unknown ${label}: ${missing.join(', ')}`, 'INVALID_REFERENCE');
  return wanted;
};

/** Keep only the lists the chosen scope uses, and check the references. */
const cleanScope = async (payload, existing = null) => {
  const out = { ...payload };
  if ('validFrom' in out) out.validFrom = dateOrNull(out.validFrom);
  if ('validTo' in out) out.validTo = dateOrNull(out.validTo);
  const customerScope = out.customerScope || existing?.customerScope;
  const productScope = out.productScope || existing?.productScope;
  if (out.customerScope) {
    if (customerScope !== 'CUSTOMER') out.customers = [];
    if (customerScope !== 'CUSTOMER_TYPE') out.customerTypes = [];
  }
  if (out.productScope) {
    if (productScope !== 'PRODUCT') out.products = [];
    if (productScope !== 'CATEGORY') out.categories = [];
    if (productScope !== 'BRAND') out.brands = [];
  }
  if (out.customers) out.customers = await assertExisting(Customer, out.customers, 'customer(s)');
  if (out.products) out.products = await assertExisting(Product, out.products, 'product(s)');
  return out;
};

const discountCrud = buildCrudController({
  Model: DiscountRule,
  entityType: 'DiscountRule',
  labelField: 'name',
  searchFields: ['name', 'code', 'description'],
  filtersSpec: {
    customerScope: { type: 'string' },
    productScope: { type: 'string' },
    isActive: { type: 'bool' },
  },
  sortAllowed: ['createdAt', 'name', 'code', 'discountPercent'],
  populate: POPULATE,
  label: 'Discount',
  beforeCreate: async (payload, req) => {
    const out = await cleanScope({ customerScope: 'ALL', productScope: 'ALL', ...payload });
    if (!out.code) out.code = await autoCode(req, 'DISCOUNT', 'DR', 4);
    return out;
  },
  beforeUpdate: async (payload, req) => cleanScope(payload, await DiscountRule.findById(req.params.id).lean()),
});

const cleanScheme = async (payload, existing = null) => {
  const out = await cleanScope(payload, existing);
  const type = out.type || existing?.type;
  if ('freeProduct' in out) {
    out.freeProduct = refOrNull(out.freeProduct);
    if (out.freeProduct) await assertExisting(Product, [out.freeProduct], 'free product');
  }
  if (type === 'FREE_GOODS' && out.type) out.slabs = [];
  if (type && type !== 'FREE_GOODS' && out.type) Object.assign(out, { buyQty: 0, freeQty: 0, freeProduct: null });
  if (out.slabs) out.slabs = [...out.slabs].sort((a, b) => Number(a.from) - Number(b.from));
  return out;
};

const schemeCrud = buildCrudController({
  Model: Scheme,
  entityType: 'Scheme',
  labelField: 'name',
  searchFields: ['name', 'code', 'description'],
  filtersSpec: {
    type: { type: 'string' },
    isActive: { type: 'bool' },
  },
  sortAllowed: ['createdAt', 'name', 'code', 'validFrom'],
  populate: [...POPULATE, { path: 'freeProduct', select: 'name sku unit' }],
  label: 'Scheme',
  serialize: (doc) => {
    const plain = toPlain(doc);
    plain.summary = schemeSummary(plain, () => plain.freeProduct?.name || 'item');
    return plain;
  },
  beforeCreate: async (payload, req) => {
    const out = await cleanScheme({ customerScope: 'ALL', productScope: 'PRODUCT', ...payload });
    if (!out.code) out.code = await autoCode(req, 'SCHEME', 'SCH', 4);
    return out;
  },
  beforeUpdate: async (payload, req) => cleanScheme(payload, await Scheme.findById(req.params.id).lean()),
});

export const discounts = discountCrud;
export const schemes = schemeCrud;

// ---- Preview ------------------------------------------------------------------
const priceListFor = async (customer, overrideId) => {
  const id = refOrNull(overrideId) || refOrNull(customer?.priceList);
  if (id) {
    const list = await PriceList.findById(id).lean();
    if (list) return list;
  }
  return PriceList.findOne({ isDefault: true }).lean();
};

/**
 * POST /pricing/preview - price lines the way saving them would: price list,
 * discount rules, schemes and the free goods they give. Nothing is saved.
 */
export const preview = asyncHandler(async (req, res) => {
  const settings = req.settings || (await Setting.forCompany(req.companyId));
  const customer = await Customer.findById(req.body.customerId).lean();
  if (!customer) throw new BadRequestError('Customer not found', 'INVALID_REFERENCE');
  const priceList = await priceListFor(customer, req.body.priceList);
  const canOverride = hasPermission(req, 'pricing.override');
  const items = req.body.items || [];
  if (!items.length) {
    const ctx = await loadPricingContext({ customer, date: dateOrNull(req.body.date) || new Date() });
    const products = new Map(
      (await Product.find({ _id: { $in: ctx.schemes.map((s) => s.freeProduct).filter(Boolean) } }).select('name').lean()).map((p) => [String(p._id), p])
    );
    return success(res, {
      data: {
        lines: [],
        totals: null,
        applied: [],
        offers: ctx.schemes.map((s) => ({ id: String(s._id), name: s.name, type: s.type, summary: schemeSummary(s, (id) => products.get(id)?.name || 'item'), validTo: s.validTo })),
        canOverride,
      },
    });
  }
  const priced = await buildSaleLines(items, {
    priceList,
    settings,
    customer,
    date: dateOrNull(req.body.date) || new Date(),
    canOverride,
  });
  return success(res, {
    data: {
      lines: priced.lines.map((l) => ({
        ...l,
        product: String(l.product),
        scheme: l.scheme ? String(l.scheme) : null,
        discountRule: l.discountRule ? String(l.discountRule) : null,
      })),
      totals: priced.totals,
      applied: priced.applied,
      offers: priced.offers,
      canOverride,
    },
  });
});
