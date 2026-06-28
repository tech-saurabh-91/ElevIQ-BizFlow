const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const SuperAdmin = require('../models/SuperAdmin');

const seedSuperAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
    console.log('Connected to MongoDB');

    // Delete existing super admin if any
    await SuperAdmin.deleteMany({});
    console.log('Cleared existing super admins');

    // Create with explicit hashing
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash('Admin@123', salt);

    const admin = await SuperAdmin.create({
      name: 'ElevIQ Admin',
      email: 'admin@eleviq.in',
      phone: '9999999999',
      password: hashedPassword,
      role: 'superadmin',
    });

    // Verify password works
    const isMatch = await bcrypt.compare('Admin@123', admin.password);
    console.log('Password verification:', isMatch ? 'PASS' : 'FAIL');

    console.log('Super admin created:', admin.email);
    console.log('Password: Admin@123');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

seedSuperAdmin();
