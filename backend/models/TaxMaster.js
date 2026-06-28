const mongoose = require('mongoose');

const taxMasterSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  taxName: {
    type: String,
    required: [true, 'Tax name is required'],
    trim: true,
    maxlength: [100, 'Tax name cannot exceed 100 characters'],
  },
  taxCode: {
    type: String,
    trim: true,
    unique: true,
  },
  totalTaxPercent: {
    type: Number,
    required: [true, 'Total tax percentage is required'],
    min: [0, 'Tax cannot be negative'],
    max: [100, 'Tax cannot exceed 100%'],
  },
  effectDate: {
    type: Date,
    required: [true, 'Effect date is required'],
  },
  gstType: {
    type: String,
    enum: ['CGST', 'SGST', 'IGST', 'CGST+SGST', 'UTGST', 'CESS', 'SIMPLE'],
    required: [true, 'GST type is required'],
  },
  cgstPercent: {
    type: Number,
    default: 0,
    min: [0, 'CGST cannot be negative'],
    max: [100, 'CGST cannot exceed 100%'],
  },
  sgstPercent: {
    type: Number,
    default: 0,
    min: [0, 'SGST cannot be negative'],
    max: [100, 'SGST cannot exceed 100%'],
  },
  igstPercent: {
    type: Number,
    default: 0,
    min: [0, 'IGST cannot be negative'],
    max: [100, 'IGST cannot exceed 100%'],
  },
  cessPercent: {
    type: Number,
    default: 0,
    min: [0, 'CESS cannot be negative'],
    max: [100, 'CESS cannot exceed 100%'],
  },
  taxType: {
    type: String,
    enum: ['sales', 'purchase', 'both'],
    default: 'sales',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

taxMasterSchema.pre('save', async function () {
  if (this.isNew && !this.taxCode) {
    const count = await mongoose.model('TaxMaster').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.taxCode = `TAX-${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
  // Auto-calculate CGST/SGST if GST type is CGST+SGST
  if (this.gstType === 'CGST+SGST') {
    this.cgstPercent = this.totalTaxPercent / 2;
    this.sgstPercent = this.totalTaxPercent / 2;
    this.igstPercent = this.totalTaxPercent;
  } else if (this.gstType === 'CGST') {
    this.cgstPercent = this.totalTaxPercent;
  } else if (this.gstType === 'SGST') {
    this.sgstPercent = this.totalTaxPercent;
  } else if (this.gstType === 'IGST') {
    this.igstPercent = this.totalTaxPercent;
  }
});;

module.exports = mongoose.model('TaxMaster', taxMasterSchema);
