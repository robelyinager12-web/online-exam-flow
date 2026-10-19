import { z } from 'zod';
import { ROLES } from '../../config/roles';
import { paginationQuery } from '../../lib/pagination';
import { emailField, personNameField } from '../auth/auth.validation';

const phoneField = z
  .string()
  .trim()
  .regex(/^[0-9+()\-\s]{7,20}$/, 'is not a valid phone number');

export const studentNumberField = z.string().trim().min(1).max(40);

export const idParamSchema = z.object({ id: z.string().uuid() }).strict();

export const createUserSchema = z
  .object({
    email: emailField,
    firstName: personNameField,
    lastName: personNameField,
    role: z.enum(ROLES),
    // Only a super admin needs this. An institution admin always creates users in their own institution.
    institutionId: z.string().uuid().optional(),
    studentNumber: studentNumberField.optional(),
    phone: phoneField.optional(),
  })
  .strict();

export const updateUserSchema = z
  .object({
    firstName: personNameField.optional(),
    lastName: personNameField.optional(),
    role: z.enum(ROLES).optional(),
    studentNumber: studentNumberField.nullable().optional(),
    phone: phoneField.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

export const listUsersQuerySchema = paginationQuery
  .extend({
    q: z.string().trim().min(1).max(100).optional(),
    role: z.enum(ROLES).optional(),
    status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
    institutionId: z.string().uuid().optional(),
    sortBy: z.enum(['createdAt', 'lastName', 'email']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const importQuerySchema = z
  .object({
    dryRun: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    institutionId: z.string().uuid().optional(),
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;