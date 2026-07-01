const BaseController = require('./BaseController');
const { Warehouse } = require('../models');
const { ApiError, ApiResponse } = require('../utils/apiResponse');

class WarehouseController extends BaseController {
  constructor() {
    super(Warehouse);
  }

  _getSearchableFields() {
    return ['warehouseName', 'warehouseCode', 'city', 'natureOfWarehouse'];
  }

  _getPopulateFields() {
    return ['parentWarehouseId', 'vanParentWarehouseId'];
  }

  create = async (req, res, next) => {
    try {
      if (req.body.isParentWarehouse) {
        const existing = await Warehouse.findOne({ companyId: req.companyId, isParentWarehouse: true, isActive: true });
        if (existing) {
          throw new ApiError(400, `A parent warehouse already exists (${existing.warehouseName}). Only one parent warehouse is allowed.`);
        }
      }
      const data = { ...req.body, companyId: req.companyId, createdBy: req.user._id };
      const doc = await this.Model.create(data);
      return res.status(201).json(new ApiResponse(201, doc, 'Created successfully'));
    } catch (error) { next(error); }
  };

  update = async (req, res, next) => {
    try {
      if (req.body.isParentWarehouse) {
        const existing = await Warehouse.findOne({ companyId: req.companyId, isParentWarehouse: true, isActive: true, _id: { $ne: req.params.id } });
        if (existing) {
          throw new ApiError(400, `A parent warehouse already exists (${existing.warehouseName}). Only one parent warehouse is allowed.`);
        }
      }
      const updates = { ...req.body, updatedBy: req.user._id };
      const doc = await this.Model.findOneAndUpdate(
        { _id: req.params.id, companyId: req.companyId },
        updates, { new: true, runValidators: true }
      );
      if (!doc) throw new ApiError(404, 'Record not found');
      return res.status(200).json(new ApiResponse(200, doc, 'Updated successfully'));
    } catch (error) { next(error); }
  };
}

module.exports = new WarehouseController();
