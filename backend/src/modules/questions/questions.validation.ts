import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination';
import { htmlToPlainText, looksLikeMarkup, sanitizeRichText } from '../../lib/sanitize';

// ---------------------------------------------------------------- building blocks

// Rich text is cleaned first; what is left must still contain some text.
const richText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform(sanitizeRichText)
    .pipe(z.string().max(max))
    .refine((value) => htmlToPlainText(value).length > 0, 'cannot be empty');

const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !looksLikeMarkup(value), 'must not contain HTML tags');

const pointsField = z
  .number()
  .min(0.25)
  .max(100)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'can have at most 2 decimals');

const common = {
  body: richText(20_000),
  explanation: richText(5_000).optional(),
  points: pointsField.default(1),
};

const optionInput = z.object({ text: plainText(500), isCorrect: z.boolean() }).strict();

const tagNameField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(30)
  .regex(/^[a-z0-9][a-z0-9 _.-]*$/, 'may only contain letters, numbers, spaces, dots, hyphens and underscores');

const tagsField = z
  .array(tagNameField)
  .max(10)
  .transform((tags) => [...new Set(tags)]);

// ---------------------------------------------------------------- content, one shape per question type

const mcqSingle = z
  .object({ type: z.literal('MCQ_SINGLE'), ...common, options: z.array(optionInput).min(2).max(10) })
  .strict();

const mcqMultiple = z
  .object({ type: z.literal('MCQ_MULTIPLE'), ...common, options: z.array(optionInput).min(2).max(10) })
  .strict();

const trueFalse = z.object({ type: z.literal('TRUE_FALSE'), ...common, correctAnswer: z.boolean() }).strict();

const shortAnswer = z
  .object({
    type: z.literal('SHORT_ANSWER'),
    ...common,
    acceptedAnswers: z.array(plainText(200)).min(1).max(10),
    caseSensitive: z.boolean().default(false),
  })
  .strict();

const essay = z
  .object({
    type: z.literal('ESSAY'),
    ...common,
    rubric: z.array(z.object({ criterion: plainText(200), maxPoints: pointsField }).strict()).max(10).optional(),
  })
  .strict();

export const questionContentSchema = z
  .discriminatedUnion('type', [mcqSingle, mcqMultiple, trueFalse, shortAnswer, essay])
  .superRefine((content, ctx) => {
    if (content.type === 'MCQ_SINGLE' || content.type === 'MCQ_MULTIPLE') {
      const correct = content.options.filter((option) => option.isCorrect).length;
      if (content.type === 'MCQ_SINGLE' && correct !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'must have exactly one correct option' });
      }
      if (content.type === 'MCQ_MULTIPLE' && correct < 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'must have at least one correct option' });
      }
      const texts = content.options.map((option) => option.text.toLowerCase());
      if (new Set(texts).size !== texts.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'must not contain the same option twice' });
      }
    }
    if (content.type === 'ESSAY' && content.rubric && content.rubric.length > 0) {
      const total = content.rubric.reduce((sum, item) => sum + item.maxPoints, 0);
      if (Math.abs(total - content.points) > 0.001) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rubric'], message: 'criteria points must add up to the question points' });
      }
    }
  });

export type QuestionContentInput = z.infer<typeof questionContentSchema>;

// ---------------------------------------------------------------- requests

export const questionIdParamSchema = z.object({ id: z.string().uuid() }).strict();
export const questionVersionParamSchema = z
  .object({ id: z.string().uuid(), version: z.coerce.number().int().min(1) })
  .strict();

const difficultyField = z.enum(['EASY', 'MEDIUM', 'HARD']);

export const createQuestionSchema = z
  .object({
    content: questionContentSchema,
    difficulty: difficultyField.default('MEDIUM'),
    // An instructor can only use a course they teach. Without a course the question is personal.
    courseId: z.string().uuid().optional(),
    // Only a super admin needs this, and only when no course is given.
    institutionId: z.string().uuid().optional(),
    tags: tagsField.default([]),
  })
  .strict();

export const updateQuestionSchema = z
  .object({
    // Changing the wording or answers creates a NEW immutable version. The question type cannot change.
    content: questionContentSchema.optional(),
    // The version the editor started from. Protects against overwriting a colleague's newer edit.
    baseVersion: z.number().int().min(1).optional(),
    difficulty: difficultyField.optional(),
    courseId: z.string().uuid().nullable().optional(),
    tags: tagsField.optional(), // the full new list of tags, not additions
    isArchived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' })
  .refine((value) => value.content === undefined || value.baseVersion !== undefined, {
    message: 'baseVersion is required when the content is changed',
    path: ['baseVersion'],
  });

export const listQuestionsQuerySchema = paginationQuery
  .extend({
    q: z.string().trim().min(1).max(100).optional(),
    type: z.enum(['MCQ_SINGLE', 'MCQ_MULTIPLE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ESSAY']).optional(),
    difficulty: difficultyField.optional(),
    courseId: z.string().uuid().optional(),
    tag: tagNameField.optional(),
    mine: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    archived: z.enum(['exclude', 'only', 'include']).default('exclude'),
    institutionId: z.string().uuid().optional(),
    sortBy: z.enum(['updatedAt', 'createdAt', 'difficulty']).default('updatedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export const listTagsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(30).optional(),
    institutionId: z.string().uuid().optional(),
  })
  .strict();

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;
export type ListTagsQuery = z.infer<typeof listTagsQuerySchema>;