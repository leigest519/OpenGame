import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseUrl } from '../../src/server/config';
import { pool, migrate } from '../../src/server/db';
import {
  submitJob,
  claimJob,
  stageVersion,
  finishVersion,
  getProject,
  cancelJob,
  failJob,
  publishVersion,
  restoreVersion,
} from '../../src/server/store';
import type { Job, PreparedVersion } from '../../src/shared/types';
import { loadKnowledge, selectKnowledge } from '../../src/server/knowledge';

let admin: pg.Client;
const name = `opengame_test_${process.pid}`;
before(async () => {
  const original = databaseUrl();
  admin = new pg.Client({ connectionString: original });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(original);
  url.pathname = `/${name}`;
  process.env.OPENGAME_DATABASE_URL = url.toString();
  await migrate();
});
after(async () => {
  await pool().end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
function prepared(): PreparedVersion {
  const id = randomUUID();
  return {
    id,
    artifactKey: id,
    artifactHash: 'a'.repeat(64),
    commitSha: 'b'.repeat(40),
    summary: 'Test result',
    standardsVersion: '0.1.0',
    validation: {
      build: true,
      browser: true,
      start: true,
      restart: true,
      errors: [],
      checkedAt: new Date().toISOString(),
    },
  };
}
async function finish(job: Job) {
  const v = prepared();
  await stageVersion(job, v);
  await finishVersion(job, v);
  return v;
}

test('duplicate submissions create one project and task; stale edits never overwrite versions', async () => {
  const input = { prompt: 'Test original game', requestKey: randomUUID() };
  const [first, second] = await Promise.all([
    submitJob(input),
    submitJob(input),
  ]);
  assert.deepEqual(first, second);
  await assert.rejects(
    submitJob({ ...input, prompt: 'Changed request' }),
    /内容发生/,
  );
  await assert.rejects(
    submitJob({
      projectId: first.projectId,
      prompt: 'Concurrent edit',
      requestKey: randomUUID(),
    }),
    /正在制作/,
  );
  const job = (await claimJob())!;
  const version = await finish(job);
  await finishVersion(job, version);
  assert.equal((await getProject(first.projectId)).versions.length, 1);
  await assert.rejects(
    submitJob({
      projectId: first.projectId,
      baseVersionId: null,
      prompt: 'Stale edit',
      requestKey: randomUUID(),
    }),
    /项目已有更新/,
  );
});
test('cancellation and obsolete execution leases cannot publish a candidate', async () => {
  const p = await submitJob({
    prompt: 'Cancellation test',
    requestKey: randomUUID(),
  });
  const job = (await claimJob())!;
  const old = { ...job, lease_token: randomUUID() };
  await assert.rejects(stageVersion(old, prepared()), /执行权/);
  await cancelJob(job.id);
  await assert.rejects(finishVersion(job, prepared()), /已停止/);
  await failJob(job, 'Cancelled');
  const detail = await getProject(p.projectId);
  assert.equal(detail.project.latest_version_id, null);
  assert.equal(detail.jobs[0].status, 'cancelled');
  assert.equal(detail.versions.length, 0);
});
test('failed edits and restoring old versions preserve published games and append history', async () => {
  const p = await submitJob({
    prompt: 'Version test',
    requestKey: randomUUID(),
  });
  const v1 = await finish((await claimJob())!);
  await publishVersion(p.projectId, v1.id, null);
  await submitJob({
    projectId: p.projectId,
    baseVersionId: v1.id,
    prompt: 'Fail this edit',
    requestKey: randomUUID(),
  });
  await failJob((await claimJob())!, 'Expected failure');
  assert.equal(
    (await getProject(p.projectId)).project.latest_version_id,
    v1.id,
  );
  await submitJob({
    projectId: p.projectId,
    baseVersionId: v1.id,
    prompt: 'Successful edit',
    requestKey: randomUUID(),
  });
  const v2 = await finish((await claimJob())!);
  const restored = await restoreVersion(p.projectId, v1.id, v2.id);
  const detail = await getProject(p.projectId);
  assert.equal(detail.versions.length, 3);
  assert.equal(detail.project.released_version_id, v1.id);
  assert.equal(detail.project.latest_version_id, restored);
  assert.equal(detail.versions[0].source_version_id, v1.id);
  assert.equal(detail.messages.filter((m) => m.role === 'user').length, 3);
  await assert.rejects(
    publishVersion(p.projectId, v2.id, null),
    /发布版本已改变/,
  );
});
test('prepared results remain available for save recovery without executing a new generation', async () => {
  const p = await submitJob({
    prompt: 'Save recovery',
    requestKey: randomUUID(),
  });
  const job = (await claimJob())!;
  const version = prepared();
  await stageVersion(job, version);
  assert.equal((await getProject(p.projectId)).project.latest_version_id, null);
  const persisted = (await getProject(p.projectId)).jobs[0];
  assert.deepEqual(persisted.prepared, version);
  await finishVersion(job, persisted.prepared!);
  assert.equal(
    (await getProject(p.projectId)).project.latest_version_id,
    version.id,
  );
});

test('saved lessons feed a later project exactly once while failed and cancelled jobs cannot contribute', async () => {
  const input = {
    title: '跨项目撤销经验',
    tags: ['撤销'],
    appliesTo: '需要回退动作的游戏',
    advice: '先保存完整快照，再统一更新业务状态。',
    pitfalls: '撤销自身的次数不能恢复。',
  };
  const p = await submitJob({
    prompt: 'Knowledge source game',
    requestKey: randomUUID(),
  });
  const job = (await claimJob())!;
  const v = { ...prepared(), lessons: [input] };
  await stageVersion(job, v);
  assert.ok(
    !(await loadKnowledge()).some((e) => e.source.projectId === p.projectId),
  );
  await finishVersion(job, v);
  await finishVersion(job, v);
  const entries = await loadKnowledge();
  const contributed = entries.filter((e) => e.source.projectId === p.projectId);
  assert.equal(contributed.length, 1);
  assert.equal(contributed[0].source.versionId, v.id);
  assert.equal(contributed[0].origin, 'experience');
  assert.match(contributed[0].verification, /待复验/);
  assert.ok(
    selectKnowledge('做一个能撤销的游戏', entries).some(
      (e) => e.id === contributed[0].id,
    ),
  );
  assert.ok(
    !selectKnowledge('撤销', entries, p.projectId).some(
      (e) => e.source.projectId === p.projectId,
    ),
  );
  for (const cancelled of [false, true]) {
    const failed = await submitJob({
      prompt: 'Failed knowledge source',
      requestKey: randomUUID(),
    });
    const other = (await claimJob())!;
    await stageVersion(other, {
      ...prepared(),
      lessons: [{ ...input, title: '不能进入的经验' }],
    });
    if (cancelled) await cancelJob(other.id);
    await failJob(other, 'Expected failure', cancelled);
    assert.ok(
      !(await loadKnowledge()).some(
        (e) => e.source.projectId === failed.projectId,
      ),
    );
  }
});
