const BaseController = require('./BaseController');
const { Role } = require('../models');
const { ApiError, ApiResponse } = require('../utils/apiResponse');

class RoleController extends BaseController {
  constructor() {
    super(Role);
  }

  _getSearchableFields() {
    return ['roleName', 'roleType'];
  }

  create = async (req, res, next) => {
    try {
      const existingRole = await Role.findOne({
        roleName: req.body.roleName,
        companyId: req.companyId,
      });

      if (existingRole) {
        throw new ApiError(400, 'Role with this name already exists in this company');
      }

      const data = {
        ...req.body,
        companyId: req.companyId,
        createdBy: req.user._id,
      };

      const doc = await Role.create(data);
      return res.status(201).json(new ApiResponse(201, doc, 'Role created successfully'));
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new RoleController();
