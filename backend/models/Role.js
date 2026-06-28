const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  roleName: {
    type: String,
    required: [true, 'Role name is required'],
    trim: true,
    maxlength: [100, 'Role name cannot exceed 100 characters'],
  },
  roleType: {
    type: String,
    enum: ['mobile', 'backoffice'],
    required: [true, 'Role type is required'],
  },
  mobileSubType: {
    type: String,
    enum: ['presale', 'vansale', ''],
    default: '',
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required'],
  },
  menus: [{
    menuName: {
      type: String,
      required: true,
    },
    menuPath: {
      type: String,
      required: true,
    },
    canView: { type: Boolean, default: true },
    canCreate: { type: Boolean, default: false },
    canEdit: { type: Boolean, default: false },
    canDelete: { type: Boolean, default: false },
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

roleSchema.index({ companyId: 1, roleName: 1 }, { unique: true });

module.exports = mongoose.model('Role', roleSchema);
