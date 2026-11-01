import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the server root (server/.env) with fallback to monorepo root.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const required = (key, fallback) => {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const nodeEnv = process.env.NODE_ENV || 'development';

export const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  isDev: nodeEnv === 'development',

  port: parseInt(process.env.PORT || '5000', 10),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  mongoUri: required('MONGO_URI'),
  dbName: process.env.DB_NAME || 'SFA_ERP',

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev_only_access_secret_change_me_please_32'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev_only_refresh_secret_change_me_please_32'),
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '7d',
    impersonateExpires: process.env.JWT_IMPERSONATE_EXPIRES || '30m',
  },

  cookie: {
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: process.env.COOKIE_SAME_SITE || 'lax',
    refreshName: 'eleviq_rt',
  },

  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
  },

  superAdmin: {
    email: required('SUPER_ADMIN_EMAIL', 'superadmin@eleviqsfa.com'),
    password: required('SUPER_ADMIN_PASSWORD', 'ChangeMe#SuperAdmin1'),
    name: process.env.SUPER_ADMIN_NAME || 'ElevIQ Platform Admin',
  },

  upload: {
    maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '5', 10),
    dir: process.env.UPLOAD_DIR || 'uploads',
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
  },

  pdfFont: process.env.INVOICE_PDF_FONT || 'Helvetica',
  mapTileUrl:
    process.env.MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
};

export default env;
