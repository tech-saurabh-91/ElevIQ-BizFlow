const { body, param, query, validationResult } = require('express-validator');
const { ApiError } = require('../utils/apiResponse');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const messages = errors.array().map(err => err.msg);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: messages,
    });
  }
  next();
};

const companyValidation = [
  body('companyName').notEmpty().withMessage('Company name is required').trim(),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').notEmpty().withMessage('Phone is required'),
  body('noOfUsers').optional().isInt({ min: 1 }).withMessage('No of users must be at least 1'),
  body('licenseValidFrom').isISO8601().withMessage('Valid from date is required'),
  body('licenseValidTo').isISO8601().withMessage('Valid to date is required'),
  validate,
];

const roleValidation = [
  body('roleName').notEmpty().withMessage('Role name is required').trim(),
  body('roleType').isIn(['mobile', 'backoffice']).withMessage('Role type must be mobile or backoffice'),
  body('mobileSubType').optional().isIn(['presale', 'vansale', '']).withMessage('Invalid mobile sub type'),
  body('menus').isArray({ min: 1 }).withMessage('At least one menu is required'),
  validate,
];

const userValidation = [
  body('firstName').notEmpty().withMessage('First name is required').trim(),
  body('lastName').notEmpty().withMessage('Last name is required').trim(),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').notEmpty().withMessage('Phone is required'),
  body('username').isLength({ min: 4 }).withMessage('Username must be at least 4 characters').trim(),
  body('password').optional({ checkFalsy: true }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('roleId').isMongoId().withMessage('Valid role ID is required'),
  body('designation').optional().notEmpty().withMessage('Designation is required'),
  validate,
];

const loginValidation = [
  body('email').notEmpty().withMessage('Email or username is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
];

const warehouseValidation = [
  body('warehouseName').notEmpty().withMessage('Warehouse name is required').trim(),
  body('address').notEmpty().withMessage('Address is required').trim(),
  body('natureOfWarehouse').notEmpty().withMessage('Nature of warehouse is required').trim(),
  validate,
];

const itemValidation = [
  body('itemName').notEmpty().withMessage('Item name is required').trim(),
  body('unit').notEmpty().withMessage('Unit is required').trim(),
  body('unitPrice').isFloat({ min: 0 }).withMessage('Unit price must be a positive number'),
  body('sellingPrice').isFloat({ min: 0 }).withMessage('Selling price must be a positive number'),
  body('taxRate').optional().isFloat({ min: 0, max: 100 }).withMessage('Tax rate must be between 0-100'),
  validate,
];

const customerValidation = [
  body('customerName').notEmpty().withMessage('Customer name is required').trim(),
  body('phone').notEmpty().withMessage('Phone is required').matches(/^\+?[\d\s-]{8,15}$/).withMessage('Phone must be 8-15 digits with optional country code'),
  body('email').optional().isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('address').notEmpty().withMessage('Address is required').trim(),
  validate,
];

const routeValidation = [
  body('routeName').notEmpty().withMessage('Route name is required').trim(),
  body('routeDate').notEmpty().withMessage('Route date is required'),
  body('customers').isArray({ min: 1 }).withMessage('At least one customer is required'),
  validate,
];

const salesOrderValidation = [
  body('customerId').isMongoId().withMessage('Valid customer ID is required'),
  body('warehouseId').isMongoId().withMessage('Valid warehouse ID is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.itemId').isMongoId().withMessage('Valid item ID is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('items.*.unitPrice').isFloat({ min: 0 }).withMessage('Unit price must be a positive number'),
  body('grandTotal').isFloat({ min: 0 }).withMessage('Grand total must be a positive number'),
  validate,
];

const schemeValidation = [
  body('schemeName').notEmpty().withMessage('Scheme name is required').trim(),
  body('schemeType').isIn(['free_promotional', 'return']).withMessage('Invalid scheme type'),
  body('schemeQty').isInt({ min: 1 }).withMessage('Scheme qty must be at least 1'),
  body('effectiveStartDate').isISO8601().withMessage('Start date is required'),
  body('effectiveEndDate').isISO8601().withMessage('End date is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  validate,
];

const paginationValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limit must be between 1-500'),
  validate,
];

const mongoIdValidation = [
  param('id').isMongoId().withMessage('Invalid ID format'),
  validate,
];

module.exports = {
  validate,
  companyValidation,
  roleValidation,
  userValidation,
  loginValidation,
  warehouseValidation,
  itemValidation,
  customerValidation,
  routeValidation,
  schemeValidation,
  salesOrderValidation,
  paginationValidation,
  mongoIdValidation,
};
