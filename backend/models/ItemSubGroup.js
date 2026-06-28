const mongoose = require('mongoose');

const itemSubGroupSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ItemGroup',
    required: [true, 'Group ID is required'],
  },
  subGroupName: {
    type: String,
    required: [true, 'Sub-group name is required'],
    trim: true,
    maxlength: [100, 'Sub-group name cannot exceed 100 characters'],
  },
  subGroupCode: {
    type: String,
    trim: true,
    unique: true,
  },
  description: {
    type: String,
    trim: true,
  },
  image: {
    type: String,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, { timestamps: true });

itemSubGroupSchema.pre('save', async function () {
  if (this.isNew && !this.subGroupCode) {
    const count = await mongoose.model('ItemSubGroup').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.subGroupCode = `SUB-${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('ItemSubGroup', itemSubGroupSchema);
