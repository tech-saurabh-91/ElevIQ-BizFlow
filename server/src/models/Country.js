import mongoose from 'mongoose';

export const TAX_REGIMES = ['GST', 'VAT', 'SALES_TAX', 'NONE'];

/**
 * Country - platform-wide location master (NOT tenant scoped).
 *
 * Besides the name it carries the defaults a company inherits when it picks
 * this country: currency, time zones, tax regime and the postal code format.
 * Seeded from the `country-state-city` dataset (see services/locationService.js)
 * and editable by platform admins.
 */
const countrySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // ISO 3166-1 alpha-2
    name: { type: String, required: true, trim: true },
    flag: { type: String, default: '' },
    phoneCode: { type: String, default: '' },

    currency: { type: String, default: '', uppercase: true, trim: true },
    currencySymbol: { type: String, default: '' },
    timezones: { type: [String], default: [] },
    locale: { type: String, default: 'en' },

    tax: {
      regime: { type: String, enum: TAX_REGIMES, default: 'VAT' },
      label: { type: String, default: 'Tax' },
      taxIdLabel: { type: String, default: 'Tax ID' },
      defaultRate: { type: Number, default: 0, min: 0, max: 100 },
      maxRate: { type: Number, default: 100, min: 0, max: 100 },
      // GST-style split: same-state sales show CGST + SGST, cross-state IGST.
      splitIntraState: { type: Boolean, default: false },
    },

    postalCode: {
      label: { type: String, default: 'Postal code' },
      numeric: { type: Boolean, default: false },
      length: { type: Number, default: null },
      pattern: { type: String, default: '' }, // optional regex source, overrides length
    },

    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

countrySchema.index({ name: 1 });

const Country = mongoose.models.Country || mongoose.model('Country', countrySchema);
export default Country;
