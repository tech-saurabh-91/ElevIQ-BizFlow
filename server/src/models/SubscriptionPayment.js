import mongoose from 'mongoose';

/**
 * SubscriptionPayment - manual/recorded platform payments against subscriptions.
 */
const subscriptionPaymentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription', default: null, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null },

    invoiceRef: { type: String, default: '' },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    method: {
      type: String,
      enum: ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'],
      default: 'BANK_TRANSFER',
    },
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'], default: 'SUCCESS' },

    paidAt: { type: Date, default: Date.now },
    reference: { type: String, default: '' },
    notes: { type: String, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

subscriptionPaymentSchema.index({ companyId: 1, paidAt: -1 });

const SubscriptionPayment =
  mongoose.models.SubscriptionPayment || mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);
export default SubscriptionPayment;
