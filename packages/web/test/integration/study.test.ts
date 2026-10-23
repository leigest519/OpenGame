import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseUrl } from '../../src/server/config';
import { pool, migrate } from '../../src/server/db';
import {
  uploadStudy,
  listStudy,
  answerStudy,
  buildStudy,
  adventureStudy,
} from '../../src/server/study';
let admin: pg.Client;
const name = `opengame_study_${process.pid}`;
before(async () => {
  admin = new pg.Client({ connectionString: databaseUrl() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(databaseUrl());
  url.pathname = `/${name}`;
  process.env.OPENGAME_DATABASE_URL = url.toString();
  await migrate();
});
after(async () => {
  await pool().end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
test('private courses, atomic answer retries, reward and construction survive reload', async () => {
  const owner = randomUUID(),
    stranger = randomUUID();
  const c = await uploadStudy(owner, {
    name: 'lesson.txt',
    data: Buffer.from('This is a lesson about where and who.').toString(
      'base64',
    ),
  });
  assert.equal((await listStudy(stranger)).length, 0);
  await assert.rejects(
    uploadStudy(owner, {
      name: 'second.txt',
      data: Buffer.from('This is a second lesson for a test.').toString(
        'base64',
      ),
    }),
    /等待/,
  );
  const question = {
    id: 'one',
    concept: 'where',
    kind: 'grammar',
    prompt: 'The park ___ we play.',
    options: ['where', 'who'],
    answer: 0,
    explanation: '地点用 where',
    source: 'p1',
    needsReview: false,
  };
  await pool().query(
    "UPDATE studio_study_courses SET status='ready',deck=$2 WHERE id=$1",
    [c.id, JSON.stringify({ title: 't', summary: '', questions: [question] })],
  );
  const input = { questionId: 'one', choice: 0, requestKey: randomUUID() };
  await assert.rejects(answerStudy(stranger, c.id, input), /找不到/);
  await assert.rejects(buildStudy(stranger, c.id, { plot: 0 }), /找不到/);
  const results = await Promise.all([
    answerStudy(owner, c.id, input),
    answerStudy(owner, c.id, input),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].town.wood, 3);
  const replay = await answerStudy(owner, c.id, {
    ...input,
    requestKey: randomUUID(),
  });
  assert.equal(replay.reward, 0);
  assert.equal(replay.town.wood, 3);
  assert.deepEqual(await buildStudy(owner, c.id, { plot: 0 }), {
    wood: 0,
    buildings: [0],
  });
  assert.deepEqual(await buildStudy(owner, c.id, { plot: 0 }), {
    wood: 0,
    buildings: [0],
  });
  await assert.rejects(buildStudy(owner, c.id, { plot: 1 }), /还需要/);
  const wrong = await answerStudy(owner, c.id, {
    ...input,
    choice: 1,
    requestKey: randomUUID(),
  });
  assert.equal(wrong.progress.one.misses, 1);
  assert.equal(wrong.progress.one.stage, 0);
  const reloaded = (await listStudy(owner))[0];
  assert.deepEqual(reloaded.town, { wood: 0, buildings: [0] });
  assert.equal(reloaded.progress.one.misses, 1);
});
test('shop story resumes, guided answers do not imply mastery, and rewards cannot be replayed', async () => {
  const owner = randomUUID();
  const c = await uploadStudy(owner, {
    name: 'shop.txt',
    data: Buffer.from('A shop lesson about words and grammar.').toString(
      'base64',
    ),
  });
  const questions = [
    ['price', 'money', 'word'],
    ['where', 'who', 'grammar'],
    ['receipt', 'basket', 'word'],
    ['because', 'so', 'grammar'],
    ['who', 'where', 'grammar'],
    ['fridge', 'pillow', 'word'],
  ].map(([right, wrong, kind], i) => ({
    id: `q${i}`,
    concept: right,
    kind,
    prompt: `Choose ${right}`,
    options: [right, wrong],
    answer: 0,
    explanation: `Explanation: ${right}`,
    source: 'page 1',
    needsReview: false,
  }));
  await pool().query(
    "UPDATE studio_study_courses SET status='ready',deck=$2 WHERE id=$1",
    [c.id, JSON.stringify({ title: 'shop', summary: 'test', questions })],
  );
  await assert.rejects(
    adventureStudy(randomUUID(), c.id, { kind: 'adopt', name: 'Test' }),
    /找不到/,
  );
  await assert.rejects(adventureStudy(owner, c.id, { kind: 'start' }), /名字/);
  await adventureStudy(owner, c.id, { kind: 'adopt', name: '栗栗' });
  let r = await adventureStudy(owner, c.id, { kind: 'start' });
  const first = r.adventure.active!;
  assert.equal(
    (await adventureStudy(owner, c.id, { kind: 'start' })).adventure.active!.id,
    first.id,
  );
  const incorrect = {
    kind: 'answer',
    missionId: first.id,
    step: 0,
    choice: 1,
    requestKey: randomUUID(),
  };
  r = await adventureStudy(owner, c.id, incorrect);
  assert.equal(r.progress[first.questions[0].sourceId].misses, 1);
  assert.equal(r.adventure.active!.step, 0);
  assert.equal(r.adventure.growthXp, 0);
  assert.deepEqual(await adventureStudy(owner, c.id, incorrect), r);
  r = await adventureStudy(owner, c.id, {
    ...incorrect,
    choice: 0,
    requestKey: randomUUID(),
  });
  assert.equal(r.progress[first.questions[0].sourceId].stage, 0);
  assert.equal(r.adventure.growthXp, 0);
  assert.equal(r.feedback!.reward, 0);
  assert.equal(r.adventure.active!.step, 1);
  await assert.rejects(
    adventureStudy(owner, c.id, { ...incorrect, requestKey: randomUUID() }),
    /进度/,
  );
  const finish = async () => {
    while (r.adventure.active) {
      const m = r.adventure.active;
      r = await adventureStudy(owner, c.id, {
        kind: 'answer',
        missionId: m.id,
        step: m.step,
        choice: m.questions[m.step].answer,
        requestKey: randomUUID(),
      });
    }
  };
  await finish();
  assert.equal(r.adventure.chapter, 1);
  assert.equal(r.adventure.coins, 8);
  assert.equal(r.adventure.growthXp, 6);
  const saved = (await listStudy(owner))[0];
  assert.equal(saved.adventure.chapter, 1);
  assert.ok(saved.adventure.mistakes[first.questions[0].sourceId]);
  await assert.rejects(adventureStudy(owner, c.id, { kind: 'start' }), /装饰/);
  await assert.rejects(
    adventureStudy(owner, c.id, { kind: 'scarf', color: 'gold' }),
    /解锁/,
  );
  const placed = await Promise.all([
    adventureStudy(owner, c.id, {
      kind: 'decorate',
      item: 'flowers',
      slot: 'left',
    }),
    adventureStudy(owner, c.id, {
      kind: 'decorate',
      item: 'flowers',
      slot: 'left',
    }),
  ]);
  assert.equal(placed[0].adventure.coins, 4);
  assert.equal(placed[1].adventure.coins, 4);
  const moved = await adventureStudy(owner, c.id, {
    kind: 'decorate',
    item: 'flowers',
    slot: 'right',
  });
  assert.deepEqual(moved.adventure.slots, { right: 'flowers' });
  assert.equal(moved.adventure.coins, 4);
  r = await adventureStudy(owner, c.id, { kind: 'start' });
  assert.equal(r.adventure.active!.questions[0].kind, 'grammar');
  await finish();
  assert.equal(r.adventure.chapter, 2);
  r = await adventureStudy(owner, c.id, { kind: 'start' });
  await finish();
  assert.equal(r.adventure.chapter, 3);
  assert.equal(r.adventure.coins, 32);
  r = await adventureStudy(owner, c.id, { kind: 'start' });
  await finish();
  assert.equal(r.adventure.coins, 37);
  const growthBeforeReplay = r.adventure.growthXp;
  r = await adventureStudy(owner, c.id, { kind: 'start' });
  await finish();
  assert.equal(r.adventure.coins, 37);
  assert.equal(r.adventure.growthXp, growthBeforeReplay);
  assert.equal(r.adventure.bonusDays.length, 1);
});

test('expansions are sequential, owner-scoped, idempotent and survive reload', async () => {
  const owner = randomUUID();
  const c = await uploadStudy(owner, {
    name: 'growth.txt',
    data: Buffer.from(
      'A learning course for the growing forest shop.',
    ).toString('base64'),
  });
  await pool().query(
    "UPDATE studio_study_courses SET status='ready',adventure=$2 WHERE id=$1",
    [
      c.id,
      JSON.stringify({ name: '栗栗', chapter: 3, growthXp: 11, expansion: 0 }),
    ],
  );
  await assert.rejects(
    adventureStudy(owner, c.id, { kind: 'expand', stage: 1 }),
    /成长目标/,
  );
  await assert.rejects(
    adventureStudy(randomUUID(), c.id, { kind: 'expand', stage: 1 }),
    /找不到/,
  );
  await pool().query(
    "UPDATE studio_study_courses SET adventure=jsonb_set(adventure,'{growthXp}','36') WHERE id=$1",
    [c.id],
  );
  await assert.rejects(
    adventureStudy(owner, c.id, { kind: 'expand', stage: 2 }),
    /顺序/,
  );
  const result = await Promise.all([
    adventureStudy(owner, c.id, { kind: 'expand', stage: 1 }),
    adventureStudy(owner, c.id, { kind: 'expand', stage: 1 }),
  ]);
  assert.equal(result[0].adventure.expansion, 1);
  assert.equal(result[1].adventure.expansion, 1);
  assert.equal(result[1].adventure.growthXp, 36);
  assert.equal(result[1].adventure.coins, 0);
  await adventureStudy(owner, c.id, { kind: 'expand', stage: 2 });
  const replay = await adventureStudy(owner, c.id, {
    kind: 'expand',
    stage: 1,
  });
  assert.equal(replay.adventure.expansion, 2);
  assert.equal((await listStudy(owner))[0].adventure.expansion, 2);
  await assert.rejects(
    adventureStudy(owner, c.id, { kind: 'expand', stage: 3 }),
  );
});

test('duplicate imports reuse same-owner content, clone ready decks and preserve progress', async () => {
  const owner = randomUUID(),
    other = randomUUID();
  const data = Buffer.from(
    'Unique material for duplicate import and cached learning.',
  ).toString('base64');
  const input = { name: 'lesson.txt', data };
  const concurrent = await Promise.all([
    uploadStudy(owner, input),
    uploadStudy(owner, { ...input, name: 'renamed.txt' }),
  ]);
  assert.equal(concurrent[0].id, concurrent[1].id);
  assert.equal((await listStudy(owner)).length, 1);
  const pending = await uploadStudy(owner, input);
  assert.equal(pending.duplicate, true);
  assert.equal(pending.status, 'queued');
  const differentOwner = await uploadStudy(other, input);
  assert.notEqual(differentOwner.id, pending.id);
  const question = {
    id: 'one',
    concept: 'where',
    kind: 'grammar',
    prompt: 'This is the park ___ we play.',
    options: ['where', 'who'],
    answer: 0,
    explanation: 'where',
    source: 'p1',
    needsReview: false,
  };
  const deck = {
    title: 'Saved lesson',
    summary: 'test',
    questions: [question],
  };
  await pool().query(
    "UPDATE studio_study_courses SET status='ready',source=NULL,deck=$2,progress=$3,adventure=$4 WHERE id=$1",
    [
      pending.id,
      JSON.stringify(deck),
      JSON.stringify({
        one: { seen: 2, misses: 1, stage: 0, due: 1, lastCorrect: false },
      }),
      JSON.stringify({ name: 'Original fox', growthXp: 12 }),
    ],
  );
  const duplicate = await uploadStudy(owner, {
    ...input,
    name: 'another-name.md',
  });
  assert.equal(duplicate.id, pending.id);
  assert.equal(duplicate.status, 'ready');
  const request = { ...input, duplicate: 'new', requestKey: randomUUID() };
  const clones = await Promise.all([
    uploadStudy(owner, request),
    uploadStudy(owner, request),
  ]);
  assert.equal(clones[0].id, clones[1].id);
  assert.notEqual(clones[0].id, pending.id);
  const rows = await listStudy(owner);
  assert.equal(rows.length, 2);
  const clone = rows.find((r) => r.id === clones[0].id),
    original = rows.find((r) => r.id === pending.id);
  assert.deepEqual(clone.deck, deck);
  assert.equal(clone.status, 'ready');
  assert.deepEqual(clone.progress, {});
  assert.deepEqual(clone.adventure, {});
  assert.equal(original.progress.one.misses, 1);
  assert.equal(original.adventure.growthXp, 12);
  await assert.rejects(
    uploadStudy(owner, {
      ...request,
      data: Buffer.from(
        'Different changed material with the same request key.',
      ).toString('base64'),
    }),
    /请求/,
  );
  const edited = await uploadStudy(owner, {
    name: 'lesson.txt',
    data: Buffer.from(
      'Changed file content should create a distinct learning course.',
    ).toString('base64'),
  });
  assert.notEqual(edited.id, pending.id);
  assert.equal((await uploadStudy(owner, input)).id, pending.id); // Reuse remains possible while another import is active.
  await pool().query(
    "UPDATE studio_study_courses SET status='failed',source=NULL WHERE id=$1",
    [edited.id],
  );
  const retry = await uploadStudy(owner, {
    name: 'lesson.txt',
    data: Buffer.from(
      'Changed file content should create a distinct learning course.',
    ).toString('base64'),
  });
  assert.notEqual(retry.id, edited.id);
});
