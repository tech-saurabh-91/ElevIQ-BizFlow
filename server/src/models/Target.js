import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { money } from './helpers.js';
import { TARGET_PERIODS, TARGET_STATUS, TARGET_STATUS_LIST } from '../config/constants.js';

/**
 * Sales target (Phase 7 - Field Force).
 *
 * A target assigns a revenue goal (and optionally an order/visit count) to a
 * rep for a period. `achievedValue` / `achievedOrders` are denormalized from
 * the orders the rep actually booked in that period so the UI can show progress
 * without re-aggregating every read; a nightly (and on-write) refresh keeps the
 * numbers honest.
 *
 * A target is scoped either to a specific salesman or to a whole route/beat,
 * never both, so the uniqueness constraint keeps one goal per owner per period.
 */
const targetSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    name: { type: String, default: '', trim: true, maxlength: 120 },

    periodType: { type: String, enum: TARGET_PERIODS, required: true, index: true },
    /** Stable period key, e.g. "2026-10" (month), "2026-Q3" (quarter), "2026" (year), "2026-W42" (week). */
    periodKey: { type: String, required: true, trim: true, maxlength: 20, index: true },
    periodLabel: { type: String, default: '', trim: true, maxlength: 40 },
    startDate: { type: Date, required: true, index: true },
    endDate: { type: Date, required: true, index: true },

    /** Goal owner: either a salesman, or a route (beat), never both. */
    salesman: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    salesmanName: { type: String, default: '', trim: true },
    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: null, index: true },
    routeName: { type: String, default: '', trim: true },

    // Goals
    targetValue: money(),
    targetOrders: { type: Number, default: 0, min: 0 },
    targetVisits: { type: Number, default: 0, min: 0 },

    // Achievements (denormalized from orders / visits)
    achievedValue: money(),
    achievedOrders: { type: Number, default: 0, min: 0 },
    achievedVisits: { type: Number, default: 0, min: 0 },
    lastRefreshedAt: { type: Date, default: null },

    status: { type: String, enum: TARGET_STATUS_LIST, default: TARGET_STATUS.ACTIVE, index: true },

    notes: { type: String, default: '', trim: true, maxlength: 1000 },
    source: { type: String, enum: ['WEB', 'MOBILE', 'IMPORT', 'API'], default: 'WEB' },
  },
  { timestamps: true }
);

// One target per owner per period.
// NOTE: partialFilterExpression only allows $eq / $exists / $gt / $gte / $lt /
// $lte / $type / $and — `$ne` is rejected by MongoDB, so scope the partial
// index with $type instead (null/missing owner is simply not indexed).
targetSchema.index(
  { companyId: 1, periodType: 1, periodKey: 1, salesman: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, salesman: { $type: 'objectId' } } }
);
targetSchema.index(
  { companyId: 1, periodType: 1, periodKey: 1, route: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, route: { $type: 'objectId' } } }
);
targetSchema.index({ companyId: 1, status: 1, endDate: -1 });
targetSchema.index({ companyId: 1, salesman: 1, endDate: -1 });

targetSchema.plugin(tenantPlugin);

targetSchema.virtual('label').get(function label() {
  return this.name || this.periodLabel || String(this._id);
});

/** Percentage of the revenue goal achieved (0..100, capped for display). */
targetSchema.virtual('achievementPercent').get(function achievementPercent() {
  const goal = Number(this.targetValue || 0);
  if (goal <= 0) return 0;
  return Math.min(100, Math.round((Number(this.achievedValue || 0) / goal) * 10000) / 100);
});

/** True once achieved value has met or passed the goal. */
targetSchema.virtual('isAchieved').get(function isAchieved() {
  const goal = Number(this.targetValue || 0);
  return goal > 0 && Number(this.achievedValue || 0) >= goal;
});

/** Revenue still needed to hit the goal. */
targetSchema.virtual('remainingValue').get(function remainingValue() {
  return Math.max(0, Number(this.targetValue || 0) - Number(this.achievedValue || 0));
});

/** Recompute ACTIVE/ACHIEVED/MISSED from the achievements. */
targetSchema.methods.refreshStatus = function refreshStatus() {
  const goal = Number(this.targetValue || 0);
  if (goal <= 0) return this.status;
  if (this.status === TARGET_STATUS.CLOSED) return this.status;

  if (Number(this.achievedValue || 0) >= goal) {
    this.status = TARGET_STATUS.ACHIEVED;
  } else if (this.endDate && new Date(this.endDate) < new Date()) {
    this.status = TARGET_STATUS.MISSED;
  } else {
    this.status = TARGET_STATUS.ACTIVE;
  }
  return this.status;
};

const Target = mongoose.models.Target || mongoose.model('Target', targetSchema);
export default Target;
