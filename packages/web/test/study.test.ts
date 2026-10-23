import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewAnswer, studyDeck, studyQueue } from '../src/shared/study';
import {
  shopChallenge,
  missionQuestions,
  shopDay,
  adventureState,
  foxStage,
  canExpand,
} from '../src/shared/study-adventure';
test('spaced recall advances only when due and wrong answers restart learning', () => {
  const first = reviewAnswer(undefined, true, 1000);
  assert.equal(first.stage, 1);
  assert.equal(first.due, 86401000);
  const replay = reviewAnswer(first, true, 2000);
  assert.equal(replay.stage, 1);
  assert.equal(replay.due, first.due);
  const later = reviewAnswer(replay, true, first.due);
  assert.equal(later.stage, 2);
  assert.equal(later.due, first.due + 3 * 86400000);
  const wrong = reviewAnswer(later, false, later.due);
  assert.equal(wrong.misses, 1);
  assert.equal(wrong.stage, 0);
  assert.equal(wrong.due, later.due + 60000);
});
test('shop adaptations preserve source identity and unknown topics keep their full context', () => {
  const q = {
    id: 'price',
    concept: 'price',
    kind: 'word' as const,
    prompt: 'Original price question',
    options: ['price', 'money'],
    answer: 0,
    explanation: 'original',
    source: 'p1',
    needsReview: false,
  };
  const adapted = shopChallenge(q);
  assert.equal(adapted.sourceId, q.id);
  assert.equal(adapted.answer, 0);
  assert.ok(adapted.prompt.includes('bread'));
  assert.equal(adapted.adapted, true);
  const other = {
    ...q,
    options: ['Mars', 'Earth'],
    prompt: 'Long astronomy context.',
  };
  assert.equal(shopChallenge(other).prompt, other.prompt);
  assert.equal(shopChallenge(other).adapted, false);
  assert.equal(
    missionQuestions(
      { title: 't', summary: '', questions: [{ ...q, needsReview: true }] },
      {},
      1,
      0,
    ).length,
    0,
  );
  assert.equal(adventureState({}).chapter, 0);
  assert.equal(shopDay(Date.parse('2026-10-18T16:00:00Z')), '2026-10-19');
});
const question = {
  id: 'one',
  concept: 'where',
  kind: 'grammar' as const,
  prompt: 'This is the park ___ we play.',
  options: ['where', 'who'],
  answer: 0,
  explanation: 'where 表示地点',
  source: 'p1',
  needsReview: false,
};
test('question validation rejects invalid answers and duplicate ids/options', () => {
  assert.equal(
    studyDeck.safeParse({
      title: 't',
      summary: '',
      questions: [question, { ...question }],
    }).success,
    false,
  );
  assert.equal(
    studyDeck.safeParse({
      title: 't',
      summary: '',
      questions: [{ ...question, answer: 2 }],
    }).success,
    false,
  );
  assert.equal(
    studyDeck.safeParse({
      title: 't',
      summary: '',
      questions: [{ ...question, options: ['where', 'where'] }],
    }).success,
    false,
  );
});
test('review queue excludes ambiguous questions and prefers due mistakes to new material', () => {
  const deck = {
    title: 't',
    summary: '',
    questions: [
      question,
      { ...question, id: 'two' },
      { ...question, id: 'three', needsReview: true },
    ],
  };
  const state = {
    two: { misses: 1, stage: 0, due: 10, seen: 1, lastCorrect: false },
  };
  assert.deepEqual(
    studyQueue(deck, state, 100).map((q) => q.id),
    ['two', 'one'],
  );
  assert.deepEqual(
    studyQueue(deck, state, 100, true).map((q) => q.id),
    ['two'],
  );
});

test('growth thresholds and legacy saves retain achievements without resetting expansion', () => {
  const legacy = adventureState({
    chapter: 3,
    bonusDays: ['2026-10-18', '2026-10-19'],
  });
  assert.equal(legacy.growthXp, 16);
  assert.equal(legacy.expansion, 0);
  assert.equal(foxStage(11), 0);
  assert.equal(foxStage(12), 1);
  assert.equal(foxStage(35), 1);
  assert.equal(foxStage(36), 2);
  assert.equal(canExpand(legacy, 1), true);
  assert.equal(canExpand(legacy, 2), false);
  assert.equal(canExpand({ ...legacy, chapter: 1 }, 1), false);
  assert.equal(canExpand({ ...legacy, growthXp: 36, expansion: 1 }, 2), true);
  assert.equal(adventureState({ growthXp: 0, chapter: 3 }).growthXp, 0);
});
