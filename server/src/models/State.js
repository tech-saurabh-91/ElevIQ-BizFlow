import mongoose from 'mongoose';

/** State / province - platform-wide location master, linked to a Country by code. */
const stateSchema = new mongoose.Schema(
  {
    country: { type: String, required: true, uppercase: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

stateSchema.index({ country: 1, code: 1 }, { unique: true });
stateSchema.index({ country: 1, name: 1 });

const State = mongoose.models.State || mongoose.model('State', stateSchema);
export default State;
