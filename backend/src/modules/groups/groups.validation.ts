import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination';
import { emailField } from '../auth/auth.validation';

const nameField = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[^<>]+$/, 'contains invalid characters');

const academicYearField = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9 ./-]+$/, 'contains invalid characters');

export const groupIdParamSchema = z.object({ id: z.string().uuid() }).strict();
export const groupMemberParamSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).strict();

export const createGroupSchema = z
  .object({
    name: nameField,
    academicYear: academicYearField.optional(),
    courseId: z.string().uuid().optional(),
    // Only a super admin needs this. An institution admin always works in their own institution.
    institutionId: z.string().uuid().optional(),
  })
  .strict();

export const updateGroupSchema = z
  .object({
    name: nameField.optional(),
    academicYear: academicYearField.nullable().optional(),
    courseId: z.string().uuid().nullable().optional(), // null unlinks the group from its course
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

export const listGroupsQuerySchema = paginationQuery
  .extend({
    q: z.string().trim().min(1).max(100).optional(),
    courseId: z.string().uuid().optional(),
    institutionId: z.string().uuid().optional(),
    sortBy: z.enum(['name', 'createdAt']).default('name'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();

export const listMembersQuerySchema = paginationQuery
  .extend({ q: z.string().trim().min(1).max(100).optional() })
  .strict();

// Students are added by id or by email address, never both in one request.
export const addMembersSchema = z
  .object({
    userIds: z.array(z.string().uuid()).min(1).max(200).optional(),
    emails: z.array(emailField).min(1).max(200).optional(),
  })
  .strict()
  .refine((value) => (value.userIds ? 1 : 0) + (value.emails ? 1 : 0) === 1, {
    message: 'Provide either userIds or emails, not both',
  });

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
export type ListGroupsQuery = z.infer<typeof listGroupsQuerySchema>;e
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
export type AddMembersInput = z.infer<typeof addMembersSchema>;