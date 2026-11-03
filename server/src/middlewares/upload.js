import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import env from '../config/env.js';
import { ALLOWED_UPLOAD_MIME } from '../config/constants.js';
import { BadRequestError, AppError } from '../utils/errors.js';

const uploadRoot = path.resolve(process.cwd(), env.upload.dir);
export const ensureUploadDirs = () => {
  ['logos', 'products', 'kyc', 'expenses', 'avatars', 'temp'].forEach((d) => {
    const p = path.join(uploadRoot, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
};

const ALLOWED_SUBFOLDERS = ['logos', 'products', 'kyc', 'expenses', 'avatars', 'temp'];

const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const sub = ALLOWED_SUBFOLDERS.includes(req.uploadFolder) ? req.uploadFolder : 'temp';
    const dest = path.join(uploadRoot, sub);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!ALLOWED_UPLOAD_MIME.includes(file.mimetype)) {
    return cb(new BadRequestError(`File type ${file.mimetype} is not allowed`, 'INVALID_FILE_TYPE'));
  }
  return cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.upload.maxUploadMb * 1024 * 1024, files: 10 },
});

/** Select the target sub-folder before calling upload.single/m.array. */
export const folder = (name) => (req, _res, next) => {
  req.uploadFolder = name;
  next();
};

/** Validate an uploaded file exists (used after multer). */
export const requireFile = (req, _res, next) => {
  if (!req.file && !req.files?.length) {
    return next(new BadRequestError('File is required', 'FILE_REQUIRED'));
  }
  return next();
};

const SPREADSHEET_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', // Windows without Excel installed
  'application/octet-stream', // some browsers send .xlsx without a specific type
];

/** In-memory .xlsx upload for bulk imports (never written to disk). */
export const spreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const isXlsx = /\.xlsx$/i.test(file.originalname || '') && SPREADSHEET_MIME.includes(file.mimetype);
    if (!isXlsx) return cb(new BadRequestError('Upload the .xlsx template (Excel workbook)', 'INVALID_FILE_TYPE'));
    return cb(null, true);
  },
});

export { uploadRoot };
export default upload;
