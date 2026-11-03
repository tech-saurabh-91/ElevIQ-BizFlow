import mongoose from 'mongoose';

/** City - platform-wide location master, linked to a State by country + state code. */
const citySchema = new mongoose.Schema(
  {
    country: { type: String, required: true, uppercase: true, trim: true },
    state: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

citySchema.index({ country: 1, state: 1, name: 1 }, { unique: true });

const City = mongoose.models.City || mongoose.model('City', citySchema);
export default City;
