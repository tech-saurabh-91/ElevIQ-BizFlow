import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import winston from 'winston';
import env from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logDir = path.resolve(__dirname, '../../', env.log.dir);
const useFileLogs = !env.isTest && !env.onVercel;
if (useFileLogs && !fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const { combine, timestamp, errors, json, printf, colorize, splat } = winston.format;

const consoleFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  splat(),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, ...meta }) => {
    const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} [${level}] ${message}${rest}`;
  })
);

const fileFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const transports = [];

// Always log to console.
transports.push(
  new winston.transports.Console({
    format: consoleFormat,
    level: env.isTest ? 'error' : env.log.level,
  })
);

// In non-test environments also persist to rotating-ish daily files.
if (useFileLogs) {
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 10,
    })
  );
}

const logger = winston.createLogger({
  level: env.log.level,
  defaultMeta: { service: 'eleviq-sfa' },
  transports,
  silent: env.isTest,
});

// Redact common secrets if they ever end up in logs.
const SECRET_KEYS = /password|secret|token|authorization|cookie/i;
export const redact = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const key of Object.keys(clone)) {
    if (SECRET_KEYS.test(key)) clone[key] = '[REDACTED]';
    else if (clone[key] && typeof clone[key] === 'object') clone[key] = redact(clone[key]);
  }
  return clone;
};

export default logger;
