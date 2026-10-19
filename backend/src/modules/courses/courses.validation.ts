import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination';

const codeField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{1,19}$/, 'must be 2 to 20 characters: letters, numbers, dots, hyphens or underscores');

const nameField = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[^<>]+$/, 'contains invalid characters');

const descriptionField = z
  .string()
  .trim()
  .max(2000)
  .regex(/^[^<>]*$/, 'contains invalid characters');

export const courseIdParamSchema = z.object({ id: z.string().uuid() }).strict();
export const courseInstructorParamSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).strict();

export const createCourseSchema = z
  .object({
    code: codeField,
    name: nameField,
    description: descriptionField.optional(),
    // Only a super admin needs this. An institution admin always works in their own institution.
    institutionId: z.string().uuid().optional(),
  })
  .strict();

export const updateCourseSchema = z
  .object({
    code: codeField.optional(),
    name: nameField.optional(),
    description: descriptionField.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

export const listCoursesQuerySchema = paginationQuery
  .extend({
    q: z.string().trim().min(1).max(100).optional(),
    institutionId: z.string().uuid().optional(),
    isActive: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
    sortBy: z.enum(['code', 'name', 'createdAt']).default('code'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export const assignInstructorsSchema = z
  .object({ userIds: z.array(z.string().uuid()).min(1).max(50) })
  .strict();

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export type ListCoursesQuery = z.infer<typeof listCoursesQuerySchema>;