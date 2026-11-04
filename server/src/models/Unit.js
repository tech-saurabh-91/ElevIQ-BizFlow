import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';

/**
 * Unit of measure master (PCS, BOX, KG...). Products pick their base unit and
 * pack units from here so spellings stay consistent ("PCS", never "pcs").
 */
const unitSchema = new mongoose.Schema(
  {
    code: { type: String, required: [true, 'Unit code is required'], trim: true, uppercase: true, maxlength: 10 },
    name: { type: String, required: [true, 'Unit name is required'], trim: true, maxlength: 40 },
    // KG / L may hold 1.5; PCS / BOX are counted in whole numbers.
    allowDecimals: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

unitSchema.index({ companyId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

unitSchema.plugin(tenantPlugin);

export const DEFAULT_UNITS = [
  ['PCS', 'Pieces', false],
  ['NOS', 'Numbers', false],
  ['PKT', 'Packet', false],
  ['BOX', 'Box', false],
  ['CTN', 'Carton', false],
  ['DZN', 'Dozen', false],
  ['SET', 'Set', false],
  ['PAIR', 'Pair', false],
  ['BAG', 'Bag', false],
  ['BTL', 'Bottle', false],
  ['CAN', 'Can', false],
  ['JAR', 'Jar', false],
  ['ROLL', 'Roll', false],
  ['KG', 'Kilogram', true],
  ['G', 'Gram', true],
  ['L', 'Litre', true],
  ['ML', 'Millilitre', true],
  ['MTR', 'Metre', true],
];

const Unit = mongoose.models.Unit || mongoose.model('Unit', unitSchema);
export default Unit;
