import type { Prisma, QuestionType } from '@prisma/client';
import type { QuestionContentInput } from './questions.validation';

// What gets stored in a QuestionVersion row.
export interface VersionData {
  body: string;
  options?: Prisma.InputJsonValue;
  answerKey?: Prisma.InputJsonValue;
  rubric?: Prisma.InputJsonValue;
  explanation: string | null;
  points: number;
}

// Turns what an author types into the stored shape. Option ids are generated here (o1, o2, ...),
// so the answer key can never point at an option that does not exist.
export function buildVersionData(content: QuestionContentInput): VersionData {
  const common = {
    body: content.body,
    explanation: content.explanation && content.explanation.length > 0 ? content.explanation : null,
    points: content.points,
  };

  switch (content.type) {
    case 'MCQ_SINGLE':
    case 'MCQ_MULTIPLE': {
      const options = content.options.map((option, index) => ({ id: `o${index + 1}`, text: option.text }));
      const optionIds = content.options.flatMap((option, index) => (option.isCorrect ? [`o${index + 1}`] : []));
      return { ...common, options, answerKey: { optionIds } };
    }
    case 'TRUE_FALSE':
      return {
        ...common,
        options: [
          { id: 'true', text: 'True' },
          { id: 'false', text: 'False' },
        ],
        answerKey: { optionIds: [content.correctAnswer ? 'true' : 'false'] },
      };
    case 'SHORT_ANSWER':
      return { ...common, answerKey: { accepted: content.acceptedAnswers, caseSensitive: content.caseSensitive } };
    case 'ESSAY':
      return { ...common, rubric: content.rubric && content.rubric.length > 0 ? content.rubric : undefined };
  }
}

interface StoredVersion {
  body: string;
  options: unknown;
  answerKey: unknown;
  rubric: unknown;
  explanation: string | null;
  points: unknown;
}

// The reverse: a stored version back into the shape an editor form works with. This view contains
// the answers, so it is for staff only and never for students taking an exam.
export function versionToContent(type: QuestionType, version: StoredVersion) {
  const base = { body: version.body, explanation: version.explanation, points: Number(version.points) };
  const key = (version.answerKey ?? {}) as { optionIds?: string[]; accepted?: string[]; caseSensitive?: boolean };
  const options = Array.isArray(version.options) ? (version.options as { id: string; text: string }[]) : [];

  switch (type) {
    case 'MCQ_SINGLE':
    case 'MCQ_MULTIPLE':
      return {
        type,
        ...base,
        options: options.map((option) => ({ text: option.text, isCorrect: (key.optionIds ?? []).includes(option.id) })),
      };
    case 'TRUE_FALSE':
      return { type, ...base, correctAnswer: (key.optionIds ?? [])[0] === 'true' };
    case 'SHORT_ANSWER':
      return { type, ...base, acceptedAnswers: key.accepted ?? [], caseSensitive: key.caseSensitive ?? false };
    case 'ESSAY':
      return { type, ...base, rubric: Array.isArray(version.rubric) ? version.rubric : [] };
  }
}