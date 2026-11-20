import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * A named set of access ("Senior presales", "Leave cover - accounts") that a
 * company admin gives to several users at once. Changing the profile changes
 * everyone on it. A user's own Allow / Deny still wins over the profile.
 *
 * Order: admin > sales type > user's own > profile > role matrix > defaults.
 */
const overrideSchema = new mongoose.Schema(
  {
    permission: { type: String, required: true, trim: true },
    effect: { type: String, enum: ['ALLOW', 'DENY'], required: true },
  },
  { _id: false }
);

const accessProfileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: '', trim: true, maxlength: 200 },
    overrides: { type: [overrideSchema], default: [] },
    /** '' = leave each user's (or their role's) data scope alone. */
    dataScope: { type: String, enum: ['', 'OWN', 'TEAM', 'ALL'], default: '' },
    limits: {
      maxDiscountPercent: { type: Number, default: null, min: 0, max: 100 },
      maxApproveAmount: { type: Number, default: null, min: 0 },
    },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

accessProfileSchema.plugin(tenantPlugin);
accessProfileSchema.index({ companyId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

const AccessProfile = mongoose.models.AccessProfile || mongoose.model('AccessProfile', accessProfileSchema);
export default AccessProfile;
