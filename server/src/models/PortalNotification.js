import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * PortalNotification - the customer's own inbox in the portal (order
 * confirmed / changed / rejected, invoice raised, payment recorded, return
 * answered). The same text also goes by SMS / WhatsApp when the company has
 * a messaging provider and switched messages on.
 */
const portalNotificationSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    type: { type: String, default: 'INFO' },
    title: { type: String, required: true, maxlength: 160 },
    body: { type: String, default: '', maxlength: 500 },
    // Path inside the portal, e.g. "orders/<id>".
    link: { type: String, default: '' },
    readAt: { type: Date, default: null },
    // SENT / FAILED / SKIPPED when an SMS / WhatsApp was attempted.
    delivery: { type: String, default: '' },
  },
  { timestamps: true }
);

portalNotificationSchema.plugin(tenantPlugin);
portalNotificationSchema.index({ companyId: 1, customer: 1, createdAt: -1 });

const PortalNotification =
  mongoose.models.PortalNotification || mongoose.model('PortalNotification', portalNotificationSchema);
export default PortalNotification;
