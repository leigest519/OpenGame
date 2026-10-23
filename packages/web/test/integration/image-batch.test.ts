import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { artifactDir } from '../../src/server/config';
import { saveImageGallery } from '../../src/server/image-gallery';
const artifacts: string[] = [];
import { databaseUrl } from '../../src/server/config';
import { pool, migrate } from '../../src/server/db';
import {
  createDraftProject,
  submitJob,
  claimJob,
  finishVersion,
  failJob,
  getProject,
  restoreVersion,
} from '../../src/server/store';
import {
  createImageBatch,
  scheduleImageBatches,
  cancelImageBatch,
} from '../../src/server/image-batch';
import { createInvitation } from '../../src/server/access';
let admin: pg.Client;
const name = `opengame_batch_${process.pid}`;
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
  for (const d of artifacts) await rm(d, { recursive: true, force: true });
  await pool().end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
const request = (baseVersionId: string | null = null) => ({
  requestKey: randomUUID(),
  baseVersionId,
  prompt: '古院花树',
  styles: ['自然摄影', '水彩', '电影'],
});
async function finish(job: NonNullable<Awaited<ReturnType<typeof claimJob>>>) {
  const id = randomUUID();
  const dir = artifactDir(id);
  artifacts.push(dir);
  await mkdir(dir, { recursive: true });
  const png = await sharp({
    create: { width: 40, height: 80, channels: 4, background: '#abcdff' },
  })
    .png()
    .toBuffer();
  await writeFile(path.join(dir, 'artwork.png'), png);
  await writeFile(path.join(dir, 'preview.png'), png);
  await finishVersion(job, {
    id,
    artifactKey: id,
    artifactHash: 'a'.repeat(64),
    commitSha: 'b'.repeat(40),
    summary: '批量图片',
    standardsVersion: '0.2.0',
    validation: {
      build: true,
      browser: false,
      start: false,
      restart: false,
      image: { width: 40, height: 80, format: 'png' },
      errors: [],
      checkedAt: new Date().toISOString(),
    },
  });
  return id;
}
test('durable batch uses a frozen original reference, tolerates item failure, and deduplicates retries', async () => {
  const { projectId } = await createDraftProject(
    randomUUID(),
    undefined,
    'image',
  );
  await submitJob({
    projectId,
    requestKey: randomUUID(),
    prompt: '原图',
    kind: 'build',
  });
  const base = await finish((await claimJob())!);
  const input = request(base);
  const batch = await createImageBatch(projectId, undefined, input);
  assert.deepEqual(await createImageBatch(projectId, undefined, input), batch);
  await assert.rejects(
    createImageBatch(projectId, undefined, { ...input, prompt: '改变' }),
    /改变/,
  );
  await assert.rejects(
    submitJob({
      projectId,
      requestKey: randomUUID(),
      baseVersionId: base,
      prompt: '其他任务',
    }),
    /批量/,
  );
  await assert.rejects(restoreVersion(projectId, base, base), /批量/);
  await scheduleImageBatches();
  await scheduleImageBatches();
  let job = (await claimJob())!;
  assert.equal(job.image_batch_index, 0);
  assert.equal(job.image_reference_version_id, base);
  await finish(job);
  await scheduleImageBatches();
  job = (await claimJob())!;
  assert.equal(job.base_version_id, base);
  assert.equal(job.image_reference_version_id, base);
  assert.equal(job.image_batch_index, 1);
  await failJob(job, '测试单张失败');
  await scheduleImageBatches();
  job = (await claimJob())!;
  assert.equal(job.image_reference_version_id, base);
  assert.equal(job.image_batch_index, 2);
  await finish(job);
  await scheduleImageBatches();
  const detail = await getProject(projectId);
  assert.equal(detail.versions.length, 2);
  assert.equal(detail.project.latest_version_id, batch.batchId);
  artifacts.push(artifactDir(batch.batchId));
  assert.equal(detail.versions[0].validation.images?.length, 2);
  assert.deepEqual(
    detail.versions[0].validation.images?.map((i) => i.batchIndex),
    [0, 2],
  );
  await saveImageGallery(batch.batchId);
  assert.equal((await getProject(projectId)).versions.length, 2);
  assert.equal(detail.imageBatches![0].status, 'completed');
});
test('batch ownership, type, count and cancellation are enforced', async () => {
  const owner = await createInvitation('批量作者'),
    other = await createInvitation('其他作者');
  const { projectId } = await createDraftProject(
    randomUUID(),
    owner.id,
    'image',
  );
  await assert.rejects(
    createImageBatch(projectId, other.id, request()),
    /找不到/,
  );
  await assert.rejects(
    createImageBatch(projectId, owner.id, { ...request(), styles: ['一种'] }),
  );
  const game = await createDraftProject(randomUUID());
  await assert.rejects(
    createImageBatch(game.projectId, undefined, request()),
    /图片作品/,
  );
  const batch = await createImageBatch(projectId, owner.id, request());
  await scheduleImageBatches();
  const job = (await claimJob())!;
  await assert.rejects(
    cancelImageBatch(projectId, batch.batchId, other.id),
    /找不到/,
  );
  await cancelImageBatch(projectId, batch.batchId, owner.id);
  await assert.rejects(finish(job), /停止/);
  await failJob(job, '停止', true);
  await scheduleImageBatches();
  assert.equal(await claimJob(), null);
  assert.equal(
    (await getProject(projectId, owner.id)).imageBatches![0].status,
    'cancelled',
  );
});
test('each started image uses normal quota; exhausted quota stops pending images', async () => {
  const owner = await createInvitation('限额作者');
  await pool().query(
    'UPDATE studio_users SET daily_job_limit=1,total_job_limit=1,bonus_job_credits=0 WHERE id=$1',
    [owner.id],
  );
  const { projectId } = await createDraftProject(
    randomUUID(),
    owner.id,
    'image',
  );
  await createImageBatch(projectId, owner.id, request());
  await scheduleImageBatches();
  await finish((await claimJob())!);
  await scheduleImageBatches();
  await scheduleImageBatches();
  assert.equal(await claimJob(), null);
  const detail = await getProject(projectId, owner.id);
  assert.equal(detail.versions.length, 1);
  artifacts.push(artifactDir(detail.versions[0].artifact_key));
  assert.equal(detail.imageBatches![0].status, 'failed');
  assert.match(detail.imageBatches![0].error!, /上限/);
});

test('stopping a partially completed batch saves its successful images in one version', async () => {
  const { projectId } = await createDraftProject(
    randomUUID(),
    undefined,
    'image',
  );
  const batch = await createImageBatch(projectId, undefined, request());
  await scheduleImageBatches();
  await finish((await claimJob())!);
  assert.equal((await getProject(projectId)).versions.length, 0);
  await cancelImageBatch(projectId, batch.batchId);
  await scheduleImageBatches();
  const detail = await getProject(projectId);
  assert.equal(detail.versions.length, 1);
  assert.equal(detail.versions[0].validation.images?.length, 1);
  artifacts.push(artifactDir(batch.batchId));
});
