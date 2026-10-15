import type { RequestHandler } from 'express';
import { AppError } from '../lib/appError';

export const notFound: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`));
};