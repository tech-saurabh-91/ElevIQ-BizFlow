import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import env from './config/env.js';
import { APP_NAME } from './config/constants.js';

import { requestId } from './middlewares/requestId.js';
import {
  securityHeaders,
  corsMiddleware,
  compressor,
  sanitize,
  paramPollution,
  accessLogger,
  apiLimiter,
} from './middlewares/security.js';
import { errorHandler, notFound } from './middlewares/error.js';
import { auditContext } from './middlewares/audit.js';
import { ensureUploadDirs } from './middlewares/upload.js';

import platformRoutes from './routes/platform/index.js';
import companyRoutes from './routes/company/index.js';
import authRoutes from './routes/auth/index.js';
import { locationReadRoutes } from './routes/locations.js';
import { healthRouter, readyRouter } from './routes/health.js';
import { swaggerUi, swaggerSpec } from './docs/swagger.js';

const app = express();

// ---- Trust proxy (needed for correct req.ip behind a load balancer) -------
app.set('trust proxy', 1);
app.set('x-powered-by', false);
app.set('etag', 'strong');

// ---- Global pre middleware ------------------------------------------------
app.use(requestId);
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(compressor);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());
app.use(sanitize);
app.use(paramPollution);
app.use(accessLogger);
ensureUploadDirs();

// ---- Static: uploaded files ----------------------------------------------
app.use('/uploads', express.static(path.resolve(process.cwd(), env.upload.dir), { maxAge: '1d', dotfiles: 'deny' }));

// ---- Health / readiness (no auth, no rate limit) --------------------------
app.use('/health', healthRouter);
app.use('/ready', readyRouter);

// ---- API docs -------------------------------------------------------------
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: `${APP_NAME} API Docs`,
  customCss: '.swagger-ui .topbar { display: none }',
  explorer: true,
}));
app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));

// ---- Rate limiting for API -----------------------------------------------
app.use('/api', apiLimiter);

// ---- API routers ----------------------------------------------------------
app.use('/api/platform', platformRoutes);
app.use('/api/v1', companyRoutes);
app.use('/api/locations', locationReadRoutes);
app.use('/api', authRoutes); // /api/auth/* (login/refresh shared entrypoints)

// ---- Root info ------------------------------------------------------------
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: `${APP_NAME} API`,
    data: {
      app: APP_NAME,
      version: '1.0.0',
      docs: '/api-docs',
      health: '/health',
      platform: '/api/platform',
      company: '/api/v1',
    },
  });
});

// ---- 404 + central error handler (MUST be last) ---------------------------
app.use(notFound);
app.use(errorHandler);

export default app;
