import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { geoPointSchema } from './common.js';
import { VISIT_OUTCOMES, VISIT_STATUS, VISIT_STATUS_LIST, VISIT_PURPOSES } from '../config/constants.js';

/**
 * Customer visit / beat check-in (Phase 7 - Field Force).
 *
 * A visit is one planned stop on a rep's route. It carries the GPS coordinates
 * captured at the customer's premises (check-in / check-out), how long the rep
 * stayed, and the outcome - whether an order was taken, a collection made, or
 * the customer was unavailable. Linking a visit to the order it produced is what
 * makes field activity measurable against revenue.
 *
 * Lifecycle: PLANNED -> IN_PROGRESS (checked in) -> COMPLETED (checked out with
 * an outcome), or CANCELLED / SKIPPED when the stop did not happen.
 */
const visitSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    visitNo: { type: String, trim: true, uppercase: true, maxlength: 40, default: '' },

    /** The day the visit belongs to (beat planning is per day). */
    visitDay: { type: Date, default: Date.now, index: true },
    plannedAt: { type: Date, default: null },

    // Customer + snapshot (the visit must not drift if the master changes)
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    customerName: { type: String, default: '', trim: true },
    customerCode: { type: String, default: '', trim: true },
    customerPhone: { type: String, default: '', trim: true },

    /** The rep who is visiting (drives salesman/manager scoping). */
    salesman: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salesmanName: { type: String, default: '', trim: true },

    route: { type: mongoose.Schema.Types.ObjectId, ref: 'Route', default: null, index: true },
    routeName: { type: String, default: '', trim: true },

    purpose: { type: String, enum: VISIT_PURPOSES, default: 'ORDER', index: true },

    status: { type: String, enum: VISIT_STATUS_LIST, default: VISIT_STATUS.PLANNED, index: true },
    statusHistory: {
      type: [
        new mongoose.Schema(
          {
            status: { type: String, enum: VISIT_STATUS_LIST, required: true },
            at: { type: Date, default: Date.now },
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
            byName: { type: String, default: '', trim: true },
            note: { type: String, default: '', maxlength: 500 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    // GPS capture at the customer's premises
    checkIn: {
      type: new mongoose.Schema(
        {
          at: { type: Date, default: null },
          location: { type: geoPointSchema, default: () => ({}) },
          accuracy: { type: Number, default: null },
          address: { type: String, default: '', trim: true, maxlength: 300 },
          source: { type: String, enum: ['WEB', 'MOBILE', 'MANUAL'], default: 'WEB' },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    checkOut: {
      type: new mongoose.Schema(
        {
          at: { type: Date, default: null },
          location: { type: geoPointSchema, default: () => ({}) },
          accuracy: { type: Number, default: null },
          address: { type: String, default: '', trim: true, maxlength: 300 },
          source: { type: String, enum: ['WEB', 'MOBILE', 'MANUAL'], default: 'WEB' },
        },
        { _id: false }
      ),
      default: () => ({}),
    },

    /** Straight-line distance between check-in and check-out (m). */
    distanceMeters: { type: Number, default: 0, min: 0 },
    /** How long the rep stayed with the customer (minutes). */
    durationMinutes: { type: Number, default: 0, min: 0 },

    /** Outcome recorded on completion (empty until the visit is checked out). */
    outcome: { type: String, enum: ['', ...VISIT_OUTCOMES], default: '', index: true },

    /** The order this visit produced (when outcome is ORDER_TAKEN). */
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    orderNo: { type: String, default: '', trim: true },
    orderValue: { type: Number, default: 0, min: 0 },

    /** Collection made during the visit (when outcome is PAYMENT_COLLECTED). */
    payment: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    paymentNo: { type: String, default: '', trim: true },
    collectionAmount: { type: Number, default: 0, min: 0 },

    /** Why a planned visit was skipped/cancelled. */
    skipReason: { type: String, default: '', trim: true, maxlength: 300 },

    notes: { type: String, default: '', trim: true, maxlength: 1000 },
    /** Optional selfie / proof-of-visit image path. */
    proofUrl: { type: String, default: '', trim: true },

    source: { type: String, enum: ['WEB', 'MOBILE', 'IMPORT', 'API'], default: 'WEB' },
  },
  { timestamps: true }
);

visitSchema.index(
  { companyId: 1, visitNo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
visitSchema.index({ companyId: 1, visitDay: -1, status: 1 });
visitSchema.index({ companyId: 1, salesman: 1, visitDay: -1 });
visitSchema.index({ companyId: 1, customerId: 1, visitDay: -1 });
visitSchema.index({ companyId: 1, route: 1, visitDay: -1 });

/** Derive duration from the check-in/out pair. */
visitSchema.pre('validate', function derive(next) {
  const start = this.checkIn?.at ? new Date(this.checkIn.at) : null;
  const end = this.checkOut?.at ? new Date(this.checkOut.at) : null;
  if (start && end && end > start) {
    this.durationMinutes = Math.round((end - start) / 60000);
  } else {
    this.durationMinutes = 0;
  }
  next();
});

visitSchema.plugin(tenantPlugin);

visitSchema.virtual('label').get(function label() {
  return this.visitNo || String(this._id);
});

/** True when the visit has been checked in but not yet checked out. */
visitSchema.virtual('isCheckedIn').get(function isCheckedIn() {
  return Boolean(this.checkIn?.at) && !this.checkOut?.at;
});

const Visit = mongoose.models.Visit || mongoose.model('Visit', visitSchema);
export default Visit;
