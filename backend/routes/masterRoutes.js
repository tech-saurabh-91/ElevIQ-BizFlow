const express = require('express');
const { protect, checkLicense } = require('../middleware/auth');
const companyController = require('../controllers/companyController');
const roleController = require('../controllers/roleController');
const userController = require('../controllers/userController');
const warehouseController = require('../controllers/warehouseController');
const vanController = require('../controllers/vanController');
const { companyValidation, roleValidation, userValidation, warehouseValidation, mongoIdValidation, paginationValidation } = require('../validations');

const router = express.Router();

router.use(protect, checkLicense);

// Company
router.get('/company/details', companyController.getCompanyDetails);
router.put('/company/update', companyController.updateCompany);

// Roles
router.post('/role', roleValidation, roleController.create);
router.get('/role', paginationValidation, roleController.getAll);
router.get('/role/:id', mongoIdValidation, roleController.getById);
router.put('/role/:id', mongoIdValidation, roleController.update);
router.delete('/role/:id', mongoIdValidation, roleController.delete);

// Users
router.post('/user', userValidation, userController.create);
router.get('/user', paginationValidation, userController.getAll);
router.get('/user/:id', mongoIdValidation, userController.getById);
router.put('/user/:id', mongoIdValidation, userController.update);
router.delete('/user/:id', mongoIdValidation, userController.delete);
router.put('/user/:id/deactivate', mongoIdValidation, userController.deactivate);
router.put('/user/:id/activate', mongoIdValidation, userController.activate);
router.put('/user/:id/assign-app', mongoIdValidation, userController.assignApp);

// Warehouses
router.post('/warehouse', warehouseValidation, warehouseController.create);
router.get('/warehouse', paginationValidation, warehouseController.getAll);
router.get('/warehouse/:id', mongoIdValidation, warehouseController.getById);
router.put('/warehouse/:id', mongoIdValidation, warehouseController.update);
router.delete('/warehouse/:id', mongoIdValidation, warehouseController.delete);

// VANs
router.post('/van', vanController.create);
router.get('/van', paginationValidation, vanController.getAll);
router.get('/van/:id', mongoIdValidation, vanController.getById);
router.put('/van/:id', mongoIdValidation, vanController.update);
router.delete('/van/:id', mongoIdValidation, vanController.delete);

module.exports = router;
