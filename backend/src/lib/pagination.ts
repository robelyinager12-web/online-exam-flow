import { z } from 'zod';

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export const toSkipTake = ({ page, pageSize }: PaginationParams) => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

export const buildPageMeta = ({ page, pageSize }: PaginationParams, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.max(1, Math.ceil(total / pageSize)),
});