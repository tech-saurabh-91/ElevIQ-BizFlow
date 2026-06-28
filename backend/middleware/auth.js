const jwt = require('jsonwebtoken');
const { User, Company } = require('../models');
const { ApiError } = require('../utils/apiResponse');

const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      throw new ApiError(401, 'Not authorized. Please login.');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).populate('roleId companyId');

    if (!user) {
      throw new ApiError(401, 'User not found. Please login again.');
    }

    if (!user.isActive) {
      throw new ApiError(403, 'Your account has been deactivated. Please contact administrator.');
    }

    if (!user.isLoginAllowed) {
      throw new ApiError(403, 'Login not allowed for this user. Please contact administrator.');
    }

    const company = await Company.findById(user.companyId);
    if (company && !company.isLicenseValid()) {
      throw new ApiError(403, 'Company license has expired. Please contact provider.');
    }

    req.user = user;
    req.companyId = user.companyId;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Not authorized. Please login.',
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.designation)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.designation}' is not authorized to access this route.`,
      });
    }
    next();
  };
};

const checkLicense = async (req, res, next) => {
  try {
    const company = await Company.findById(req.companyId);
    if (!company) {
      throw new ApiError(404, 'Company not found');
    }
    if (!company.isLicenseValid()) {
      throw new ApiError(403, 'Company license has expired. Please contact provider.');
    }
    req.company = company;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Error checking license',
    });
  }
};

module.exports = { protect, authorize, checkLicense };
