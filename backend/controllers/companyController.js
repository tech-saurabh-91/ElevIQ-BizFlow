const BaseController = require('./BaseController');
const { Company } = require('../models');
const { ApiError, ApiResponse } = require('../utils/apiResponse');

class CompanyController extends BaseController {
  constructor() {
    super(Company);
  }

  _getSearchableFields() {
    return ['companyName', 'companyCode', 'email'];
  }

  _getPopulateFields() {
    return ['adminUserId'];
  }

  getCompanyDetails = async (req, res, next) => {
    try {
      const company = await Company.findById(req.companyId).populate('adminUserId');
      if (!company) {
        throw new ApiError(404, 'Company not found');
      }

      return res.status(200).json(new ApiResponse(200, {
        ...company.toObject(),
        isLicenseValid: company.isLicenseValid(),
        canAddUser: company.canAddUser(),
        daysUntilExpiry: Math.ceil((company.licenseValidTo - new Date()) / (1000 * 60 * 60 * 24)),
      }, 'Company details fetched'));
    } catch (error) {
      next(error);
    }
  };

  updateCompany = async (req, res, next) => {
    try {
      const company = await Company.findById(req.companyId);
      if (!company) {
        throw new ApiError(404, 'Company not found');
      }

      const allowedUpdates = ['companyName', 'phone', 'address', 'city', 'state', 'country', 'pincode', 'website', 'gstNumber', 'stateCode'];
      allowedUpdates.forEach(field => {
        if (req.body[field] !== undefined) {
          company[field] = req.body[field];
        }
      });

      // Handle taxInclusive change with validation
      if (req.body.taxInclusive !== undefined) {
        if (!company.canChangeTaxInclusive()) {
          throw new ApiError(400, 'Tax Inclusive/Exclusive setting is locked and cannot be changed after transactions have been created. Contact system administrator.');
        }
        company.taxInclusive = req.body.taxInclusive;
        company.taxInclusiveSetOn = new Date();
      }

      await company.save();

      return res.status(200).json(new ApiResponse(200, {
        ...company.toObject(),
        isLicenseValid: company.isLicenseValid(),
        canAddUser: company.canAddUser(),
        canChangeTaxInclusive: company.canChangeTaxInclusive(),
      }, 'Company updated successfully'));
    } catch (error) {
      next(error);
    }
  };

  extendLicense = async (req, res, next) => {
    try {
      const { licenseValidTo } = req.body;
      if (!licenseValidTo) throw new ApiError(400, 'licenseValidTo is required');

      const newDate = new Date(licenseValidTo);
      const today = new Date();
      if (newDate <= today) throw new ApiError(400, 'New expiry date must be in the future');

      const company = await Company.findById(req.companyId);
      if (!company) throw new ApiError(404, 'Company not found');

      company.licenseValidTo = newDate;
      await company.save();

      return res.status(200).json(new ApiResponse(200, {
        licenseValidTo: company.licenseValidTo,
        isLicenseValid: company.isLicenseValid(),
        daysUntilExpiry: Math.ceil((company.licenseValidTo - new Date()) / (1000 * 60 * 60 * 24)),
      }, 'License extended successfully'));
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new CompanyController();
