import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination';
import { emailField, personNameField } from '../auth/auth.validation';

const nameField = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[^<>]+$/, 'contains invalid characters');

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'may only contain lowercase letters, numbers and single hyphens');

export const institutionIdParamSchema = z.object({ id: z.string().uuid() }).strict();

export const createInstitutionSchema = z
  .object({
    name: nameField,
    slug: slugField,
    contactEmail: emailField.optional(),
    // Optional first administrator, who receives an invitation email.
    admin: z.object({ email: emailField, firstName: personNameField, lastName: personNameField }).strict().optional(),
  })
  .strict();

export const updateInstitutionSchema = z
  .object({
    name: nameField.optional(),
    slug: slugField.optional(),
    contactEmail: emailField.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

export const listInstitutionsQuerySchema = paginationQuery
  .extend({
    q: z.string().trim().min(1).max(100).optional(),
    isActive: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
    sortBy: z.enum(['name', 'createdAt']).default('name'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export type CreateInstitutionInput = z.infer<typeof createInstitutionSchema>;
export type UpdateInstitutionInput = z.infer<typeof updateInstitutionSchema>;
export type ListInstitutionsQuery = z.infer<typeof listInstitutionsQuerySchema>;