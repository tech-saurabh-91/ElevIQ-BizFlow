const express = require('express');
const jwt = require('jsonwebtoken');
const { SuperAdmin, City } = require('../models');
const superAdminController = require('../controllers/superAdminController');
const upload = require('../middleware/upload');
const { ApiError, ApiResponse } = require('../utils/apiResponse');

const router = express.Router();

// Auth middleware for super admin
const protectSuperAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new ApiError(401, 'Not authorized');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'superadmin') throw new ApiError(403, 'Not a super admin');

    const admin = await SuperAdmin.findById(decoded.id);
    if (!admin || !admin.isActive) throw new ApiError(401, 'Admin not found or inactive');

    req.adminId = admin._id;
    next();
  } catch (error) {
    next(error);
  }
};

// ============ Public Routes (No Auth Required) ============

// Auth route
router.post('/login', superAdminController.login);

// City read endpoints (public - for LocationSelects dropdowns)
router.get('/cities', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.state) filter.state = req.query.state;
    if (req.query.country) filter.country = req.query.country;
    if (req.query.search) {
      filter.cityName = new RegExp(req.query.search, 'i');
    }
    const cities = await City.find(filter).sort({ state: 1, cityName: 1 });
    return res.status(200).json(new ApiResponse(200, cities, 'Fetched successfully'));
  } catch (error) {
    next(error);
  }
});

router.get('/cities/states', async (req, res, next) => {
  try {
    const states = await City.distinct('state', { country: req.query.country || 'India' });
    return res.status(200).json(new ApiResponse(200, states.sort(), 'Fetched successfully'));
  } catch (error) {
    next(error);
  }
});

// ============ Protected Routes (Auth Required) ============

router.use(protectSuperAdmin);

// Super Admin routes
router.get('/me', superAdminController.getMe);
router.get('/stats', superAdminController.getCompanyStats);
router.get('/companies', superAdminController.getAllCompanies);
router.post('/companies', superAdminController.createCompany);
router.put('/companies/:id', superAdminController.updateCompany);
router.put('/companies/:id/extend-license', superAdminController.extendLicense);
router.put('/companies/:id/toggle-active', superAdminController.toggleCompanyActive);
router.delete('/companies/:id', superAdminController.deleteCompany);

// Image upload for company logo
router.post('/companies/:id/logo', upload.single('logo'), async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, 'No file uploaded');
    const { Company } = require('../models');
    const company = await Company.findById(req.params.id);
    if (!company) throw new ApiError(404, 'Company not found');

    company.logo = `/uploads/general/${req.file.filename}`;
    await company.save();
    res.status(200).json({ success: true, data: { logo: company.logo }, message: 'Logo uploaded' });
  } catch (error) {
    next(error);
  }
});

// City write endpoints (protected - only super admin can modify)
router.post('/cities', async (req, res, next) => {
  try {
    const { country, state, cityName, cityCode } = req.body;
    if (!country || !state || !cityName) {
      throw new ApiError(400, 'Country, State, and City Name are required');
    }
    const existing = await City.findOne({ country, state, cityName: cityName.trim() });
    if (existing) throw new ApiError(400, 'City already exists in this state');

    const city = await City.create({
      country, state, cityName: cityName.trim(),
      cityCode: cityCode || cityName.trim().substring(0, 3).toUpperCase(),
    });
    return res.status(201).json(new ApiResponse(201, city, 'City created successfully'));
  } catch (error) {
    next(error);
  }
});

router.post('/cities/bulk', async (req, res, next) => {
  try {
    const { cities } = req.body;
    if (!cities || !Array.isArray(cities) || cities.length === 0) {
      throw new ApiError(400, 'Cities array is required');
    }
    let created = 0;
    let skipped = 0;
    for (const c of cities) {
      try {
        const exists = await City.findOne({ country: c.country, state: c.state, cityName: c.cityName });
        if (!exists) {
          await City.create(c);
          created++;
        } else {
          skipped++;
        }
      } catch { skipped++; }
    }
    return res.status(201).json(new ApiResponse(201, { created, skipped }, `Created ${created}, Skipped ${skipped}`));
  } catch (error) {
    next(error);
  }
});

router.put('/cities/:id', async (req, res, next) => {
  try {
    const city = await City.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!city) throw new ApiError(404, 'City not found');
    return res.status(200).json(new ApiResponse(200, city, 'City updated successfully'));
  } catch (error) {
    next(error);
  }
});

router.delete('/cities/:id', async (req, res, next) => {
  try {
    const city = await City.findByIdAndDelete(req.params.id);
    if (!city) throw new ApiError(404, 'City not found');
    return res.status(200).json(new ApiResponse(200, null, 'City deleted successfully'));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
