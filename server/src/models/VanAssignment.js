import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * Which executive is driving a VAN warehouse right now (Phase A).
 *
 * An assignment is a dated spell: `fromDate` -> `toDate` (null while open).
 * History is append-only in spirit - a spell is *closed*, never edited or
 * deleted, so "who had this van on the 14th?" is always answerable.
 *
 * Two denormalized `active` partial unique indexes guarantee that at most:
 *   - one open assignment exists per van, and
 *   - one open assignment exists per executive,
 * even under concurrent requests (the DB, not the app, is the arbiter).
 */
const vanAssignmentSchema = new mongoose.Schema(
  {
    // companyId / createdBy / updatedBy / isDeleted injected by tenantPlugin

    /** The VAN warehouse being assigned. */
    warehouse: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Warehouse',
      required: [true, 'Van is required'],
      index: true,
    },

    /** The user (typically a SALESMAN) taking the van. */
    executive: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Executive is required'],
      index: true,
    },

    fromDate: { type: Date, required: [true, 'From date is required'] },
    toDate: { type: Date, default: null },

    /** Day-close (expected vs actual cash/stock) required for this spell. */
    dayCloseMandatory: { type: Boolean, default: true },

    /**
     * Denormalized open/closed flag: `active === toDate == null`. Kept as a
     * real field (rather than a query expression) so the partial unique
     * indexes above can enforce one-open-per-van / one-open-per-executive.
     */
    active: { type: Boolean, default: true, index: true },

    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, default: '', maxlength: 500 },

    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    closeNotes: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

// At most one OPEN assignment per van / per executive, per company.
vanAssignmentSchema.index(
  { companyId: 1, warehouse: 1 },
  { unique: true, partialFilterExpression: { active: true, isDeleted: false } }
);
vanAssignmentSchema.index(
  { companyId: 1, executive: 1 },
  { unique: true, partialFilterExpression: { active: true, isDeleted: false } }
);

// History reads: newest first per van / per executive.
vanAssignmentSchema.index({ companyId: 1, warehouse: 1, fromDate: -1 });
vanAssignmentSchema.index({ companyId: 1, executive: 1, fromDate: -1 });

vanAssignmentSchema.plugin(tenantPlugin);

const VanAssignment =
  mongoose.models.VanAssignment || mongoose.model('VanAssignment', vanAssignmentSchema);
export default VanAssignment;
