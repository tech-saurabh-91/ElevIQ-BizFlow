import mongoose from 'mongoose';

/**
 * DemoRequest - a "Book a demo" lead from the public home page.
 * Platform-owned (not tenant-scoped): only the provider portal reads it.
 */
export const DEMO_REQUEST_STATUSES = Object.freeze([
  'NEW',
  'CONTACTED',
  'DEMO_SCHEDULED',
  'DEMO_DONE',
  'WON',
  'LOST',
]);

const noteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, maxlength: 2000 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
    byName: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const demoRequestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    business: { type: String, required: true, trim: true, maxlength: 160 },
    mobile: { type: String, required: true, trim: true, maxlength: 20, index: true },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, default: '', trim: true, lowercase: true, maxlength: 160 },
    businessType: { type: String, default: '', maxlength: 60 },
    teamSize: { type: String, default: '', maxlength: 60 },
    message: { type: String, default: '', maxlength: 1000 },
    source: { type: String, default: 'WEBSITE', maxlength: 40 },

    status: { type: String, enum: DEMO_REQUEST_STATUSES, default: 'NEW', index: true },
    followUpAt: { type: Date, default: null },
    notes: { type: [noteSchema], default: [] },
    /** How many times the same mobile submitted again while this lead was open. */
    repeatCount: { type: Number, default: 0 },
    lastSubmittedAt: { type: Date, default: Date.now },

    convertedCompany: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },

    // Kept for spam checks only.
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '', maxlength: 300 },

    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

demoRequestSchema.index({ createdAt: -1 });

const DemoRequest = mongoose.models.DemoRequest || mongoose.model('DemoRequest', demoRequestSchema);
export default DemoRequest;
