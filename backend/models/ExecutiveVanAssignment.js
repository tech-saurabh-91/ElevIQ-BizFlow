const mongoose = require('mongoose');

const executiveVanAssignmentSchema = new mongoose.Schema({
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
  vanId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: [true, 'VAN/Warehouse ID is required'],
  },
  dayCashOutMandatory: {
    type: Boolean,
    default: false,
  },
  assignedFrom: {
    type: Date,
    default: Date.now,
  },
  assignedTo: {
    type: Date,
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

module.exports = mongoose.model('ExecutiveVanAssignment', executiveVanAssignmentSchema);
