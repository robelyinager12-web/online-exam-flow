import { describe, expect, it } from 'vitest';
import { buildVersionData, versionToContent } from '../../src/modules/questions/questions.content';
import { questionContentSchema, type QuestionContentInput } from '../../src/modules/questions/questions.validation';

const parse = (input: unknown) => questionContentSchema.safeParse(input);
const ok = (input: unknown): QuestionContentInput => {
  const result = parse(input);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
};
const messages = (input: unknown) => {
  const result = parse(input);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

const single = (overrides: Record<string, unknown> = {}) => ({
  type: 'MCQ_SINGLE',
  body: '<p>What is 2 + 2?</p>',
  options: [
    { text: '3', isCorrect: false },
    { text: '4', isCorrect: true },
    { text: '5', isCorrect: false },
  ],
  ...overrides,
});

describe('single-choice questions', () => {
  it('accepts exactly one correct option and defaults the points to 1', () => {
    const content = ok(single());
    expect(content.points).toBe(1);
  });

  it('rejects zero or several correct options', () => {
    const none = single({ options: [{ text: 'a', isCorrect: false }, { text: 'b', isCorrect: false }] });
    const two = single({ options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }] });
    expect(messages(none)).toContain('options: must have exactly one correct option');
    expect(messages(two)).toContain('options: must have exactly one correct option');
  });

  it('needs 2 to 10 options, all different', () => {
    expect(parse(single({ options: [{ text: 'a', isCorrect: true }] })).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ text: `o${i}`, isCorrect: i === 0 }));
    expect(parse(single({ options: eleven })).success).toBe(false);
    const same = [{ text: 'Yes', isCorrect: true }, { text: 'yes', isCorrect: false }];
    expect(messages(single({ options: same }))).toContain('options: must not contain the same option twice');
  });

  it('refuses markup in option text but allows maths', () => {
    expect(parse(single({ options: [{ text: '<b>4</b>', isCorrect: true }, { text: '5', isCorrect: false }] })).success).toBe(false);
    expect(parse(single({ options: [{ text: 'x < y', isCorrect: true }, { text: 'x > y', isCorrect: false }] })).success).toBe(true);
  });

  it('refuses unknown fields', () => {
    expect(parse(single({ correctAnswer: true })).success).toBe(false);
  });
});

describe('multiple-choice questions', () => {
  const multiple = (options: { text: string; isCorrect: boolean }[]) => ({ type: 'MCQ_MULTIPLE', body: '<p>Pick primes</p>', options });

  it('accepts one or more correct options', () => {
    expect(parse(multiple([{ text: '2', isCorrect: true }, { text: '4', isCorrect: false }])).success).toBe(true);
    expect(parse(multiple([{ text: '2', isCorrect: true }, { text: '3', isCorrect: true }])).success).toBe(true);
  });

  it('rejects a question with no correct option', () => {
    expect(messages(multiple([{ text: '2', isCorrect: false }, { text: '4', isCorrect: false }]))).toContain(
      'options: must have at least one correct option',
    );
  });
});

describe('true/false, short answer and essay questions', () => {
  it('accepts a true/false question and rejects options on it', () => {
    expect(parse({ type: 'TRUE_FALSE', body: 'The sky is blue.', correctAnswer: true }).success).toBe(true);
    expect(parse({ type: 'TRUE_FALSE', body: 'x', correctAnswer: true, options: [] }).success).toBe(false);
    expect(parse({ type: 'TRUE_FALSE', body: 'x' }).success).toBe(false);
  });

  it('accepts short answers, not case sensitive by default', () => {
    const content = ok({ type: 'SHORT_ANSWER', body: 'Capital of France?', acceptedAnswers: ['Paris'] });
    expect(content.type === 'SHORT_ANSWER' && content.caseSensitive).toBe(false);
    expect(parse({ type: 'SHORT_ANSWER', body: 'x', acceptedAnswers: [] }).success).toBe(false);
    expect(parse({ type: 'SHORT_ANSWER', body: 'x', acceptedAnswers: Array(11).fill('a') }).success).toBe(false);
  });

  it('accepts essays with or without a rubric, and the rubric must add up', () => {
    expect(parse({ type: 'ESSAY', body: 'Discuss.', points: 10 }).success).toBe(true);
    const rubric = [{ criterion: 'Argument', maxPoints: 6 }, { criterion: 'Style', maxPoints: 4 }];
    expect(parse({ type: 'ESSAY', body: 'Discuss.', points: 10, rubric }).success).toBe(true);
    expect(messages({ type: 'ESSAY', body: 'Discuss.', points: 8, rubric })).toContain(
      'rubric: criteria points must add up to the question points',
    );
    expect(parse({ type: 'ESSAY', body: 'x', points: 11, rubric: Array(11).fill({ criterion: 'c', maxPoints: 1 }) }).success).toBe(false);
  });
});

describe('wording, explanation and points', () => {
  it('cleans dangerous markup out of the wording', () => {
    const content = ok(single({ body: '<p>Safe</p><script>alert(1)</script><img src=x onerror=alert(1)>' }));
    expect(content.body).toBe('<p>Safe</p>');
  });

  it('rejects wording that is empty once cleaned', () => {
    expect(parse(single({ body: '<script>alert(1)</script>' })).success).toBe(false);
    expect(parse(single({ body: '<p> </p>' })).success).toBe(false);
    expect(parse(single({ body: '' })).success).toBe(false);
  });

  it('cleans the explanation too', () => {
    const content = ok(single({ explanation: '<p>Because.</p><script>x</script>' }));
    expect(content.explanation).toBe('<p>Because.</p>');
  });

  it('limits points to 0.25 - 100 with at most 2 decimals', () => {
    expect(parse(single({ points: 0.1 })).success).toBe(false);
    expect(parse(single({ points: 100.5 })).success).toBe(false);
    expect(parse(single({ points: 1.234 })).success).toBe(false);
    expect(parse(single({ points: 2.5 })).success).toBe(true);
    expect(parse(single({ points: 0.25 })).success).toBe(true);
  });

  it('rejects an unknown question type', () => {
    expect(parse({ type: 'MATCHING', body: 'x' }).success).toBe(false);
  });
});

describe('storing and reading versions', () => {
  it('generates option ids and the answer key for multiple choice', () => {
    const data = buildVersionData(ok(single()));
    expect(data.options).toEqual([
      { id: 'o1', text: '3' },
      { id: 'o2', text: '4' },
      { id: 'o3', text: '5' },
    ]);
    expect(data.answerKey).toEqual({ optionIds: ['o2'] });
    expect(data.rubric).toBeUndefined();
    expect(data.explanation).toBeNull();
  });

  it('stores true/false with fixed options', () => {
    const data = buildVersionData(ok({ type: 'TRUE_FALSE', body: 'x', correctAnswer: false }));
    expect(data.options).toEqual([{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }]);
    expect(data.answerKey).toEqual({ optionIds: ['false'] });
  });

  it('stores accepted answers for short answers and a rubric for essays', () => {
    const short = buildVersionData(ok({ type: 'SHORT_ANSWER', body: 'x', acceptedAnswers: ['Paris', 'paris'], caseSensitive: true }));
    expect(short.answerKey).toEqual({ accepted: ['Paris', 'paris'], caseSensitive: true });
    expect(short.options).toBeUndefined();

    const rubric = [{ criterion: 'Argument', maxPoints: 5 }];
    const essay = buildVersionData(ok({ type: 'ESSAY', body: 'x', points: 5, rubric }));
    expect(essay.rubric).toEqual(rubric);
    expect(essay.answerKey).toBeUndefined();
  });

  it.each([
    ['MCQ_SINGLE', single()],
    ['MCQ_MULTIPLE', { type: 'MCQ_MULTIPLE', body: '<p>x</p>', options: [{ text: 'a', isCorrect: true }, { text: 'b', isCorrect: true }, { text: 'c', isCorrect: false }] }],
    ['TRUE_FALSE', { type: 'TRUE_FALSE', body: '<p>x</p>', correctAnswer: true }],
    ['SHORT_ANSWER', { type: 'SHORT_ANSWER', body: '<p>x</p>', acceptedAnswers: ['a', 'b'], caseSensitive: true }],
    ['ESSAY', { type: 'ESSAY', body: '<p>x</p>', points: 4, rubric: [{ criterion: 'c', maxPoints: 4 }] }],
  ])('turns a stored %s version back into the editor shape', (type, input) => {
    const content = ok(input);
    const stored = buildVersionData(content);
    const back = versionToContent(type as never, {
      body: stored.body,
      options: stored.options ?? null,
      answerKey: stored.answerKey ?? null,
      rubric: stored.rubric ?? null,
      explanation: stored.explanation,
      points: stored.points,
    });
    expect(back).toMatchObject({ type, body: content.body, points: content.points });
    // The editor shape can be sent straight back to the API.
    expect(parse({ ...back, explanation: back.explanation ?? undefined }).success).toBe(true);
  });
});