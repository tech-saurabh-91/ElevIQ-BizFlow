const { ApiResponse, PaginatedResponse, ApiError } = require('../utils/apiResponse');

class BaseController {
  constructor(Model) {
    this.Model = Model;
  }

  create = async (req, res, next) => {
    try {
      const data = { ...req.body, companyId: req.companyId, createdBy: req.user._id };
      const doc = await this.Model.create(data);
      return res.status(201).json(new ApiResponse(201, doc, 'Created successfully'));
    } catch (error) {
      next(error);
    }
  };

  getAll = async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const filter = { companyId: req.companyId, isActive: true };

      if (req.query.search) {
        const searchRegex = new RegExp(req.query.search, 'i');
        const searchableFields = this._getSearchableFields();
        if (searchableFields.length > 0) {
          filter.$or = searchableFields.map(field => ({ [field]: searchRegex }));
        }
      }

      const [docs, total] = await Promise.all([
        this.Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(this._getPopulateFields()),
        this.Model.countDocuments(filter),
      ]);

      return res.status(200).json(new PaginatedResponse(200, docs, 'Fetched successfully', page, limit, total));
    } catch (error) {
      next(error);
    }
  };

  getById = async (req, res, next) => {
    try {
      const doc = await this.Model.findOne({ _id: req.params.id, companyId: req.companyId }).populate(this._getPopulateFields());
      if (!doc) {
        throw new ApiError(404, 'Record not found');
      }
      return res.status(200).json(new ApiResponse(200, doc, 'Fetched successfully'));
    } catch (error) {
      next(error);
    }
  };

  update = async (req, res, next) => {
    try {
      const updates = { ...req.body, updatedBy: req.user._id };
      if (updates.password === '' || updates.password === undefined || updates.password === null) {
        delete updates.password;
      }
      const doc = await this.Model.findOneAndUpdate(
        { _id: req.params.id, companyId: req.companyId },
        updates,
        { new: true, runValidators: true }
      );
      if (!doc) {
        throw new ApiError(404, 'Record not found');
      }
      return res.status(200).json(new ApiResponse(200, doc, 'Updated successfully'));
    } catch (error) {
      next(error);
    }
  };

  delete = async (req, res, next) => {
    try {
      const doc = await this.Model.findOneAndUpdate(
        { _id: req.params.id, companyId: req.companyId },
        { isActive: false },
        { new: true }
      );
      if (!doc) {
        throw new ApiError(404, 'Record not found');
      }
      return res.status(200).json(new ApiResponse(200, null, 'Deleted successfully'));
    } catch (error) {
      next(error);
    }
  };

  _getSearchableFields() {
    return ['name'];
  }

  _getPopulateFields() {
    return [];
  }
}

module.exports = BaseController;
