import env from '../config/env.js';
import logger, { redact } from '../utils/logger.js';
import { AppError, ValidationError, NotFoundError } from '../utils/errors.js';

/** 404 for unmatched routes. */
export const notFound = (req, _res, next) => {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
};

/** Translate Mongo / JWT / generic errors into our error contract. */
const normalize = (err) => {
  // Mongoose validation -> 422 with field errors
  if (err.name === 'ValidationError' && err.errors) {
    const errors = Object.entries(err.errors).map(([field, e]) => ({ field, message: e.message }));
    return new ValidationError('Validation failed', errors);
  }

  // Cast error (bad ObjectId)
  if (err.name === 'CastError') {
    return new ValidationError('Invalid value', [
      { field: err.path, message: `Invalid value for ${err.path}` },
    ]);
  }

  // Duplicate key
  if (err.code === 11000) {
    const fields = Object.keys(err.keyValue || {});
    return Object.assign(
      new AppError(`Duplicate value for: ${fields.join(', ') || 'field'}`, {
        status: 409,
        code: 'DUPLICATE',
      }),
      { isOperational: true }
    );
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return new AppError('Invalid token', { status: 401, code: 'TOKEN_INVALID' });
  }
  if (err.name === 'TokenExpiredError') {
    return new AppError('Token expired', { status: 401, code: 'TOKEN_EXPIRED' });
  }

  // Mongo timeout / transaction errors -> retryable 503
  if (['MongoServerError', 'MongooseError'].includes(err.name) && err.message?.includes('transact')) {
    return new AppError('Database transaction failed, please retry', {
      status: 503,
      code: 'DB_TRANSACTION_FAILED',
    });
  }

  return err;
};

/**
 * Central error handler. MUST be registered last.
 * Contract: { success:false, code, message, errors[] }
 */
export const errorHandler = (err, req, res, _next) => {
  const normalized = normalize(err);
  const status = normalized.status || normalized.statusCode || 500;
  const code = normalized.code || 'INTERNAL_ERROR';
  const message =
    status >= 500 && env.isProd && !normalized.isOperational
      ? 'Something went wrong'
      : normalized.message || 'Something went wrong';

  const payload = { success: false, code, message };
  if (normalized.errors?.length) payload.errors = normalized.errors;
  if (normalized.details && !env.isProd) payload.details = normalized.details;

  // Attach request id for correlation.
  if (req.id) payload.requestId = req.id;

  const meta = {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    companyId: req.companyId || null,
    userId: req.user?.id || null,
  };

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${status} ${code}: ${message}`, {
      ...meta,
      stack: normalized.stack,
      err: redact({ message: normalized.message }),
    });
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${status} ${code}: ${message}`, meta);
  }

  res.status(status).json(payload);
};

export default errorHandler;
