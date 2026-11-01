import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';

export const PRICE_LIST_TYPES = Object.freeze(['RETAIL', 'WHOLESALE', 'DISTRIBUTOR', 'CUSTOM']);

const priceListItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    price: money(),
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    minQty: { type: Number, default: 1, min: 0 },
  },
  { _id: false }
);

/**
 * Price list - named pricing schedule assigned to customers. Customers without a
 * price list fall back to the default list (or the product's sellingPrice).
 */
const priceListSchema = new mongoose.Schema(
  {
    code: { type: String, trim: true, uppercase: true, maxlength: 24, default: '' },
    name: { type: String, required: [true, 'Price list name is required'], trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    type: { type: String, enum: PRICE_LIST_TYPES, default: 'RETAIL', index: true },
    currency: { type: String, default: 'INR', maxlength: 8 },

    isDefault: { type: Boolean, default: false, index: true },
    isActive: { type: Boolean, default: true, index: true },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },

    items: { type: [priceListItemSchema], default: [] },
    notes: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

priceListSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, code: { $type: 'string', $gt: '' } } }
);
priceListSchema.index({ companyId: 1, name: 1 });

priceListSchema.plugin(tenantPlugin);

/** Only one default price list per tenant. */
priceListSchema.pre('save', async function enforceSingleDefault(next) {
  if (!this.isDefault || !this.isModified('isDefault')) return next();
  const tenantId = this.companyId;
  if (!tenantId) return next();
  await this.constructor
    .updateMany({ companyId: tenantId, _id: { $ne: this._id }, isDefault: true }, { $set: { isDefault: false } })
    .skipTenant();
  next();
});

const PriceList = mongoose.models.PriceList || mongoose.model('PriceList', priceListSchema);
export default PriceList;
