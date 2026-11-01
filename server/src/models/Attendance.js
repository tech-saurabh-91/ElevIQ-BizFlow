import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { geoPointSchema } from './common.js';
import { ATTENDANCE_STATUS, ATTENDANCE_STATUS_LIST } from '../config/constants.js';

/**
 * GPS-tagged check-in/out event (Phase 7 - Field Force).
 *
 * Attendance is captured as a pair of events per working day: a CHECK_IN and a
 * CHECK_OUT, each with the coordinates the device reported plus an optional
 * reverse-geocoded address. A single `Attendance` day document aggregates them
 * into worked/overtime minutes; this event stream is what the audit trail and
 * "was the rep actually on site?" geofence checks read from.
 */
const attendanceEventSchema = new mongoose.Schema(
  {
    // `at` must default to null (not Date.now): the parent document's empty
    // `checkIn`/`checkOut` objects are cast through this schema, so a Date.now
    // default would stamp "now" and make an untouched day look checked-out.
    at: { type: Date, default: null },
    location: { type: geoPointSchema, default: () => ({}) },
    /** Horizontal accuracy in metres reported by the device. */
    accuracy: { type: Number, default: null },
    address: { type: String, default: '', trim: true, maxlength: 300 },
    /** WEB = browser geolocation, MOBILE = app, MANUAL = typed by a manager. */
    source: { type: String, enum: ['WEB', 'MOBILE', 'MANUAL'], default: 'WEB' },
    note: { type: String, default: '', trim: true, maxlength: 300 },
  },
  { _id: false }
);

/**
 * One attendance record per user per calendar day.
 *
 * `workedMinutes` is derived from check-in/out on save; a day without a
 * check-out stays open (checked-in). Status defaults to PRESENT once checked
 * in, and a manager can override it to LEAVE / HALF_DAY / WEEK_OFF etc.
 */
const attendanceSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userName: { type: String, default: '', trim: true },
    userRole: { type: String, default: '', trim: true },

    /** Calendar day (start of day in the tenant timezone). */
    day: { type: Date, required: true, index: true },

    status: { type: String, enum: ATTENDANCE_STATUS_LIST, default: ATTENDANCE_STATUS.PRESENT, index: true },

    checkIn: { type: attendanceEventSchema, default: () => ({}) },
    checkOut: { type: attendanceEventSchema, default: () => ({}) },

    /** True once a check-in exists for the day. */
    isCheckedIn: { type: Boolean, default: false, index: true },
    isCheckedOut: { type: Boolean, default: false },

    /** Derived on save from check-in -> check-out. */
    workedMinutes: { type: Number, default: 0, min: 0 },
    overtimeMinutes: { type: Number, default: 0, min: 0 },
    /** Minutes the day was left open (checked in, no check-out yet). */
    openMinutes: { type: Number, default: 0, min: 0 },

    /** Straight-line distance covered between check-in and check-out (m). */
    distanceMeters: { type: Number, default: 0, min: 0 },

    /** Manager override / review. */
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', trim: true, maxlength: 500 },

    /** Set when a manager edited the day manually (attendance correction). */
    isManual: { type: Boolean, default: false },
    manualReason: { type: String, default: '', trim: true, maxlength: 300 },

    notes: { type: String, default: '', trim: true, maxlength: 1000 },
    source: { type: String, enum: ['WEB', 'MOBILE', 'MANUAL'], default: 'WEB' },
  },
  { timestamps: true }
);

// Exactly one attendance record per user per day.
attendanceSchema.index(
  { companyId: 1, user: 1, day: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
attendanceSchema.index({ companyId: 1, day: -1, status: 1 });
attendanceSchema.index({ companyId: 1, user: 1, day: -1 });

/** Derive worked/overtime minutes from the check-in/out pair. */
attendanceSchema.pre('validate', function derive(next) {
  const workStart = this.checkIn?.at ? new Date(this.checkIn.at) : null;
  const workEnd = this.checkOut?.at ? new Date(this.checkOut.at) : null;

  this.isCheckedIn = Boolean(workStart);
  this.isCheckedOut = Boolean(workEnd);

  if (workStart && workEnd && workEnd > workStart) {
    const minutes = Math.round((workEnd - workStart) / 60000);
    this.workedMinutes = minutes;
    this.openMinutes = 0;
    // Standard day is 8h; anything beyond counts as overtime.
    this.overtimeMinutes = Math.max(0, minutes - 480);
  } else if (workStart && !workEnd) {
    // Still on shift: report elapsed time as open, not worked.
    this.workedMinutes = 0;
    this.openMinutes = Math.max(0, Math.round((Date.now() - workStart) / 60000));
    this.overtimeMinutes = 0;
  } else {
    this.workedMinutes = 0;
    this.openMinutes = 0;
    this.overtimeMinutes = 0;
  }

  next();
});

attendanceSchema.plugin(tenantPlugin);

attendanceSchema.virtual('label').get(function label() {
  const day = this.day ? new Date(this.day).toISOString().slice(0, 10) : '';
  return `${this.userName || 'User'} ${day}`.trim();
});

/** Human "8h 30m" rendering for lists. */
attendanceSchema.virtual('workedLabel').get(function workedLabel() {
  const m = Number(this.workedMinutes || 0);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
});

const Attendance = mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);
export default Attendance;
