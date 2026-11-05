import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * Notification - in-app notifications for company users.
 */
const notificationSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },

    // null/empty -> broadcast to whole company; else specific recipients
    recipients: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    broadcast: { type: Boolean, default: false },

    type: {
      type: String,
      enum: [
        'ORDER_APPROVED',
        'ORDER_REJECTED',
        'PAYMENT_RECEIVED',
        'OVERDUE_INVOICE',
        'LOW_STOCK',
        'APPROVAL_REQUIRED',
        'LEAVE_REQUEST',
        'EXPENSE_APPROVED',
        'SYSTEM',
        'ANNOUNCEMENT',
        'TARGET_ACHIEVED',
        'CREDIT_LIMIT',
        'STOCK_REQUEST',
        'EXPENSE_REJECTED',
      ],
      default: 'SYSTEM',
      index: true,
    },

    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, default: '', maxlength: 500 },
    link: { type: String, default: '' },
    entityType: { type: String, default: '' },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },

    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },

    priority: { type: String, enum: ['LOW', 'NORMAL', 'HIGH'], default: 'NORMAL' },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.plugin(tenantPlugin);
notificationSchema.index({ companyId: 1, recipients: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ companyId: 1, broadcast: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
export default Notification;
