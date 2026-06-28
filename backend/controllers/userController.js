const BaseController = require('./BaseController');
const { User, Company, Role } = require('../models');
const { ApiError, ApiResponse } = require('../utils/apiResponse');

class UserController extends BaseController {
  constructor() {
    super(User);
  }

  _getSearchableFields() {
    return ['firstName', 'lastName', 'email', 'username', 'phone'];
  }

  _getPopulateFields() {
    return ['roleId', 'assignedVAN'];
  }

  create = async (req, res, next) => {
    try {
      if (!req.body.password) {
        throw new ApiError(400, 'Password is required');
      }

      const company = await Company.findById(req.companyId);
      if (!company.canAddUser()) {
        throw new ApiError(400, `User limit reached (${company.noOfUsers}). Cannot add more users.`);
      }

      const existingUser = await User.findOne({
        $or: [
          { email: req.body.email?.toLowerCase() },
          { username: req.body.username },
        ],
        companyId: req.companyId,
      });

      if (existingUser) {
        const field = existingUser.email === req.body.email?.toLowerCase() ? 'Email' : 'Username';
        throw new ApiError(400, `${field} already exists in this company`);
      }

      const data = {
        ...req.body,
        email: req.body.email?.toLowerCase(),
        companyId: req.companyId,
        createdBy: req.user._id,
      };

      const doc = await User.create(data);
      company.activeUsers += 1;
      await company.save({ validateBeforeSave: false });

      return res.status(201).json(new ApiResponse(201, doc, 'User created successfully'));
    } catch (error) {
      next(error);
    }
  };

  deactivate = async (req, res, next) => {
    try {
      const user = await User.findOne({ _id: req.params.id, companyId: req.companyId });
      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      if (user.designation === 'admin') {
        throw new ApiError(400, 'Cannot deactivate admin user');
      }

      user.isActive = false;
      await user.save({ validateBeforeSave: false });

      const company = await Company.findById(req.companyId);
      company.activeUsers = Math.max(0, company.activeUsers - 1);
      await company.save({ validateBeforeSave: false });

      return res.status(200).json(new ApiResponse(200, null, 'User deactivated successfully'));
    } catch (error) {
      next(error);
    }
  };

  activate = async (req, res, next) => {
    try {
      const user = await User.findOne({ _id: req.params.id, companyId: req.companyId });
      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      const company = await Company.findById(req.companyId);
      if (!company.canAddUser()) {
        throw new ApiError(400, `User limit reached (${company.noOfUsers}). Cannot activate more users.`);
      }

      user.isActive = true;
      await user.save({ validateBeforeSave: false });

      company.activeUsers += 1;
      await company.save({ validateBeforeSave: false });

      return res.status(200).json(new ApiResponse(200, null, 'User activated successfully'));
    } catch (error) {
      next(error);
    }
  };

  assignApp = async (req, res, next) => {
    try {
      const { roleId } = req.body;
      const user = await User.findOne({ _id: req.params.id, companyId: req.companyId });
      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      const role = await Role.findOne({ _id: roleId, companyId: req.companyId });
      if (!role) {
        throw new ApiError(404, 'Role not found');
      }

      user.roleId = roleId;
      await user.save({ validateBeforeSave: false });

      return res.status(200).json(new ApiResponse(200, user, 'App assigned successfully'));
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new UserController();
