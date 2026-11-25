import mongoose from 'mongoose';

/**
 * Plan - a subscription plan sold by the platform.
 * Shared (non-tenant) document referenced by Company.plan.
 */
const planSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    price: { type: Number, required: true, min: 0 },          // per billing cycle
    currency: { type: String, default: 'INR', maxlength: 8 },
    billingCycle: { type: String, enum: ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONCE'], default: 'YEARLY' },

    trialDays: { type: Number, default: 14, min: 0 },

    maxUsers: { type: Number, default: 5 },
    maxCustomers: { type: Number, default: 500 },
    maxInvoicesPerMonth: { type: Number, default: 500 },

    features: {
      type: {
        gpsTracking: { type: Boolean, default: true },
        multiWarehouse: { type: Boolean, default: true },
        eInvoice: { type: Boolean, default: false },
        apiAccess: { type: Boolean, default: false },
        fieldForce: { type: Boolean, default: true },
        barcode: { type: Boolean, default: true },
        schemes: { type: Boolean, default: true },
        purchase: { type: Boolean, default: true },
      },
      default: () => ({}),
    },

    highlights: { type: [String], default: [] },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
  },
  { timestamps: true }
);

planSchema.index({ isActive: 1, sortOrder: 1 });

const Plan = mongoose.models.Plan || mongoose.model('Plan', planSchema);
export default Plan;
