const mongoose = require('mongoose');

const itemGroupSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  groupName: {
    type: String,
    required: [true, 'Group name is required'],
    trim: true,
    maxlength: [100, 'Group name cannot exceed 100 characters'],
  },
  groupCode: {
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

itemGroupSchema.pre('save', async function () {
  if (this.isNew && !this.groupCode) {
    const count = await mongoose.model('ItemGroup').countDocuments({ companyId: this.companyId });
    const prefix = this.companyId.toString().slice(-4);
    this.groupCode = `GRP-${prefix}-${String(count + 1).padStart(4, '0')}`;
  }
});

module.exports = mongoose.model('ItemGroup', itemGroupSchema);
