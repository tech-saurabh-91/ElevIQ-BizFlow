const BaseController = require('./BaseController');
const { Approval } = require('../models');
const { ApiError, ApiResponse } = require('../utils/apiResponse');

class ApprovalController extends BaseController {
  constructor() {
    super(Approval);
  }

  getPendingApprovals = async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const filter = { companyId: req.companyId, status: 'pending' };

      if (req.query.approvalType) {
        filter.approvalType = req.query.approvalType;
      }

      const [approvals, total] = await Promise.all([
        Approval.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate('requestedBy', 'firstName lastName email'),
        Approval.countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        statusCode: 200,
        data: approvals,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  };

  approveRequest = async (req, res, next) => {
    try {
      const { remarks } = req.body;
      const approval = await Approval.findOne({ _id: req.params.id, companyId: req.companyId });

      if (!approval) {
        throw new ApiError(404, 'Approval request not found');
      }

      if (approval.status !== 'pending') {
        throw new ApiError(400, `This request is already ${approval.status}`);
      }

      approval.status = 'approved';
      approval.approvedBy = req.user._id;
      approval.approvedAt = new Date();
      approval.remarks = remarks;

      await approval.save();

      // Update the referenced model status
      const Model = require('../models')[approval.referenceModel];
      if (Model) {
        await Model.findByIdAndUpdate(approval.referenceId, {
          status: 'approved',
          approvedBy: req.user._id,
          approvedAt: new Date(),
        });
      }

      return res.status(200).json(new ApiResponse(200, approval, 'Approved successfully'));
    } catch (error) {
      next(error);
    }
  };

  rejectRequest = async (req, res, next) => {
    try {
      const { rejectionReason } = req.body;

      if (!rejectionReason) {
        throw new ApiError(400, 'Rejection reason is required');
      }

      const approval = await Approval.findOne({ _id: req.params.id, companyId: req.companyId });

      if (!approval) {
        throw new ApiError(404, 'Approval request not found');
      }

      if (approval.status !== 'pending') {
        throw new ApiError(400, `This request is already ${approval.status}`);
      }

      approval.status = 'rejected';
      approval.approvedBy = req.user._id;
      approval.approvedAt = new Date();
      approval.rejectionReason = rejectionReason;

      await approval.save();

      // Update the referenced model status
      const Model = require('../models')[approval.referenceModel];
      if (Model) {
        await Model.findByIdAndUpdate(approval.referenceId, {
          status: 'rejected',
          approvedBy: req.user._id,
          approvedAt: new Date(),
        });
      }

      return res.status(200).json(new ApiResponse(200, approval, 'Rejected successfully'));
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new ApprovalController();
