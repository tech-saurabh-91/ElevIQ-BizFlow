const express = require('express');
const { protect, checkLicense } = require('../middleware/auth');
const { mongoIdValidation, paginationValidation, itemValidation, customerValidation, routeValidation, schemeValidation } = require('../validations');
const {
  itemController, customerController, routeController, locationController,
  vanTargetController, schemeController, discountController, stockAdjustmentController,
  stockSummaryController, otherParameterController, countryController, executiveVanAssignmentController,
  executiveProductGroupController, preSalesTargetController, vanSalesTargetController,
} = require('../controllers/moduleControllers');
const taxMasterController = require('../controllers/taxMasterController');
const hsnMasterController = require('../controllers/hsnMasterController');
const itemGroupController = require('../controllers/itemGroupController');
const itemSubGroupController = require('../controllers/itemSubGroupController');
const upload = require('../middleware/upload');

const router = express.Router();
router.use(protect, checkLicense);

// Tax Master
router.post('/tax', taxMasterController.create);
router.get('/tax', paginationValidation, taxMasterController.getAll);
router.get('/tax/:id', mongoIdValidation, taxMasterController.getById);
router.put('/tax/:id', mongoIdValidation, taxMasterController.update);
router.delete('/tax/:id', mongoIdValidation, taxMasterController.delete);

// HSN Master
router.post('/hsn', hsnMasterController.create);
router.get('/hsn', paginationValidation, hsnMasterController.getAll);
router.get('/hsn/:id', mongoIdValidation, hsnMasterController.getById);
router.put('/hsn/:id', mongoIdValidation, hsnMasterController.update);
router.delete('/hsn/:id', mongoIdValidation, hsnMasterController.delete);

// Item Groups
router.post('/item-group', upload.single('image'), itemGroupController.create);
router.get('/item-group', paginationValidation, itemGroupController.getAll);
router.get('/item-group/:id', mongoIdValidation, itemGroupController.getById);
router.put('/item-group/:id', mongoIdValidation, upload.single('image'), itemGroupController.update);
router.delete('/item-group/:id', mongoIdValidation, itemGroupController.delete);

// Item Sub-Groups
router.post('/item-sub-group', upload.single('image'), itemSubGroupController.create);
router.get('/item-sub-group', paginationValidation, itemSubGroupController.getAll);
router.get('/item-sub-group/:id', mongoIdValidation, itemSubGroupController.getById);
router.put('/item-sub-group/:id', mongoIdValidation, upload.single('image'), itemSubGroupController.update);
router.delete('/item-sub-group/:id', mongoIdValidation, itemSubGroupController.delete);

// Items
router.post('/item', upload.single('image'), itemValidation, itemController.create);
router.get('/item', paginationValidation, itemController.getAll);
router.get('/item/:id', mongoIdValidation, itemController.getById);
router.put('/item/:id', mongoIdValidation, upload.single('image'), itemController.update);
router.delete('/item/:id', mongoIdValidation, itemController.delete);

// Customers
router.post('/customer', customerValidation, customerController.create);
router.get('/customer', paginationValidation, customerController.getAll);
router.get('/customer/:id', mongoIdValidation, customerController.getById);
router.put('/customer/:id', mongoIdValidation, customerController.update);
router.delete('/customer/:id', mongoIdValidation, customerController.delete);

// Routes
router.post('/route', routeValidation, routeController.create);
router.get('/route', paginationValidation, routeController.getAll);
router.get('/route/:id', mongoIdValidation, routeController.getById);
router.put('/route/:id', mongoIdValidation, routeController.update);
router.delete('/route/:id', mongoIdValidation, routeController.delete);

// Locations
router.post('/location', locationController.create);
router.get('/location', paginationValidation, locationController.getAll);
router.get('/location/:id', mongoIdValidation, locationController.getById);
router.put('/location/:id', mongoIdValidation, locationController.update);
router.delete('/location/:id', mongoIdValidation, locationController.delete);

// Executive-VAN Assignment
router.post('/executive-van-assignment', executiveVanAssignmentController.create);
router.get('/executive-van-assignment', paginationValidation, executiveVanAssignmentController.getAll);
router.get('/executive-van-assignment/:id', mongoIdValidation, executiveVanAssignmentController.getById);
router.put('/executive-van-assignment/:id', mongoIdValidation, executiveVanAssignmentController.update);
router.delete('/executive-van-assignment/:id', mongoIdValidation, executiveVanAssignmentController.delete);

// Executive-Product Group
router.post('/executive-product-group', executiveProductGroupController.create);
router.get('/executive-product-group', paginationValidation, executiveProductGroupController.getAll);
router.get('/executive-product-group/:id', mongoIdValidation, executiveProductGroupController.getById);
router.put('/executive-product-group/:id', mongoIdValidation, executiveProductGroupController.update);
router.delete('/executive-product-group/:id', mongoIdValidation, executiveProductGroupController.delete);

// VAN Targets
router.post('/van-target', vanTargetController.create);
router.get('/van-target', paginationValidation, vanTargetController.getAll);
router.get('/van-target/:id', mongoIdValidation, vanTargetController.getById);
router.put('/van-target/:id', mongoIdValidation, vanTargetController.update);
router.delete('/van-target/:id', mongoIdValidation, vanTargetController.delete);

// Schemes
router.post('/scheme', schemeValidation, schemeController.create);
router.get('/scheme', paginationValidation, schemeController.getAll);
router.get('/scheme/:id', mongoIdValidation, schemeController.getById);
router.put('/scheme/:id', mongoIdValidation, schemeController.update);
router.delete('/scheme/:id', mongoIdValidation, schemeController.delete);

// Discounts
router.post('/discount', discountController.create);
router.get('/discount', paginationValidation, discountController.getAll);
router.get('/discount/:id', mongoIdValidation, discountController.getById);
router.put('/discount/:id', mongoIdValidation, discountController.update);
router.delete('/discount/:id', mongoIdValidation, discountController.delete);

// Stock Adjustments
router.post('/stock-adjustment', stockAdjustmentController.create);
router.get('/stock-adjustment', paginationValidation, stockAdjustmentController.getAll);
router.get('/stock-adjustment/:id', mongoIdValidation, stockAdjustmentController.getById);
router.put('/stock-adjustment/:id', mongoIdValidation, stockAdjustmentController.update);
router.delete('/stock-adjustment/:id', mongoIdValidation, stockAdjustmentController.delete);

// Stock Summary
router.get('/stock-summary', paginationValidation, stockSummaryController.getAll);
router.get('/stock-summary/:id', mongoIdValidation, stockSummaryController.getById);

// Other Parameters
router.post('/parameter', otherParameterController.create);
router.get('/parameter', paginationValidation, otherParameterController.getAll);
router.get('/parameter/:id', mongoIdValidation, otherParameterController.getById);
router.put('/parameter/:id', mongoIdValidation, otherParameterController.update);
router.delete('/parameter/:id', mongoIdValidation, otherParameterController.delete);

// Countries
router.post('/country', countryController.create);
router.get('/country', paginationValidation, countryController.getAll);
router.get('/country/:id', mongoIdValidation, countryController.getById);
router.put('/country/:id', mongoIdValidation, countryController.update);
router.delete('/country/:id', mongoIdValidation, countryController.delete);

// Pre-Sales Target
router.get('/pre-sales-target', preSalesTargetController.getByMonth);
router.post('/pre-sales-target', preSalesTargetController.saveTargets);

// Van-Sales Target
router.get('/van-sales-target', vanSalesTargetController.getByMonth);
router.post('/van-sales-target', vanSalesTargetController.saveTargets);

module.exports = router;
