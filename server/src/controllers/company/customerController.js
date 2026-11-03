import Customer from '../../models/Customer.js';
import Route from '../../models/Route.js';
import Warehouse from '../../models/Warehouse.js';
import PriceList from '../../models/PriceList.js';
import User from '../../models/User.js';
import Order from '../../models/Order.js';
import Invoice from '../../models/Invoice.js';
import Payment from '../../models/Payment.js';
import { escapeRegex } from '../../utils/query.js';
import { AppError, BadRequestError } from '../../utils/errors.js';
import { success } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import { buildCrudController } from './_crud.js';
import { salesScope, markSetup, assertRef, normalizeRefs, assertLimit } from './_helpers.js';
import { checkCustomer, nextCustomerCode } from '../../services/customerService.js';
import { buildTemplate, importCustomers } from '../../services/customerImport.js';
import { findCountry } from '../../services/locationService.js';

const REFS = ['route', 'warehouse', 'priceList', 'assignedTo'];

// System-maintained: never taken from a request.
const SYSTEM_FIELDS = ['code', 'outstanding', 'totalOrders', 'totalSales', 'lastOrderAt'];

const validateRefs = async (payload) => {
  const out = normalizeRefs(payload, REFS);

  if (out.route !== undefined) out.route = await assertRef(Route, out.route, 'Route');
  if (out.warehouse !== undefined) out.warehouse = await assertRef(Warehouse, out.warehouse, 'Warehouse');
  if (out.priceList !== undefined) out.priceList = await assertRef(PriceList, out.priceList, 'Price list');
  if (out.assignedTo !== undefined) out.assignedTo = await assertRef(User, out.assignedTo, 'Salesman');

  return out;
};

const isIndiaCompany = async (req) => (await findCountry(req.company?.address?.country))?.code === 'IN';

const failIfErrors = (errors) => {
  if (!errors.length) return;
  throw new AppError(errors[0].message, {
    status: 422,
    code: 'VALIDATION_ERROR',
    errors: errors.map((e) => ({ field: `body.${e.field}`, message: e.message })),
  });
};

/** Orders, invoices or payments recorded against the customer. */
const hasTransactions = async (customer) => {
  if (customer.totalOrders > 0) return true;
  const filter = { customerId: customer._id };
  const found = await Promise.all([Order.exists(filter), Invoice.exists(filter), Payment.exists(filter)]);
  return found.some(Boolean);
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

    SYSTEM_FIELDS.forEach((k) => delete payload[k]);
    const refs = await validateRefs(payload);
    const { data, errors } = await checkCustomer(refs, { isIndia: await isIndiaCompany(req) });
    failIfErrors(errors);

    // Codes always come from the company's numbering series.
    data.code = await nextCustomerCode(req.companyId);
    data.outstanding = data.openingBalance ?? 0;
    return data;
  },
  beforeUpdate: async (payload, req) => {
    SYSTEM_FIELDS.forEach((k) => delete payload[k]);
    const existing = await Customer.findOne({ _id: req.params.id, ...salesScope(req) });
    if (!existing) return payload; // loadDoc reports the 404

    const refs = await validateRefs(payload);
    const current = existing.toObject();

    // The opening balance feeds the outstanding amount, so it may only be
    // corrected before any order, invoice or payment exists.
    if (refs.openingBalance !== undefined && Number(refs.openingBalance) !== Number(current.openingBalance || 0)) {
      if (await hasTransactions(existing)) {
        failIfErrors([
          { field: 'openingBalance', message: 'Opening balance cannot change once the customer has transactions' },
        ]);
      }
      refs.outstanding =
        Number(current.outstanding || 0) + Number(refs.openingBalance) - Number(current.openingBalance || 0);
    }

    const merged = { ...current, ...refs };
    const { data, errors } = await checkCustomer(merged, {
      isIndia: await isIndiaCompany(req),
      existingId: existing._id,
    });
    failIfErrors(errors);

    ['address', 'shippingAddress', 'shippingSameAsBilling', 'gstin', 'pan', 'paymentTerms', 'creditDays'].forEach((k) => {
      refs[k] = data[k];
    });
    return refs;
  },
  beforeDelete: async (doc) => {
    if (await hasTransactions(doc)) {
      throw new BadRequestError(
        'Customer has transactions and cannot be deleted. Mark it inactive instead.',
        'CUSTOMER_HAS_TRANSACTIONS'
      );
    }
  },
  afterCreate: async () => {
    await markSetup('customers');
  },
});

export const { list, get, create, update, remove } = crud;

/** GET /customers/import/template - the Excel template for bulk import. */
export const importTemplate = asyncHandler(async (req, res) => {
  const buffer = await buildTemplate(req.company);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="customer-import-template.xlsx"');
  res.send(Buffer.from(buffer));
});

/** POST /customers/import?dryRun=true|false - validate (and import) an uploaded template. */
export const importFile = asyncHandler(async (req, res) => {
  if (!req.file?.buffer) {
    throw new AppError('Choose the filled-in template (.xlsx) to upload', { status: 422, code: 'FILE_REQUIRED' });
  }
  const dryRun = req.query.dryRun !== 'false';
  const result = await importCustomers(req.file.buffer, {
    company: req.company,
    isIndia: await isIndiaCompany(req),
    dryRun,
    maxCustomers: Number(req.company?.limits?.maxCustomers || 0),
  });

  if (result.imported) {
    await markSetup('customers');
    audit(req, {
      action: AUDIT_ACTIONS.CREATE,
      entityType: 'Customer',
      entityLabel: 'Bulk import',
      description: `Imported ${result.imported} customers from ${req.file.originalname || 'a file'}`,
    });
  }
  let message = `All ${result.valid} rows are valid`;
  if (result.imported) message = `${result.imported} customers imported`;
  else if (result.errors.length) message = `${result.errors.length} problem(s) found, nothing was imported`;
  return success(res, { message, data: result });
});

export default crud;
