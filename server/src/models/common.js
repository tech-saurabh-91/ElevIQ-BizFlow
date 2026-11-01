import mongoose from 'mongoose';

/**
 * Shared sub-schemas for Phase 3 master data so addresses, bank details and
 * geo points look identical on customers, suppliers, warehouses and routes.
 */

export const geoPointSchema = new mongoose.Schema(
  {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
  { _id: false }
);

export const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, default: '', trim: true },
    line2: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    country: { type: String, default: 'India', trim: true },
    pincode: { type: String, default: '', trim: true },
    gps: { type: geoPointSchema, default: () => ({}) },
  },
  { _id: false }
);

export const bankDetailsSchema = new mongoose.Schema(
  {
    accountName: { type: String, default: '', trim: true },
    accountNumber: { type: String, default: '', trim: true },
    ifsc: { type: String, default: '', trim: true, uppercase: true },
    bankName: { type: String, default: '', trim: true },
    branch: { type: String, default: '', trim: true },
    upiVpa: { type: String, default: '', trim: true },
  },
  { _id: false }
);

export default { geoPointSchema, addressSchema, bankDetailsSchema };
