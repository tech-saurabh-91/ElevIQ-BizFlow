import mongoose from 'mongoose';

/**
 * Announcement - platform-pushed message to all or selected companies.
 * Non-tenant (platform owns it); companies read via a scoped join.
 */
const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 4000 },
    type: { type: String, enum: ['INFO', 'UPDATE', 'MAINTENANCE', 'PROMO', 'FEATURE'], default: 'INFO' },

    // null/empty -> all companies; else specific
    targetCompanies: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Company' }], default: [] },
    broadcast: { type: Boolean, default: true },

    active: { type: Boolean, default: true, index: true },
    startsAt: { type: Date, default: Date.now },
    endsAt: { type: Date, default: null },

    ctaLabel: { type: String, default: '' },
    ctaLink: { type: String, default: '' },

    acknowledgedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

announcementSchema.index({ active: 1, startsAt: 1, endsAt: 1 });

/** Active announcements visible to a given company. */
announcementSchema.statics.visibleTo = function (companyId) {
  const now = new Date();
  return this.find({
    isDeleted: { $ne: true },
    active: true,
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
    $and: [{ $or: [{ broadcast: true }, { targetCompanies: companyId }] }],
  }).sort({ startsAt: -1 });
};

const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);
export default Announcement;
