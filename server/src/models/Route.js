import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

export const BEAT_DAYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

/**
 * Route / beat: an ordered list of customers a salesman visits on given days.
 */
const routeSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Route name is required'], trim: true, maxlength: 120 },
    code: { type: String, required: [true, 'Route code is required'], trim: true, uppercase: true, maxlength: 20 },
    description: { type: String, default: '', maxlength: 500 },
    territory: { type: String, default: '', trim: true, index: true },

    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },

    beatDays: { type: [{ type: String, enum: BEAT_DAYS }], default: [] },
    sequence: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

routeSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
routeSchema.index({ companyId: 1, name: 1 });

routeSchema.plugin(tenantPlugin);

const Route = mongoose.models.Route || mongoose.model('Route', routeSchema);
export default Route;
