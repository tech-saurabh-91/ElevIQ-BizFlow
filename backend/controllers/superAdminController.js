const { SuperAdmin, Company, User, Role } = require('../models');
const { ApiError, ApiResponse } = require('../utils/apiResponse');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const generateSuperAdminToken = (id) => {
  return jwt.sign({ id, role: 'superadmin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new ApiError(400, 'Email and password are required');

    const admin = await SuperAdmin.findOne({ email, isActive: true }).select('+password');
    if (!admin) throw new ApiError(401, 'Invalid email or password');

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) throw new ApiError(401, 'Invalid email or password');

    const token = generateSuperAdminToken(admin._id);
    return res.status(200).json(new ApiResponse(200, {
      token,
      admin: { _id: admin._id, name: admin.name, email: admin.email, role: admin.role },
    }, 'Login successful'));
  } catch (error) {
    next(error);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    const admin = await SuperAdmin.findById(req.adminId);
    if (!admin) throw new ApiError(404, 'Admin not found');
    return res.status(200).json(new ApiResponse(200, admin, 'Admin details'));
  } catch (error) {
    next(error);
  }
};

exports.getAllCompanies = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { companyCode: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await Company.countDocuments(query);
    const companies = await Company.find(query)
      .populate('adminUserId', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const enriched = companies.map(c => ({
      ...c.toObject(),
      isLicenseValid: c.isLicenseValid(),
      daysUntilExpiry: Math.ceil((c.licenseValidTo - new Date()) / (1000 * 60 * 60 * 24)),
      activeUserCount: c.activeUsers,
    }));

    return res.status(200).json(new ApiResponse(200, {
      data: enriched,
      pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) },
    }, 'Companies fetched'));
  } catch (error) {
    next(error);
  }
};

exports.createCompany = async (req, res, next) => {
  try {
    const {
      companyName, email, phone, phoneCountryCode, address, city, state, country, pincode,
      noOfUsers, licenseType, licenseValidFrom, licenseValidTo, taxInclusive, gstNumber, stateCode,
      firstName, lastName, username, password, financialYearStart,
    } = req.body;

    // Validate required fields
    if (!companyName || !email || !phone) throw new ApiError(400, 'Company name, email, and phone are required');
    if (!firstName || !lastName || !password) throw new ApiError(400, 'Admin first name, last name, and password are required');

    // Check if company email exists
    const existingCompany = await Company.findOne({ email });
    if (existingCompany) throw new ApiError(400, 'Company with this email already exists');

    // Check if user email/username exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) throw new ApiError(400, 'User with this email or username already exists');

    // Create company
    const company = await Company.create({
      companyName, email, phone, phoneCountryCode: phoneCountryCode || '+91',
      address, city, state, country, pincode,
      noOfUsers: noOfUsers || 5,
      licenseType: licenseType || 'monthly',
      licenseValidFrom: licenseValidFrom || new Date(),
      licenseValidTo: licenseValidTo || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      taxInclusive: taxInclusive || false,
      taxInclusiveSetOn: new Date(),
      taxInclusiveLocked: true,
      gstNumber: gstNumber || '',
      stateCode: stateCode || '',
      financialYearStart: financialYearStart || { month: 1, day: 1 },
    });

    // Create admin role
    const adminRole = await Role.create({
      roleName: 'Admin',
      roleType: 'backoffice',
      companyId: company._id,
      menus: [
        { menuName: 'Dashboard', menuPath: '/dashboard', canView: true, canCreate: true, canEdit: true, canDelete: true },
        { menuName: 'Masters', menuPath: '/masters', canView: true, canCreate: true, canEdit: true, canDelete: true },
        { menuName: 'Transactions', menuPath: '/transactions', canView: true, canCreate: true, canEdit: true, canDelete: true },
        { menuName: 'Approvals', menuPath: '/approvals', canView: true, canCreate: true, canEdit: true, canDelete: true },
        { menuName: 'Reports', menuPath: '/reports', canView: true, canCreate: true, canEdit: true, canDelete: true },
        { menuName: 'Settings', menuPath: '/settings', canView: true, canCreate: true, canEdit: true, canDelete: true },
      ],
    });

    // Create admin user
    const adminUser = await User.create({
      companyId: company._id,
      roleId: adminRole._id,
      firstName,
      lastName,
      email,
      phone,
      username: username || email.split('@')[0],
      password,
      designation: 'admin',
    });

    // Link admin to company
    company.adminUserId = adminUser._id;
    await company.save();

    return res.status(201).json(new ApiResponse(201, {
      company: { _id: company._id, companyCode: company.companyCode, companyName: company.companyName },
      admin: { _id: adminUser._id, firstName: adminUser.firstName, lastName: adminUser.lastName, email: adminUser.email },
    }, 'Company created successfully'));
  } catch (error) {
    next(error);
  }
};

exports.updateCompany = async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) throw new ApiError(404, 'Company not found');

    const allowed = ['companyName', 'email', 'phone', 'phoneCountryCode', 'address', 'city', 'state', 'country', 'pincode',
      'noOfUsers', 'licenseType', 'licenseValidFrom', 'licenseValidTo', 'isLicenseActive', 'taxInclusive', 'taxInclusiveLocked',
      'gstNumber', 'stateCode', 'logo', 'isActive', 'financialYearStart'];

    allowed.forEach(field => {
      if (req.body[field] !== undefined) company[field] = req.body[field];
    });

    await company.save();
    return res.status(200).json(new ApiResponse(200, company, 'Company updated'));
  } catch (error) {
    next(error);
  }
};

exports.extendLicense = async (req, res, next) => {
  try {
    const { licenseValidTo } = req.body;
    if (!licenseValidTo) throw new ApiError(400, 'licenseValidTo is required');

    const company = await Company.findById(req.params.id);
    if (!company) throw new ApiError(404, 'Company not found');

    company.licenseValidTo = new Date(licenseValidTo);
    company.isLicenseActive = true;
    await company.save();

    return res.status(200).json(new ApiResponse(200, {
      licenseValidTo: company.licenseValidTo,
      isLicenseActive: company.isLicenseActive,
      daysUntilExpiry: Math.ceil((company.licenseValidTo - new Date()) / (1000 * 60 * 60 * 24)),
    }, 'License extended'));
  } catch (error) {
    next(error);
  }
};

exports.toggleCompanyActive = async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) throw new ApiError(404, 'Company not found');

    company.isActive = !company.isActive;
    company.isLicenseActive = company.isActive;
    await company.save();

    return res.status(200).json(new ApiResponse(200, company, `Company ${company.isActive ? 'activated' : 'deactivated'}`));
  } catch (error) {
    next(error);
  }
};

exports.deleteCompany = async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) throw new ApiError(404, 'Company not found');

    await User.deleteMany({ companyId: company._id });
    await Role.deleteMany({ companyId: company._id });
    await Company.findByIdAndDelete(req.params.id);

    return res.status(200).json(new ApiResponse(200, null, 'Company deleted'));
  } catch (error) {
    next(error);
  }
};

exports.getCompanyStats = async (req, res, next) => {
  try {
    const totalCompanies = await Company.countDocuments();
    const activeCompanies = await Company.countDocuments({ isActive: true });
    const totalUsers = await User.countDocuments();
    const expiredLicenses = await Company.countDocuments({
      licenseValidTo: { $lt: new Date() }
    });

    return res.status(200).json(new ApiResponse(200, {
      totalCompanies, activeCompanies, totalUsers, expiredLicenses,
    }, 'Stats fetched'));
  } catch (error) {
    next(error);
  }
};
