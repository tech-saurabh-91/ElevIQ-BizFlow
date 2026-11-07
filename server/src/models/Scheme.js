import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { CUSTOMER_SCOPES, PRODUCT_SCOPES } from './DiscountRule.js';

/**
 * Trade schemes (sales promotions) applied automatically on orders and
 * direct invoices:
 *
 *  FREE_GOODS      Buy X get Y free - e.g. buy 10 Soap get 1 Soap free, or
 *                  buy 2 cartons Atta get 1 Oil free. Counted per product in
 *                  its base unit; "repeat" gives Y for every X (20 -> 2 free).
 *  QTY_DISCOUNT    Quantity slabs - buy 50+ get 2% off, 100+ get 4% off
 *                  (per product line, base units).
 *  VALUE_DISCOUNT  Bill value slabs on the covered products together -
 *                  covered value 5,000+ gets 2% off those lines.
 *
 * A line gets the best one discount scheme (on top of its trade discount)
 * and the best one free-goods scheme. Free goods are added as separate
 * zero-priced lines so they move stock and print on the bill.
 */
export const SCHEME_TYPES = Object.freeze(['FREE_GOODS', 'QTY_DISCOUNT', 'VALUE_DISCOUNT']);

const slabSchema = new mongoose.Schema(
  {
    from: { type: Number, required: true, min: 0 }, // base qty or value
    discountPercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const schemeSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, uppercase: true, maxlength: 24, default: '' },
    name: { type: String, required: [true, 'Scheme name is required'], trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    type: { type: String, enum: SCHEME_TYPES, required: true, index: true },

    customerScope: { type: String, enum: CUSTOMER_SCOPES, default: 'ALL' },
    customers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }], default: [] },
    customerTypes: { type: [String], default: [] },

    productScope: { type: String, enum: PRODUCT_SCOPES, default: 'PRODUCT' },
    products: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    categories: { type: [String], default: [] },
    brands: { type: [String], default: [] },

    // FREE_GOODS
    buyQty: { type: Number, default: 0, min: 0 },
    freeQty: { type: Number, default: 0, min: 0 },
    freeProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null }, // null = same product
    repeat: { type: Boolean, default: true },

    // QTY_DISCOUNT / VALUE_DISCOUNT
    slabs: { type: [slabSchema], default: [] },

    validFrom: { type: Date, required: true },
    validTo: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

schemeSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, code: { $type: 'string', $gt: '' } } }
);
schemeSchema.plugin(tenantPlugin);

const Scheme = mongoose.models.Scheme || mongoose.model('Scheme', schemeSchema);
export default Scheme;
