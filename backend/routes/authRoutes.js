const express = require('express');
const { protect, authorize, checkLicense } = require('../middleware/auth');
const authController = require('../controllers/authController');
const companyController = require('../controllers/companyController');
const { loginValidation } = require('../validations');

const router = express.Router();

router.post('/login', loginValidation, authController.login);
router.get('/me', protect, authController.getMe);
router.put('/change-password', protect, authController.changePassword);
router.put('/extend-license', protect, companyController.extendLicense);

module.exports = router;
