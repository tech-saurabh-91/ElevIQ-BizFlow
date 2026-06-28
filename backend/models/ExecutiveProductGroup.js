const mongoose = require('mongoose');

const executiveProductGroupSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  executiveId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Executive user ID is required'],
  },
  productGroups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ItemGroup',
  }],
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

executiveProductGroupSchema.index({ companyId: 1, executiveId: 1 }, { unique: true });

module.exports = mongoose.model('ExecutiveProductGroup', executiveProductGroupSchema);
