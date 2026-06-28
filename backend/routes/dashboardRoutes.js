const express = require('express');
const { protect, checkLicense } = require('../middleware/auth');
const { getDashboard } = require('../controllers/dashboardController');

const router = express.Router();
router.use(protect, checkLicense);

router.get('/', getDashboard);

module.exports = router;
