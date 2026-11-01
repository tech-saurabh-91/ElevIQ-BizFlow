import mongoose from 'mongoose';

/**
 * Atomic per-tenant number-series counter.
 * _id is a natural string key: `${companyId}:${key}:${fy}`
 */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0, min: 0 },
  },
  { timestamps: false, collection: 'counters' }
);

counterSchema.statics.next = async function (key, pad = 6) {
  const doc = await this.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();
  return doc.seq;
};

counterSchema.statics.peek = async function (key) {
  const doc = await this.findById(key).lean();
  return (doc?.seq ?? 0) + 1;
};

const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

export default Counter;
