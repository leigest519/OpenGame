import { z } from 'zod';

export const studyQuestion = z
  .object({
    id: z.string().min(1).max(60),
    concept: z.string().min(1).max(100),
    kind: z.enum(['word', 'grammar', 'reading']),
    prompt: z.string().min(1).max(2000),
    options: z.array(z.string().min(1).max(300)).min(2).max(5),
    answer: z.number().int().min(0).max(4),
    explanation: z.string().min(1).max(1500),
    source: z.string().min(1).max(200),
    needsReview: z.boolean(),
  })
  .strict()
  .refine(
    (q) =>
      q.answer < q.options.length &&
      new Set(q.options).size === q.options.length,
    '答案与选项不匹配',
  );
export const studyDeck = z
  .object({
    title: z.string().min(1).max(100),
    summary: z.string().max(1500),
    questions: z.array(studyQuestion).min(1).max(80),
  })
  .strict()
  .refine(
    (d) => new Set(d.questions.map((q) => q.id)).size === d.questions.length,
    '题目编号重复',
  );
export type StudyDeck = z.infer<typeof studyDeck>;
export type StudyProgress = {
  misses: number;
  stage: number;
  due: number;
  seen: number;
  lastCorrect: boolean;
};
export type StudyState = Record<string, StudyProgress>;
// A same-day replay provides practice, but cannot count as another spaced recall.
export function reviewAnswer(
  previous: StudyProgress | undefined,
  correct: boolean,
  now: number,
): StudyProgress {
  const old = previous || {
    misses: 0,
    stage: 0,
    due: 0,
    seen: 0,
    lastCorrect: false,
  };
  const stage = correct ? Math.min(6, old.stage + (old.due <= now ? 1 : 0)) : 0;
  const days = [0, 1, 3, 7, 14, 30, 60];
  return {
    misses: old.misses + (correct ? 0 : 1),
    stage,
    due:
      correct && old.due > now
        ? old.due
        : now + (correct ? days[stage] * 86400000 : 60000),
    seen: old.seen + 1,
    lastCorrect: correct,
  };
}
export function studyQueue(
  deck: StudyDeck,
  state: StudyState,
  now: number,
  mistakes = false,
) {
  return deck.questions
    .filter((q) => !q.needsReview && (!mistakes || state[q.id]?.misses > 0))
    .sort((a, b) => {
      const rank = (id: string) =>
        !state[id] ? 1 : state[id].due <= now ? 0 : 2;
      return (
        rank(a.id) - rank(b.id) ||
        (state[a.id]?.due || 0) - (state[b.id]?.due || 0)
      );
    });
}
