import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * Who works a route on a given day. Overrides the route's standing weekday
 * plan (Route.assignedTo + beatDays) for that one day; one salesman per
 * route per day.
 */
const beatPlanSchema = new mongoose.Schema(
  {
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true, index: true },
    salesman: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Business day in the company time zone, YYYY-MM-DD.
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    notes: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true }
);

beatPlanSchema.index({ companyId: 1, route: 1, day: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });
beatPlanSchema.index({ companyId: 1, salesman: 1, day: 1 });

beatPlanSchema.plugin(tenantPlugin);

const BeatPlan = mongoose.models.BeatPlan || mongoose.model('BeatPlan', beatPlanSchema);
export default BeatPlan;
