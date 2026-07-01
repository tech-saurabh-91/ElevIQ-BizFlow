const BaseController = require('./BaseController');
const { ApiResponse, PaginatedResponse, ApiError } = require('../utils/apiResponse');

class ItemController extends BaseController {
  constructor() { super(require('../models').Item); }
  _getSearchableFields() { return ['itemName', 'itemCode', 'sku', 'brand', 'category', 'customerItemCode']; }
  _getPopulateFields() { return ['groupId', 'subGroupId', 'taxId', 'hsnId']; }
}

class CustomerController extends BaseController {
  constructor() { super(require('../models').Customer); }
  _getSearchableFields() { return ['customerName', 'customerCode', 'phone', 'email']; }
  _getPopulateFields() { return ['routeId', 'locationId']; }
}

class RouteController extends BaseController {
  constructor() { super(require('../models').Route); }
  _getSearchableFields() { return ['routeName', 'routeNumber']; }
  _getPopulateFields() { return []; }

  getAll = async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const filter = { companyId: req.companyId, isActive: true };

      if (req.query.search) {
        const searchRegex = new RegExp(req.query.search, 'i');
        filter.$or = this._getSearchableFields().map(field => ({ [field]: searchRegex }));
      }

      const [docs, total] = await Promise.all([
        this.Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
          .populate({ path: 'customers', model: 'Customer' }),
        this.Model.countDocuments(filter),
      ]);

      return res.status(200).json(new PaginatedResponse(200, docs, 'Fetched successfully', page, limit, total));
    } catch (error) {
      next(error);
    }
  };
}

class LocationController extends BaseController {
  constructor() { super(require('../models').Location); }
  _getSearchableFields() { return ['locationName', 'address', 'city']; }
  _getPopulateFields() { return ['customerId']; }
}

class VanTargetController extends BaseController {
  constructor() { super(require('../models').VanTarget); }
  _getSearchableFields() { return []; }
  _getPopulateFields() { return ['vanId']; }
}

class SchemeController extends BaseController {
  constructor() { super(require('../models').Scheme); }
  _getSearchableFields() { return ['schemeName', 'schemeCode']; }
  _getPopulateFields() { return []; }

  getAll = async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const filter = { companyId: req.companyId, isActive: true };

      if (req.query.search) {
        const searchRegex = new RegExp(req.query.search, 'i');
        filter.$or = this._getSearchableFields().map(field => ({ [field]: searchRegex }));
      }

      const [docs, total] = await Promise.all([
        this.Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
          .populate({ path: 'items.itemId', model: 'Item' })
          .populate({ path: 'freeItems.itemId', model: 'Item' }),
        this.Model.countDocuments(filter),
      ]);

      return res.status(200).json(new PaginatedResponse(200, docs, 'Fetched successfully', page, limit, total));
    } catch (error) {
      next(error);
    }
  };
}

class DiscountController extends BaseController {
  constructor() { super(require('../models').Discount); }
  _getSearchableFields() { return ['discountGroup']; }
  _getPopulateFields() { return ['items.itemId']; }

  getAll = async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const filter = { companyId: req.companyId };

      if (req.query.search) {
        filter.discountGroup = { $regex: req.query.search, $options: 'i' };
      }

      const [docs, total] = await Promise.all([
        this.Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
          .populate({ path: 'items.itemId', model: 'Item', select: 'itemCode itemName unit' }),
        this.Model.countDocuments(filter),
      ]);

      return res.status(200).json(new PaginatedResponse(200, docs, 'Fetched successfully', page, limit, total));
    } catch (error) { next(error); }
  };

  create = async (req, res, next) => {
    try {
      const data = { ...req.body, companyId: req.companyId, createdBy: req.userId };
      const doc = await this.Model.create(data);
      return res.status(201).json(new ApiResponse(201, doc, 'Created successfully'));
    } catch (error) { next(error); }
  };

  update = async (req, res, next) => {
    try {
      const doc = await this.Model.findOneAndUpdate(
        { _id: req.params.id, companyId: req.companyId },
        req.body,
        { new: true, runValidators: true }
      );
      if (!doc) throw new ApiError(404, 'Not found');
      return res.status(200).json(new ApiResponse(200, doc, 'Updated successfully'));
    } catch (error) { next(error); }
  };
}

class StockAdjustmentController extends BaseController {
  constructor() { super(require('../models').StockAdjustment); }
  _getSearchableFields() { return ['adjustmentCode', 'remarks']; }
  _getPopulateFields() { return ['warehouseId', 'items.itemId']; }

  getAll = async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const filter = { companyId: req.companyId, isActive: true };

      if (req.query.search) {
        const searchRegex = new RegExp(req.query.search, 'i');
        filter.$or = [{ adjustmentCode: searchRegex }, { remarks: searchRegex }];
      }

      const [docs, total] = await Promise.all([
        this.Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
          .populate({ path: 'warehouseId', select: 'warehouseName warehouseCode' })
          .populate({ path: 'items.itemId', select: 'itemName itemCode unit' })
          .populate({ path: 'createdBy', select: 'firstName lastName email' }),
        this.Model.countDocuments(filter),
      ]);

      return res.status(200).json(new PaginatedResponse(200, docs, 'Fetched successfully', page, limit, total));
    } catch (error) {
      next(error);
    }
  };

  create = async (req, res, next) => {
    try {
      const { StockSummary, StockTransaction } = require('../models');
      const { warehouseId, adjustmentDate, adjustmentMode, remarks, items } = req.body;

      if (!items || items.length === 0) {
        throw new ApiError(400, 'Please add at least one item');
      }

      const adjustment = await this.Model.create({
        companyId: req.companyId,
        warehouseId,
        adjustmentDate,
        adjustmentMode: adjustmentMode || 'manual',
        remarks,
        items: items.map(i => ({
          itemId: i.itemId,
          itemCode: i.itemCode,
          itemName: i.itemName,
          unit: i.unit,
          sfaQty: i.sfaQty,
          addSub: i.addSub,
          adjustQty: i.adjustQty,
        })),
        createdBy: req.user._id,
      });

      for (const item of items) {
        const qty = Number(item.adjustQty);
        const isAdd = item.addSub === 'add';

        const summary = await StockSummary.findOne({
          companyId: req.companyId,
          itemId: item.itemId,
          warehouseId,
        });

        if (!summary) {
          throw new ApiError(400, `Stock summary not found for item ${item.itemCode || item.itemId}`);
        }

        if (!isAdd && summary.availableQty < qty) {
          throw new ApiError(400, `Insufficient stock for ${item.itemCode}. Available: ${summary.availableQty}, Requested: ${qty}`);
        }

        summary.balanceQty = isAdd ? summary.balanceQty + qty : summary.balanceQty - qty;
        summary.availableQty = isAdd ? summary.availableQty + qty : summary.availableQty - qty;
        await summary.save();

        await StockTransaction.create({
          companyId: req.companyId,
          itemId: item.itemId,
          warehouseId,
          transactionType: isAdd ? 'A' : 'S',
          quantity: qty,
          referenceType: 'stock_adjustment',
          referenceId: adjustment._id,
          referenceNumber: adjustment.adjustmentCode,
          createdBy: req.user._id,
        });
      }

      return res.status(201).json(new ApiResponse(201, adjustment, 'Stock adjustment created successfully'));
    } catch (error) {
      next(error);
    }
  };

  update = async (req, res, next) => {
    try {
      const existing = await this.Model.findOne({ _id: req.params.id, companyId: req.companyId });
      if (!existing) throw new ApiError(404, 'Record not found');

      const { warehouseId, adjustmentDate, adjustmentMode, remarks, items } = req.body;

      if (existing.status !== 'draft') {
        throw new ApiError(400, 'Only draft adjustments can be edited');
      }

      const { StockSummary, StockTransaction } = require('../models');

      for (const oldItem of existing.items) {
        const isAdd = oldItem.addSub === 'add';
        const qty = oldItem.adjustQty;
        const summary = await StockSummary.findOne({
          companyId: req.companyId,
          itemId: oldItem.itemId,
          warehouseId: existing.warehouseId,
        });
        if (summary) {
          summary.balanceQty = isAdd ? summary.balanceQty - qty : summary.balanceQty + qty;
          summary.availableQty = isAdd ? summary.availableQty - qty : summary.availableQty + qty;
          await summary.save();
        }
      }

      await StockTransaction.deleteMany({
        companyId: req.companyId,
        referenceType: 'stock_adjustment',
        referenceId: existing._id,
      });

      existing.warehouseId = warehouseId || existing.warehouseId;
      existing.adjustmentDate = adjustmentDate || existing.adjustmentDate;
      existing.adjustmentMode = adjustmentMode || existing.adjustmentMode;
      existing.remarks = remarks !== undefined ? remarks : existing.remarks;
      existing.items = items || existing.items;
      await existing.save();

      for (const item of existing.items) {
        const qty = Number(item.adjustQty);
        const isAdd = item.addSub === 'add';

        const summary = await StockSummary.findOne({
          companyId: req.companyId,
          itemId: item.itemId,
          warehouseId: existing.warehouseId,
        });

        if (!summary) {
          throw new ApiError(400, `Stock summary not found for item ${item.itemCode || item.itemId}`);
        }

        if (!isAdd && summary.availableQty < qty) {
          throw new ApiError(400, `Insufficient stock for ${item.itemCode}. Available: ${summary.availableQty}, Requested: ${qty}`);
        }

        summary.balanceQty = isAdd ? summary.balanceQty + qty : summary.balanceQty - qty;
        summary.availableQty = isAdd ? summary.availableQty + qty : summary.availableQty - qty;
        await summary.save();

        await StockTransaction.create({
          companyId: req.companyId,
          itemId: item.itemId,
          warehouseId: existing.warehouseId,
          transactionType: isAdd ? 'A' : 'S',
          quantity: qty,
          referenceType: 'stock_adjustment',
          referenceId: existing._id,
          referenceNumber: existing.adjustmentCode,
          createdBy: req.user._id,
        });
      }

      return res.status(200).json(new ApiResponse(200, existing, 'Stock adjustment updated successfully'));
    } catch (error) {
      next(error);
    }
  };
}

class StockSummaryController extends BaseController {
  constructor() { super(require('../models').StockSummary); }
  _getSearchableFields() { return []; }
  _getPopulateFields() { return ['itemId', 'warehouseId']; }

  getAll = async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 500;
      const skip = (page - 1) * limit;
      const filter = { companyId: req.companyId };

      if (req.query.warehouseId) filter.warehouseId = req.query.warehouseId;
      if (req.query.itemId) filter.itemId = req.query.itemId;

      const [docs, total] = await Promise.all([
        this.Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
          .populate({ path: 'itemId', select: 'itemName itemCode unit' })
          .populate({ path: 'warehouseId', select: 'warehouseName warehouseCode' }),
        this.Model.countDocuments(filter),
      ]);

      return res.status(200).json(new PaginatedResponse(200, docs, 'Fetched successfully', page, limit, total));
    } catch (error) {
      next(error);
    }
  };
}

class OtherParameterController extends BaseController {
  constructor() { super(require('../models').OtherParameter); }
  _getSearchableFields() { return ['parameterType', 'parameterValue']; }
  _getPopulateFields() { return []; }

  getAll = async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 100;
      const skip = (page - 1) * limit;
      const filter = { companyId: req.companyId, isActive: true };

      if (req.query.type || req.query.parameterType) {
        filter.parameterType = req.query.type || req.query.parameterType;
      }

      if (req.query.search) {
        const searchRegex = new RegExp(req.query.search, 'i');
        filter.$or = this._getSearchableFields().map(field => ({ [field]: searchRegex }));
      }

      const [docs, total] = await Promise.all([
        this.Model.find(filter).sort({ sortOrder: 1, createdAt: -1 }).skip(skip).limit(limit),
        this.Model.countDocuments(filter),
      ]);

      return res.status(200).json({ statusCode: 200, success: true, message: 'Fetched successfully', data: docs, page, limit, total });
    } catch (error) {
      next(error);
    }
  };
}

class CountryController extends BaseController {
  constructor() { super(require('../models').Country); }
  _getSearchableFields() { return ['countryName', 'countryCode', 'currency']; }
  _getPopulateFields() { return []; }
}

class AttendanceController extends BaseController {
  constructor() { super(require('../models').Attendance); }
  _getSearchableFields() { return []; }
  _getPopulateFields() { return ['userId']; }
}

class TourVisitController extends BaseController {
  constructor() { super(require('../models').TourVisit); }
  _getSearchableFields() { return ['purpose', 'outcome']; }
  _getPopulateFields() { return ['executiveId', 'customerId']; }
}

class SalesOrderController extends BaseController {
  constructor() { super(require('../models').SalesOrder); }
  _getSearchableFields() { return ['orderNumber']; }
  _getPopulateFields() { return ['customerId', 'executiveId', 'warehouseId']; }
}

class ExpenseController extends BaseController {
  constructor() { super(require('../models').Expense); }
  _getSearchableFields() { return ['expenseNumber', 'expenseType', 'description']; }
  _getPopulateFields() { return ['executiveId']; }
}

class ExecutiveVanAssignmentController extends BaseController {
  constructor() { super(require('../models').ExecutiveVanAssignment); }
  _getSearchableFields() { return []; }
  _getPopulateFields() { return ['executiveId', 'vanId']; }

  getAll = async (req, res, next) => {
    try {
      const { ExecutiveVanAssignment } = require('../models');
      const filter = { companyId: req.companyId, isActive: true };

      const assignments = await ExecutiveVanAssignment.find(filter)
        .populate({ path: 'executiveId', model: 'User', select: 'firstName lastName email' })
        .populate({ path: 'vanId', model: 'Warehouse', select: 'warehouseName vanNumber vanParentWarehouseId isVanWarehouse', populate: { path: 'vanParentWarehouseId', model: 'Warehouse', select: 'warehouseName' } })
        .populate({ path: 'createdBy', model: 'User', select: 'firstName lastName' })
        .sort({ createdAt: -1 });

      const grouped = {};
      assignments.forEach(a => {
        const vanId = a.vanId?._id?.toString() || 'unknown';
        if (!grouped[vanId]) {
          grouped[vanId] = {
            vanId: a.vanId,
            executives: [],
            createdBy: a.createdBy,
            updatedAt: a.updatedAt,
          };
        }
        grouped[vanId].executives.push({
          _id: a._id,
          executiveId: a.executiveId,
          dayCashOutMandatory: a.dayCashOutMandatory,
        });
      });

      const result = Object.entries(grouped).map(([vanId, group]) => ({ _id: vanId, ...group }));
      return res.status(200).json({ statusCode: 200, success: true, message: 'Fetched successfully', data: result });
    } catch (error) { next(error); }
  };

  create = async (req, res, next) => {
    try {
      const { ExecutiveVanAssignment } = require('../models');
      const { vanId, executives } = req.body;

      if (!vanId || !executives || executives.length === 0) {
        throw new ApiError(400, 'VAN and at least one executive are required');
      }

      for (const exec of executives) {
        const existingExec = await ExecutiveVanAssignment.findOne({
          executiveId: exec.executiveId, companyId: req.companyId, isActive: true,
        });
        if (existingExec) {
          const u = await require('../models').User.findById(exec.executiveId).select('firstName lastName');
          throw new ApiError(400, `${u?.firstName || 'This user'} ${u?.lastName || ''} is already linked to another VAN/warehouse.`);
        }
      }

      const yesCount = executives.filter(e => e.dayCashOutMandatory).length;
      if (yesCount > 1) {
        throw new ApiError(400, 'Only one user can have Day Cash Out Mandatory = Yes per VAN.');
      }

      if (yesCount === 1) {
        const existingCashOut = await ExecutiveVanAssignment.findOne({
          companyId: req.companyId, dayCashOutMandatory: true, isActive: true,
          vanId: { $ne: vanId },
        });
        if (existingCashOut) {
          throw new ApiError(400, 'Only one user can have Day Cash Out Mandatory = Yes across all VANs.');
        }
      }

      const docs = executives.map(exec => ({
        companyId: req.companyId,
        vanId,
        executiveId: exec.executiveId,
        dayCashOutMandatory: exec.dayCashOutMandatory || false,
        createdBy: req.user._id,
      }));

      const result = await this.Model.insertMany(docs);
      return res.status(201).json(new ApiResponse(201, result, 'Assigned successfully'));
    } catch (error) { next(error); }
  };

  update = async (req, res, next) => {
    try {
      const { ExecutiveVanAssignment } = require('../models');
      const { vanId, executives } = req.body;

      if (!vanId || !executives || executives.length === 0) {
        throw new ApiError(400, 'VAN and at least one executive are required');
      }

      for (const exec of executives) {
        if (exec._id) continue;
        const existingExec = await ExecutiveVanAssignment.findOne({
          executiveId: exec.executiveId, companyId: req.companyId, isActive: true,
        });
        if (existingExec) {
          const u = await require('../models').User.findById(exec.executiveId).select('firstName lastName');
          throw new ApiError(400, `${u?.firstName || 'This user'} ${u?.lastName || ''} is already linked to another VAN/warehouse.`);
        }
      }

      const yesCount = executives.filter(e => e.dayCashOutMandatory).length;
      if (yesCount > 1) {
        throw new ApiError(400, 'Only one user can have Day Cash Out Mandatory = Yes per VAN.');
      }

      if (yesCount === 1) {
        const existingCashOut = await ExecutiveVanAssignment.findOne({
          companyId: req.companyId, dayCashOutMandatory: true, isActive: true,
          vanId: { $ne: vanId },
        });
        if (existingCashOut) {
          throw new ApiError(400, 'Only one user can have Day Cash Out Mandatory = Yes across all VANs.');
        }
      }

      const existingForVan = await this.Model.find({ vanId, companyId: req.companyId, isActive: true });
      const existingIds = existingForVan.map(e => e._id.toString());
      const incomingIds = executives.filter(e => e._id).map(e => e._id);

      const toDelete = existingIds.filter(id => !incomingIds.includes(id));
      if (toDelete.length > 0) {
        await this.Model.updateMany({ _id: { $in: toDelete } }, { isActive: false, updatedBy: req.user._id });
      }

      for (const exec of executives) {
        if (exec._id) {
          await this.Model.findOneAndUpdate(
            { _id: exec._id, companyId: req.companyId },
            { dayCashOutMandatory: exec.dayCashOutMandatory, updatedBy: req.user._id }
          );
        } else {
          await this.Model.create({
            companyId: req.companyId,
            vanId,
            executiveId: exec.executiveId,
            dayCashOutMandatory: exec.dayCashOutMandatory || false,
            createdBy: req.user._id,
          });
        }
      }

      return res.status(200).json(new ApiResponse(200, null, 'Updated successfully'));
    } catch (error) { next(error); }
  };

  delete = async (req, res, next) => {
    try {
      const { vanId } = req.params;
      const result = await this.Model.updateMany(
        { vanId, companyId: req.companyId, isActive: true },
        { isActive: false, updatedBy: req.user._id }
      );
      if (result.modifiedCount === 0) throw new ApiError(404, 'No assignments found for this VAN');
      return res.status(200).json(new ApiResponse(200, null, 'Deleted successfully'));
    } catch (error) { next(error); }
  };
}

class ExecutiveProductGroupController extends BaseController {
  constructor() { super(require('../models').ExecutiveProductGroup); }
  _getSearchableFields() { return []; }
  _getPopulateFields() { return []; }

  getAll = async (req, res, next) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      const filter = { companyId: req.companyId, isActive: true };

      const [docs, total] = await Promise.all([
        this.Model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
          .populate({ path: 'executiveId', model: 'User', select: 'firstName lastName email designation' })
          .populate({ path: 'productGroups', model: 'ItemGroup' }),
        this.Model.countDocuments(filter),
      ]);

      let filteredDocs = docs;
      if (req.query.search) {
        const searchRegex = new RegExp(req.query.search, 'i');
        filteredDocs = docs.filter(doc => {
          const exec = doc.executiveId;
          if (!exec) return false;
          return searchRegex.test(exec.firstName || '') ||
            searchRegex.test(exec.lastName || '') ||
            searchRegex.test(exec.email || '');
        });
      }

      return res.status(200).json(new PaginatedResponse(200, filteredDocs, 'Fetched successfully', page, limit, total));
    } catch (error) {
      next(error);
    }
  };

  create = async (req, res, next) => {
    try {
      const { ExecutiveProductGroup } = require('../models');
      const existing = await ExecutiveProductGroup.findOne({
        executiveId: req.body.executiveId,
        companyId: req.companyId,
        isActive: true,
      });
      if (existing) {
        throw new ApiError(400, 'This executive already has a product group allocation. Please edit the existing one.');
      }
      const data = { ...req.body, companyId: req.companyId, createdBy: req.user._id };
      const doc = await this.Model.create(data);
      return res.status(201).json(new ApiResponse(201, doc, 'Created successfully'));
    } catch (error) {
      next(error);
    }
  };
}

class DayCashOutController extends BaseController {
  constructor() { super(require('../models').DayCashOut); }
  _getSearchableFields() { return ['cashOutNumber', 'purpose']; }
  _getPopulateFields() { return ['executiveId']; }
}

class CashChequeDepositController extends BaseController {
  constructor() { super(require('../models').CashChequeDeposit); }
  _getSearchableFields() { return ['depositNumber']; }
  _getPopulateFields() { return ['executiveId', 'customerId']; }
}

class SalesReturnController extends BaseController {
  constructor() { super(require('../models').SalesReturn); }
  _getSearchableFields() { return ['returnNumber', 'returnReason']; }
  _getPopulateFields() { return ['customerId', 'executiveId', 'warehouseId']; }
}

class MonthlyJourneyPlanController extends BaseController {
  constructor() { super(require('../models').MonthlyJourneyPlan); }
  _getSearchableFields() { return []; }
  _getPopulateFields() { return ['executiveId']; }
}

class PreSalesTargetController extends BaseController {
  constructor() { super(require('../models').PreSalesTarget); }
  _getSearchableFields() { return []; }
  _getPopulateFields() { return ['userId']; }

  getByMonth = async (req, res, next) => {
    try {
      const { fyYear, monthInFY } = req.query;
      if (!fyYear || !monthInFY) {
        return res.status(400).json({ success: false, message: 'fyYear and monthInFY are required' });
      }
      const targets = await this.Model.find({
        companyId: req.companyId,
        fyYear: parseInt(fyYear),
        monthInFY: parseInt(monthInFY),
        isActive: true,
      }).populate({ path: 'userId', model: 'User', select: 'firstName lastName email' });
      return res.status(200).json({ success: true, data: targets });
    } catch (error) { next(error); }
  };

  saveTargets = async (req, res, next) => {
    try {
      const { targets, fyYear, fyLabel, monthInFY, calendarMonth, calendarYear } = req.body;
      if (!targets || !Array.isArray(targets) || targets.length === 0) {
        return res.status(400).json({ success: false, message: 'Targets array is required' });
      }
      const results = [];
      for (const t of targets) {
        const filter = {
          companyId: req.companyId,
          userId: t.userId,
          fyYear,
          monthInFY,
        };
        const update = {
          companyId: req.companyId,
          userId: t.userId,
          fyYear,
          fyLabel,
          monthInFY,
          calendarMonth,
          calendarYear,
          targetAmount: t.targetAmount || 0,
          createdBy: req.userId,
        };
        const doc = await this.Model.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
        results.push(doc);
      }
      return res.status(200).json({ success: true, message: 'Targets saved successfully', data: results });
    } catch (error) { next(error); }
  };
}

class VanSalesTargetController extends BaseController {
  constructor() { super(require('../models').VanSalesTarget); }
  _getSearchableFields() { return []; }
  _getPopulateFields() { return ['userId']; }

  getByMonth = async (req, res, next) => {
    try {
      const { fyYear, monthInFY } = req.query;
      if (!fyYear || !monthInFY) {
        return res.status(400).json({ success: false, message: 'fyYear and monthInFY are required' });
      }
      const targets = await this.Model.find({
        companyId: req.companyId,
        fyYear: parseInt(fyYear),
        monthInFY: parseInt(monthInFY),
        isActive: true,
      }).populate({ path: 'userId', model: 'User', select: 'firstName lastName email' });
      return res.status(200).json({ success: true, data: targets });
    } catch (error) { next(error); }
  };

  saveTargets = async (req, res, next) => {
    try {
      const { targets, fyYear, fyLabel, monthInFY, calendarMonth, calendarYear } = req.body;
      if (!targets || !Array.isArray(targets) || targets.length === 0) {
        return res.status(400).json({ success: false, message: 'Targets array is required' });
      }
      const results = [];
      for (const t of targets) {
        const filter = {
          companyId: req.companyId,
          userId: t.userId,
          fyYear,
          monthInFY,
        };
        const update = {
          companyId: req.companyId,
          userId: t.userId,
          fyYear,
          fyLabel,
          monthInFY,
          calendarMonth,
          calendarYear,
          targetAmount: t.targetAmount || 0,
          createdBy: req.userId,
        };
        const doc = await this.Model.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
        results.push(doc);
      }
      return res.status(200).json({ success: true, message: 'Targets saved successfully', data: results });
    } catch (error) { next(error); }
  };
}

module.exports = {
  itemController: new ItemController(),
  customerController: new CustomerController(),
  routeController: new RouteController(),
  locationController: new LocationController(),
  vanTargetController: new VanTargetController(),
  schemeController: new SchemeController(),
  discountController: new DiscountController(),
  stockAdjustmentController: new StockAdjustmentController(),
  stockSummaryController: new StockSummaryController(),
  otherParameterController: new OtherParameterController(),
  countryController: new CountryController(),
  attendanceController: new AttendanceController(),
  tourVisitController: new TourVisitController(),
  salesOrderController: new SalesOrderController(),
  expenseController: new ExpenseController(),
  executiveVanAssignmentController: new ExecutiveVanAssignmentController(),
  executiveProductGroupController: new ExecutiveProductGroupController(),
  dayCashOutController: new DayCashOutController(),
  cashChequeDepositController: new CashChequeDepositController(),
  salesReturnController: new SalesReturnController(),
  monthlyJourneyPlanController: new MonthlyJourneyPlanController(),
  preSalesTargetController: new PreSalesTargetController(),
  vanSalesTargetController: new VanSalesTargetController(),
};
