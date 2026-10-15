import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);

const newPassword = z
  .string()
  .min(10, 'must be at least 10 characters')
  .max(128, 'must be at most 128 characters')
  .regex(/[A-Za-z]/, 'must contain at least one letter')
  .regex(/\d/, 'must contain at least one number');

const personName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^<>]+$/, 'contains invalid characters');

const token = z.string().min(20).max(200);

export const registerSchema = z
  .object({
    email,
    password: newPassword,
    firstName: personName,
    lastName: personName,
    institutionSlug: z.string().trim().toLowerCase().min(2).max(60),
    studentNumber: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email,
    password: z.string().min(1).max(128),
  })
  .strict();

export const verifyEmailSchema = z.object({ token }).strict();
export const resendVerificationSchema = z.object({ email }).strict();
export const forgotPasswordSchema = z.object({ email }).strict();
export const resetPasswordSchema = z.object({ token, password: newPassword }).strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;