import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/** Who a discount rule or scheme is for. */
export const CUSTOMER_SCOPES = Object.freeze(['ALL', 'CUSTOMER_TYPE', 'CUSTOMER']);
/** Which products it covers. */
export const PRODUCT_SCOPES = Object.freeze(['ALL', 'CATEGORY', 'BRAND', 'PRODUCT']);

/**
 * Discount master: a standing trade discount (%) for some customers on some
 * products, e.g. "Distributors: 5% on Soaps", "Balaji Kirana: 3% on all items".
 *
 * On a sale line the most specific matching rule wins (a named customer beats
 * a customer type beats everyone; a named product beats its brand / category
 * beats all products); on a tie the higher discount wins. A matching rule
 * replaces the price list's own discount for that line.
 */
const discountRuleSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, uppercase: true, maxlength: 24, default: '' },
    name: { type: String, required: [true, 'Discount name is required'], trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    discountPercent: { type: Number, required: true, min: 0, max: 100 },

    customerScope: { type: String, enum: CUSTOMER_SCOPES, default: 'ALL' },
    customers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Customer' }], default: [] },
    customerTypes: { type: [String], default: [] },

    productScope: { type: String, enum: PRODUCT_SCOPES, default: 'ALL' },
    products: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    categories: { type: [String], default: [] },
    brands: { type: [String], default: [] },

    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

discountRuleSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, code: { $type: 'string', $gt: '' } } }
);
discountRuleSchema.plugin(tenantPlugin);

const DiscountRule = mongoose.models.DiscountRule || mongoose.model('DiscountRule', discountRuleSchema);
export default DiscountRule;
