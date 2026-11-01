import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import logger from '../utils/logger.js';

/** Security headers (helmet). */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Vite dev + Swagger UI
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", ...env.corsOrigins],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // Swagger UI / uploaded assets need these permissive in dev:
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

/** CORS with an explicit whitelist (credentials: true for the refresh cookie). */
export const corsMiddleware = cors({
  origin(origin, cb) {
    // Allow same-origin / server-to-server (no Origin header).
    if (!origin) return cb(null, true);
    if (env.corsOrigins.includes(origin)) return cb(null, true);
    if (env.isDev && /^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Company-Code'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600,
});

/** Gzip/deflate compression. */
export const compressor = compression();

/** Strip `$`/`.` operators from user input to block NoSQL injection. */
export const sanitize = mongoSanitize({
  onSanitize: ({ req, key }) => {
    logger.warn(`Sanitized key "${key}" in ${req.method} ${req.originalUrl}`);
  },
  replaceWith: '_',
});

/** Block parameter pollution (hpp). Whitelist repeated-array query params. */
export const paramPollution = hpp({
  whitelist: ['sort', 'order', 'status', 'role', 'route', 'category', 'tag', 'ids'],
});

/** Access log. */
export const accessLogger = morgan(
  (tokens, req, res) => {
    const line = [
      tokens.method(req, res),
      tokens.url(req, res),
      tokens.status(req, res),
      tokens.res(req, res, 'content-length'),
      '-',
      `${tokens['response-time'](req, res)}ms`,
      req.id ? `rid=${req.id}` : '',
      req.companyId ? `co=${req.companyId}` : '',
    ].join(' ');
    return line;
  },
  {
    stream: {
      write: (msg) => logger.http(msg.trim()),
    },
    skip: (req) => req.originalUrl?.startsWith('/health'),
  }
);

/** Global API rate limiter. */
export const apiLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
});

/** Stricter limiter for auth endpoints. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many auth attempts, please try again later.' },
});

export default { securityHeaders, corsMiddleware, compressor, sanitize, paramPollution, accessLogger, apiLimiter, authLimiter };
