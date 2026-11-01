import mongoose from 'mongoose';

/**
 * Subscription - a company's subscription record (history kept).
 * One active subscription per company (status=ACTIVE).
 */
const subscriptionSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true, index: true },

    status: {
      type: String,
      enum: ['PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'PAUSED'],
      default: 'ACTIVE',
      index: true,
    },

    start: { type: Date, required: true },
    end: { type: Date, required: true, index: true },
    trialEnd: { type: Date, default: null },

    price: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    billingCycle: { type: String, enum: ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONCE'], default: 'YEARLY' },

    // Snapshot of limits/features at the time of this subscription
    limits: {
      maxUsers: { type: Number, default: 5 },
      maxCustomers: { type: Number, default: 500 },
      maxInvoicesPerMonth: { type: Number, default: 500 },
    },
    features: { type: Object, default: {} },

    autoRenew: { type: Boolean, default: true },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },

    notes: { type: String, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

subscriptionSchema.index({ companyId: 1, status: 1 });
subscriptionSchema.index({ end: 1, status: 1 });

/** Active subscription for a company, if any. */
subscriptionSchema.statics.activeFor = function (companyId) {
  return this.findOne({
    companyId,
    status: 'ACTIVE',
    isDeleted: { $ne: true },
    end: { $gte: new Date() },
  }).sort({ end: -1 });
};

const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
export default Subscription;
