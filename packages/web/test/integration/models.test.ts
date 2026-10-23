import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { databaseUrl } from '../../src/server/config';
import { pool, migrate } from '../../src/server/db';
import {
  submitJob,
  claimJob,
  finishPlanning,
  cancelJob,
  getProject,
} from '../../src/server/store';
let admin: pg.Client;
const name = `opengame_models_${process.pid}`;
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
test('selected model persists through planning, build promotion and retry identity', async () => {
  const input = {
    prompt: '制作蜂蜜合成',
    kind: 'chat' as const,
    requestKey: randomUUID(),
    model: 'gpt-6-astra' as const,
  };
  const created = await submitJob(input);
  assert.deepEqual(await submitJob(input), created);
  await assert.rejects(submitJob({ ...input, model: 'default' }), /发生了变化/);
  const job = (await claimJob())!;
  assert.equal(job.model, 'gpt-6-astra');
  await finishPlanning(job, {
    action: 'implement',
    reply: '开始制作',
    plan: {
      goal: '合成',
      decisions: [],
      tasks: [{ title: '规则', detail: '连锁合成' }],
      checks: ['可以重开'],
    },
  });
  const detail = await getProject(created.projectId);
  assert.equal(detail.jobs[0].model, 'gpt-6-astra');
  assert.equal(detail.jobs[0].kind, 'build');
  await cancelJob(created.jobId);
});
test('omitted model is compatible with old clients', async () => {
  const created = await submitJob({
    prompt: '旧客户端',
    requestKey: randomUUID(),
  });
  assert.equal((await getProject(created.projectId)).jobs[0].model, 'default');
  await cancelJob(created.jobId);
});

test('proposal inherits Astra while explicit default is a distinct retry identity', async () => {
  const source = await submitJob({
    prompt: '先讨论',
    kind: 'chat',
    model: 'gpt-6-astra',
    requestKey: randomUUID(),
  });
  const job = (await claimJob())!;
  await finishPlanning(job, {
    action: 'propose',
    reply: '方案',
    plan: {
      goal: '合成',
      decisions: [],
      tasks: [{ title: '规则', detail: '连锁合成' }],
      checks: ['可以重开'],
    },
  });
  const input = {
    projectId: source.projectId,
    sourcePlanId: source.jobId,
    kind: 'build' as const,
    prompt: '开始',
    requestKey: randomUUID(),
  };
  const built = await submitJob(input);
  assert.equal(
    (await getProject(source.projectId)).jobs[0].model,
    'gpt-6-astra',
  );
  await assert.rejects(submitJob({ ...input, model: 'default' }), /发生了变化/);
  await cancelJob(built.jobId);
});
