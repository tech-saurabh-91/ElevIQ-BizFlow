import { randomUUID } from 'node:crypto';
import logger from '../utils/logger.js';

/**
 * Assigns a request id, attaches it to req/res and logs each request
 * (replaces morgan for structured logs; morgan still used for access log).
 */
export const requestId = (req, res, next) => {
  const id = req.headers['x-request-id']?.toString() || randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};

export default requestId;
