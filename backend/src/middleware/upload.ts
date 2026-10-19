import multer from 'multer';
import { AppError } from '../lib/appError';

const CSV_MIME_TYPES = new Set(['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain']);

// CSV upload kept in memory (never written to disk). One file, at most 1 MB, in the field "file".
export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1, fields: 5, parts: 8 },
  fileFilter: (_req, file, callback) => {
    const looksLikeCsv = /\.csv$/i.test(file.originalname) && CSV_MIME_TYPES.has(file.mimetype);
    if (!looksLikeCsv) {
      return callback(new AppError(400, 'INVALID_FILE', 'Only .csv files are accepted'));
    }
    return callback(null, true);
  },
}).single('file');