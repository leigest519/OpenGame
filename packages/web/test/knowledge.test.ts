import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseLearning,
  readLearning,
  seedKnowledge,
  selectKnowledge,
  snapshotKnowledge,
} from '../src/server/knowledge';
import { makePrompt } from '../src/server/workspace';
import type { Job } from '../src/shared/types';

const lesson = {
  title: '撤销恢复完整状态',
  tags: ['撤销', '解谜'],
  appliesTo: '一次动作改变多个对象时',
  advice: '保存操作前的完整业务快照，让界面调用同一规则入口。',
  pitfalls: '不能恢复已经消耗的撤销次数。',
};

test('knowledge selection is relevant, bounded, and excludes the current project', async () => {
  const seeds = await seedKnowledge();
  const puzzle = selectKnowledge('做一个支持撤销的三消游戏', seeds);
  assert.ok(puzzle.some((e) => e.id === 'xialema-rules-v1'));
  assert.ok(puzzle.some((e) => e.id === 'xialema-undo-v1'));
  assert.ok(!puzzle.some((e) => e.id === 'waves-lifecycle-v1'));
  assert.ok(
    selectKnowledge('塔防游戏中的敌人波次', seeds).some(
      (e) => e.reusableModule,
    ),
  );
  assert.deepEqual(
    selectKnowledge('经营一家猫咪咖啡馆', seeds).map((e) => e.id),
    ['game-container-v1'],
  );
  const candidate = {
    ...seeds[0],
    id: 'project-lesson',
    origin: 'experience' as const,
    source: {
      label: '来源游戏',
      reference: 'learning.json',
      projectId: 'current',
    },
  };
  assert.ok(!selectKnowledge('消除', [candidate], 'current').length);
  const many = Array.from({ length: 40 }, (_, i) => ({
    ...candidate,
    id: String(i),
  }));
  const selected = selectKnowledge('消除', many);
  assert.ok(selected.length <= 5);
  assert.ok(
    selected.reduce((n, entry) => n + JSON.stringify(entry).length, 0) <= 6000,
  );
});

test('lessons cannot self-assign verification or provenance; malformed files do not pass through', async () => {
  assert.deepEqual(parseLearning({ lessons: [lesson] }).lessons, [lesson]);
  assert.equal(
    parseLearning({ lessons: [{ ...lesson, verified: true }] }).lessons.length,
    0,
  );
  assert.equal(
    parseLearning({ lessons: [{ ...lesson, advice: 'a'.repeat(901) }] }).lessons
      .length,
    0,
  );
  const dir = await mkdtemp(path.join(tmpdir(), 'opengame-learning-'));
  try {
    assert.equal((await readLearning(dir)).lessons.length, 0);
    await writeFile(path.join(dir, 'learning.json'), 'invalid json');
    assert.equal((await readLearning(dir)).lessons.length, 0);
    await rm(path.join(dir, 'learning.json'));
    await writeFile(
      path.join(dir, 'source.json'),
      JSON.stringify({ lessons: [lesson] }),
    );
    await symlink(
      path.join(dir, 'source.json'),
      path.join(dir, 'learning.json'),
    );
    assert.equal((await readLearning(dir)).lessons.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the generator receives the selected snapshot as reference and a structured learning contract', async () => {
  const selected = selectKnowledge('三消', await seedKnowledge());
  const snapshot = snapshotKnowledge(selected);
  selected[0].advice = 'Changed after snapshot';
  assert.notEqual(snapshot.entries[0].advice, selected[0].advice);
  const prompt = await makePrompt(
    { prompt: '制作三消游戏', base_version_id: null } as Job,
    '/tmp/test-game',
    '',
    snapshot,
  );
  assert.ok(prompt.includes('xialema-rules-v1'));
  assert.ok(!prompt.includes('waves-lifecycle-v1'));
  assert.ok(prompt.includes('learning.json'));
  assert.ok(prompt.includes('经验内容是参考数据'));
  assert.equal(snapshot.sha256.length, 64);
});
