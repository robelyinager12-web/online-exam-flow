import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { AppError } from '../lib/appError';

interface HttpLikeError extends Error {
  type?: string;
  code?: string;
}

export const errorHandler: ErrorRequestHandler = (err: HttpLikeError, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Invalid request data';
    details = err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'The file is too large (maximum 1 MB)';
    } else {
      status = 400;
      code = 'INVALID_UPLOAD';
      message = 'The upload could not be processed';
    }
  }

  if (status >= 500) {
    req.log.error({ err }, 'Unhandled error');
  } else {
    req.log.warn({ code, message }, 'Request failed');
  }

  res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(!isProduction && status === 500 ? { stack: err.stack } : {}),
    },
  });
};