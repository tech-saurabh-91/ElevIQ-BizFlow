const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User, Company } = require('../models');
const { ApiError, ApiResponse } = require('../utils/apiResponse');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, 'Please provide email and password');
    }

    const user = await User.findOne({
      $or: [{ email }, { username: email }],
    }).select('+password').populate('roleId companyId');

    if (!user) {
      throw new ApiError(401, 'Invalid email or password');
    }

    if (!user.isActive) {
      throw new ApiError(403, 'Your account has been deactivated. Please contact your administrator.');
    }

    if (user.isLoginAllowed === false) {
      throw new ApiError(403, 'Login not allowed for this account. Please contact your administrator.');
    }

    const isPasswordMatch = await user.comparePassword(password);
    if (!isPasswordMatch) {
      throw new ApiError(401, 'Invalid email or password');
    }

    const company = await Company.findById(user.companyId);

    if (!company) {
      throw new ApiError(403, 'Company not found. Please contact your administrator.');
    }

    if (!company.isActive) {
      throw new ApiError(403, 'Your company account has been deactivated. Please contact your service provider.');
    }

    const now = new Date();
    if (now > company.licenseValidTo) {
      const expiryDate = company.licenseValidTo.toLocaleDateString();
      throw new ApiError(403, `Your license expired on ${expiryDate}. Please contact your service provider to renew.`);
    }

    if (now < company.licenseValidFrom) {
      throw new ApiError(403, `Your license is not yet active. It starts on ${company.licenseValidFrom.toLocaleDateString()}.`);
    }

    if (!company.isLicenseActive) {
      throw new ApiError(403, 'Your company license is inactive. Please contact your service provider.');
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);

    const daysUntilExpiry = Math.ceil((company.licenseValidTo - now) / (1000 * 60 * 60 * 24));
    let warning = null;
    if (daysUntilExpiry <= 10 && daysUntilExpiry > 0) {
      warning = `Your license expires in ${daysUntilExpiry} day${daysUntilExpiry > 1 ? 's' : ''}. Please contact your service provider to renew.`;
    } else if (daysUntilExpiry === 0) {
      warning = 'Your license expires today. Please contact your service provider to renew.';
    }

    return res.status(200).json(new ApiResponse(200, {
      token,
      warning,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        username: user.username,
        designation: user.designation,
        role: user.roleId,
        company: {
          id: company._id,
          companyCode: company.companyCode,
          companyName: company.companyName,
          licenseValidTo: company.licenseValidTo,
          taxInclusive: company.taxInclusive,
          gstNumber: company.gstNumber,
          stateCode: company.stateCode,
        },
      },
    }, 'Login successful'));
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const company = await Company.findById(req.user.companyId);
    return res.status(200).json(new ApiResponse(200, {
      user: req.user,
      company: {
        ...company.toObject(),
        isLicenseValid: company.isLicenseValid(),
        canAddUser: company.canAddUser(),
        canChangeTaxInclusive: company.canChangeTaxInclusive(),
      },
    }));
  } catch (error) {
    next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new ApiError(400, 'Please provide current and new password');
    }

    if (newPassword.length < 6) {
      throw new ApiError(400, 'New password must be at least 6 characters');
    }

    const user = await User.findById(req.user._id).select('+password');
    const isMatch = await user.comparePassword(currentPassword);

    if (!isMatch) {
      throw new ApiError(400, 'Current password is incorrect');
    }

    user.password = newPassword;
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);

    return res.status(200).json(new ApiResponse(200, { token }, 'Password changed successfully'));
  } catch (error) {
    next(error);
  }
};

module.exports = { login, getMe, changePassword };
