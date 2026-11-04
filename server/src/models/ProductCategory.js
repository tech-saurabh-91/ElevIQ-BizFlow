import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

export const CATEGORY_LEVELS = ['CLASSIFICATION', 'CATEGORY', 'SUBCATEGORY'];

/**
 * Product grouping master, three levels deep:
 *   Classification (Food) -> Category (Biscuits) -> Sub-category (Cream biscuits)
 * A category's parent is a classification; a sub-category's parent a category.
 */
const productCategorySchema = new mongoose.Schema(
  {
    level: { type: String, enum: CATEGORY_LEVELS, required: true, index: true },
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 80 },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductCategory', default: null, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productCategorySchema.index({ companyId: 1, level: 1, parent: 1, name: 1 });

productCategorySchema.plugin(tenantPlugin);

const ProductCategory =
  mongoose.models.ProductCategory || mongoose.model('ProductCategory', productCategorySchema);
export default ProductCategory;
