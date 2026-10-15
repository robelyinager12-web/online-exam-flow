import 'dotenv/config';
import { z } from 'zod';

const csvList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

// An empty line such as `SMTP_HOST=` in .env should count as "not set".
const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().optional());
const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    CORS_ORIGINS: csvList.default('http://localhost:5173'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),

    // Authentication
    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(60).default(7),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_DOMAIN: optionalString,
    ALLOW_SELF_REGISTRATION: booleanString,

    // Frontend base URL, used to build the links inside emails
    APP_URL: z.string().url().default('http://localhost:5173'),

    // Email (optional in development: emails are printed to the log instead)
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_SECURE: booleanString,
    MAIL_FROM: z.string().min(3).default('ExamFlow <no-reply@examflow.local>'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'is required in production so verification and reset emails can be sent',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast: a misconfigured server must never start.
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';