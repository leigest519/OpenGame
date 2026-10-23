import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import { databaseUrl } from '../../src/server/config';
import { pool, migrate } from '../../src/server/db';
import {
  createDraftProject,
  submitJob,
  claimJob,
  finishVersion,
  finishPlanning,
  getProject,
  restoreVersion,
  publishVersion,
  failJob,
} from '../../src/server/store';
import { createInvitation } from '../../src/server/access';
import { accountQuota } from '../../src/server/referrals';
import { uploadImageAsset } from '../../src/server/image-project';
let admin: pg.Client;
const name = `opengame_images_${process.pid}`;
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
async function image(projectId: string, ownerId?: string) {
  const data = await sharp({
    create: { width: 40, height: 80, channels: 4, background: '#aabbcc' },
  })
    .png()
    .toBuffer();
  return uploadImageAsset(projectId, ownerId, {
    name: '花树.png',
    data: data.toString('base64'),
  });
}
test('image draft retries preserve type; foreign and game assets cannot become image versions', async () => {
  const key = randomUUID();
  const draft = await createDraftProject(key, undefined, 'image');
  assert.deepEqual(await createDraftProject(key, undefined, 'image'), draft);
  await assert.rejects(createDraftProject(key, undefined, 'game'), /类型/);
  const other = await createDraftProject(randomUUID(), undefined, 'image');
  const asset = await image(other.projectId);
  await assert.rejects(
    submitJob({
      projectId: draft.projectId,
      requestKey: randomUUID(),
      prompt: '导入',
      kind: 'build',
      imageAssetId: asset.id,
    }),
    /找不到本项目/,
  );
  const game = await createDraftProject(randomUUID());
  await assert.rejects(image(game.projectId), /图片作品/);
});
test('image imports retain immutable versions, restore and publish without claiming game validation', async () => {
  const { projectId } = await createDraftProject(
    randomUUID(),
    undefined,
    'image',
  );
  const asset = await image(projectId);
  const input = {
    projectId,
    requestKey: randomUUID(),
    prompt: '古院花树',
    kind: 'build' as const,
    imageAssetId: asset.id,
  };
  const submitted = await submitJob(input);
  assert.deepEqual(await submitJob(input), submitted);
  const job = (await claimJob())!;
  const id = randomUUID();
  await finishVersion(job, {
    id,
    artifactKey: id,
    artifactHash: 'a'.repeat(64),
    commitSha: 'b'.repeat(40),
    summary: '图片已保存',
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
  const detail = await getProject(projectId);
  assert.equal(detail.project.media_kind, 'image');
  assert.equal(detail.versions[0].validation.start, false);
  assert.equal(detail.jobs[0].image_asset_id, asset.id);
  await publishVersion(projectId, id, null);
  await submitJob({
    ...input,
    requestKey: randomUUID(),
    baseVersionId: id,
    prompt: '第二版',
  });
  const secondJob = (await claimJob())!;
  const secondId = randomUUID();
  await finishVersion(secondJob, {
    id: secondId,
    artifactKey: secondId,
    artifactHash: 'c'.repeat(64),
    commitSha: 'd'.repeat(40),
    summary: '第二版',
    standardsVersion: '0.2.0',
    validation: detail.versions[0].validation,
  });
  const beforeSwitch = await getProject(projectId);
  assert.equal(await restoreVersion(projectId, id, secondId), id);
  const restored = await getProject(projectId);
  assert.equal(restored.versions.length, 2);
  assert.deepEqual(restored.versions, beforeSwitch.versions);
  assert.equal(restored.project.latest_version_id, id);
  assert.equal(await restoreVersion(projectId, id, id), id);
  await assert.rejects(
    restoreVersion(projectId, secondId, secondId),
    /已有更新/,
  );
  await submitJob({
    ...input,
    requestKey: randomUUID(),
    baseVersionId: id,
    prompt: '从第一版继续',
  });
  const thirdJob = (await claimJob())!;
  const thirdId = randomUUID();
  await finishVersion(thirdJob, {
    id: thirdId,
    artifactKey: thirdId,
    artifactHash: 'e'.repeat(64),
    commitSha: 'f'.repeat(40),
    summary: '第三版',
    standardsVersion: '0.2.0',
    validation: detail.versions[0].validation,
  });
  const continued = await getProject(projectId);
  assert.equal(continued.versions.length, 3);
  assert.equal(continued.versions[0].number, 3);
  assert.equal(continued.project.latest_version_id, thirdId);
  assert.equal(restored.project.released_version_id, id);
});
test('image implementation plans enter the image build path', async () => {
  const { projectId } = await createDraftProject(
    randomUUID(),
    undefined,
    'image',
  );
  await submitJob({
    projectId,
    requestKey: randomUUID(),
    prompt: '画一棵树',
    kind: 'chat',
  });
  const job = (await claimJob())!;
  const done = await finishPlanning(job, {
    action: 'implement',
    reply: '马上生成',
    plan: {
      goal: '画树',
      decisions: [],
      tasks: [{ title: '画树', detail: '紫色花树' }],
      checks: ['紫色花树'],
    },
  });
  assert.equal(done.kind, 'build');
  await failJob(done, 'test completed', true);
  assert.equal((await getProject(projectId)).versions.length, 0);
});

test('private image assets enforce ownership and imports do not consume credits', async () => {
  const owner = await createInvitation('图片作者');
  const stranger = await createInvitation('其他成员');
  const { projectId } = await createDraftProject(
    randomUUID(),
    owner.id,
    'image',
  );
  const before = await accountQuota(owner.id);
  await assert.rejects(image(projectId, stranger.id), /找不到/);
  const asset = await image(projectId, owner.id);
  await assert.rejects(getProject(projectId, stranger.id), /找不到/);
  await assert.rejects(
    submitJob({
      projectId,
      ownerId: stranger.id,
      requestKey: randomUUID(),
      prompt: '导入',
      kind: 'build',
      imageAssetId: asset.id,
    }),
    /找不到/,
  );
  await submitJob({
    projectId,
    ownerId: owner.id,
    requestKey: randomUUID(),
    prompt: '导入',
    kind: 'build',
    imageAssetId: asset.id,
  });
  assert.deepEqual(await accountQuota(owner.id), before);
  const job = (await claimJob())!;
  await failJob(job, 'test completed', true);
});
