import mongoose from 'mongoose';
import tenantPlugin from './plugins/tenantPlugin.js';
import { buildDefaultPermissions, BUSINESS_DEFAULTS } from '../config/constants.js';

/**
 * Setting - one document per company holding all workspace configuration.
 * Singleton per tenant (companyId unique).
 */
const settingSchema = new mongoose.Schema(
  {
    // companyId added by tenantPlugin

    // Profile-ish (mirrors Company but editable by COMPANY_ADMIN)
    displayName: { type: String, default: '' },
    logo: { type: String, default: '' },
    address: { type: Object, default: () => ({}) },

    // Localization
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    currencySymbol: { type: String, default: '₹' },
    financialYearStartMonth: { type: Number, default: 4, min: 1, max: 12 },
    dateFormat: { type: String, default: 'DD/MM/YYYY' },

    // Number series / prefixes
    series: {
      type: {
        order: { prefix: { type: String, default: 'SO' }, pad: { type: Number, default: 6 } },
        invoice: { prefix: { type: String, default: 'INV' }, pad: { type: Number, default: 6 } },
        creditNote: { prefix: { type: String, default: 'CN' }, pad: { type: Number, default: 6 } },
        payment: { prefix: { type: String, default: 'RCPT' }, pad: { type: Number, default: 6 } },
        purchase: { prefix: { type: String, default: 'PO' }, pad: { type: Number, default: 6 } },
        grn: { prefix: { type: String, default: 'GRN' }, pad: { type: Number, default: 6 } },
        adjustment: { prefix: { type: String, default: 'ADJ' }, pad: { type: Number, default: 5 } },
        transfer: { prefix: { type: String, default: 'TRF' }, pad: { type: Number, default: 5 } },
        expense: { prefix: { type: String, default: 'EXP' }, pad: { type: Number, default: 5 } },
        visit: { prefix: { type: String, default: 'VIS' }, pad: { type: Number, default: 5 } },
        customer: { prefix: { type: String, default: 'CUS' }, pad: { type: Number, default: 5 } },
        product: { prefix: { type: String, default: 'PRD' }, pad: { type: Number, default: 5 } },
        supplier: { prefix: { type: String, default: 'SUP' }, pad: { type: Number, default: 5 } },
      },
      default: () => ({}),
    },

    // Tax config (GST / VAT)
    tax: {
      type: {
        regime: { type: String, enum: ['GST', 'VAT', 'SALES_TAX', 'NONE'], default: 'GST' },
        defaultTaxRate: { type: Number, default: 18, min: 0, max: 100 },
        taxInclusive: { type: Boolean, default: false },
        placeOfSupply: { type: String, default: '' },
        enableCgstSgst: { type: Boolean, default: true },
        eInvoiceEnabled: { type: Boolean, default: false },
        eInvoiceGstin: { type: String, default: '' },
        taxLabel: { type: String, default: 'GST' },
      },
      default: () => ({}),
    },

    // Invoicing
    invoice: {
      type: {
        terms: { type: String, default: 'Goods once sold will not be taken back.' },
        footerNote: { type: String, default: 'Thank you for your business!' },
        defaultDueDays: { type: Number, default: 0 },
        showQr: { type: Boolean, default: true },
        upiVpa: { type: String, default: '' },
        showGstin: { type: Boolean, default: true },
        rounding: { type: String, enum: ['NEAREST', 'DOWN', 'NONE'], default: BUSINESS_DEFAULTS.rounding },
        defaultPaymentTerms: { type: String, default: 'IMMEDIATE' },
        allowDirectInvoice: { type: Boolean, default: true },
      },
      default: () => ({}),
    },

    // Order rules
    order: {
      type: {
        approvalThreshold: { type: Number, default: BUSINESS_DEFAULTS.orderApprovalThreshold },
        creditLimitAction: { type: String, enum: ['WARN', 'BLOCK', 'NONE'], default: BUSINESS_DEFAULTS.creditLimitAction },
        reserveStockOnConfirm: { type: Boolean, default: true },
        allowNegativeStock: { type: Boolean, default: BUSINESS_DEFAULTS.allowNegativeStock },
        defaultPaymentMode: { type: String, default: 'CREDIT' },
        showStockOnOrder: { type: Boolean, default: true },
      },
      default: () => ({}),
    },

    // Inventory
    inventory: {
      type: {
        defaultWarehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
        lowStockThreshold: { type: Number, default: BUSINESS_DEFAULTS.lowStockThreshold },
        valuationMethod: { type: String, enum: ['FIFO', 'AVERAGE', 'LIFO'], default: 'FIFO' },
        batchExpiry: { type: Boolean, default: false },
        defaultTransferWarehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
      },
      default: () => ({}),
    },

    // Purchasing (PO -> GRN)
    purchase: {
      type: {
        defaultPaymentTerms: { type: String, default: 'NET_30' },
        defaultLeadDays: { type: Number, default: 7 },
        autoSendOnCreate: { type: Boolean, default: false },
        requireGrnNote: { type: Boolean, default: true },
      },
      default: () => ({}),
    },

    // Field force
    fieldForce: {
      type: {
        geofenceRadiusM: { type: Number, default: 100 },
        requireGps: { type: Boolean, default: true },
        requireSelfie: { type: Boolean, default: false },
        trackLiveLocation: { type: Boolean, default: true },
        workStart: { type: String, default: '09:30' },
        workEnd: { type: String, default: '18:30' },
      },
      default: () => ({}),
    },

    // Credit control / collections
    collections: {
      type: {
        overdueReminderDays: { type: Number, default: 3 },
        sendOverdueReminders: { type: Boolean, default: true },
        fifoAllocationDefault: { type: Boolean, default: true },
      },
      default: () => ({}),
    },

    // RBAC: role -> permission matrix (COMPANY_ADMIN customizable)
    rolePermissions: { type: Object, default: () => buildDefaultPermissions() },

    // Roles the admin has deleted/renamed (extension hook)
    customRoles: { type: [Object], default: [] },

    // Feature toggles for this company (mirrors plan flags, admin can tweak)
    featureFlags: { type: Object, default: () => ({}) },

    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, default: '' },

    // Onboarding checklist state
    setupProgress: {
      type: {
        profile: { type: Boolean, default: false },
        users: { type: Boolean, default: false },
        customers: { type: Boolean, default: false },
        products: { type: Boolean, default: false },
        warehouse: { type: Boolean, default: false },
        firstOrder: { type: Boolean, default: false },
      },
      default: () => ({}),
    },
  },
  { timestamps: true }
);

settingSchema.plugin(tenantPlugin, { uniqueCompany: true });

/** Get (or lazily create) the singleton settings doc for a company. */
settingSchema.statics.forCompany = async function (companyId) {
  let doc = await this.findOne({ companyId });
  if (!doc) {
    try {
      doc = await this.create({ companyId });
    } catch (e) {
      if (e.code === 11000) doc = await this.findOne({ companyId });
      else throw e;
    }
  }
  return doc;
};

const Setting = mongoose.models.Setting || mongoose.model('Setting', settingSchema);
export default Setting;
