import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import pg from 'pg';
import type { CanvasSnapshot, CanvasAsset } from '../../src/shared/canvas';
import { canvasAssetPath, emptyCanvas } from '../../src/shared/canvas';

process.env.OPENGAME_ACCESS_MODE = 'invite';
process.env.OPENGAME_PREVIEW_SECRET = randomBytes(32).toString('hex');
const { databaseUrl, appOrigin } = await import('../../src/server/config');
const { pool, migrate } = await import('../../src/server/db');
const { createInvitation } = await import('../../src/server/access');
const { dispatch } = await import('../../src/server/api');
const {
  submitJob,
  claimJob,
  finishVersion,
  getProject,
  cancelJob,
  restoreVersion,
  publishVersion,
} = await import('../../src/server/store');
const {
  getCanvas,
  saveCanvas,
  materializeCanvas,
  verifyCanvas,
  canvasImages,
  canvasPrompt,
} = await import('../../src/server/canvas');
let admin: pg.Client;
const name = `opengame_canvas_test_${process.pid}`;
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
async function api(route: string, cookie = '', body?: unknown) {
  return dispatch(
    new Request(`${appOrigin}/api/${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        host: new URL(appOrigin).host,
        origin: appOrigin,
        'content-type': 'application/json',
        cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    route.split('?')[0].split('/'),
  );
}
async function ok<T>(r: Response): Promise<T> {
  const v = await r.json();
  assert.equal(r.status, 200, JSON.stringify(v));
  return v;
}
async function member(label: string) {
  const user = await createInvitation(label);
  const r = await api('session', '', { code: user.code });
  assert.equal(r.status, 200);
  return { id: user.id, cookie: r.headers.get('set-cookie')!.split(';')[0] };
}
async function project(ownerId: string) {
  const p = await submitJob({
    prompt: 'Canvas fixture',
    requestKey: randomUUID(),
    ownerId,
  });
  await cancelJob(p.jobId, ownerId);
  return p.projectId;
}
async function png(color = '#78bcb2') {
  return (
    await sharp({
      create: { width: 32, height: 24, channels: 4, background: color },
    })
      .png()
      .toBuffer()
  ).toString('base64');
}
async function fixture() {
  const owner = await member('Canvas owner');
  const id = await project(owner.id);
  const asset = await ok<CanvasAsset>(
    await api(`projects/${id}/canvas/assets`, owner.cookie, {
      name: '角色.png',
      data: await png(),
    }),
  );
  const record = await saveCanvas(id, owner.id, {
    revision: 0,
    document: {
      version: 1,
      nodes: [
        {
          id: 'brief',
          type: 'document',
          title: '角色设计',
          text: '将参考图作为玩家精灵。',
          references: ['sprite'],
        },
        {
          id: 'sprite',
          type: 'image',
          title: '玩家',
          assetId: asset.id,
          description: '保持原有配色。',
          references: [],
        },
      ],
      layout: { brief: { x: 10, y: 10 }, sprite: { x: 300, y: 10 } },
    },
  });
  return { owner, id, asset, record };
}
test('design-first creation is idempotent, private and quota-bound without starting a model task', async () => {
  const owner = await member('Design first'),
    other = await member('Other designer');
  const input = { requestKey: randomUUID() };
  assert.equal((await api('projects/drafts', '', input)).status, 401);
  await pool().query('UPDATE studio_users SET project_limit=1 WHERE id=$1', [
    owner.id,
  ]);
  const [a, b] = await Promise.all([
    api('projects/drafts', owner.cookie, input),
    api('projects/drafts', owner.cookie, input),
  ]);
  const created = await ok<{ projectId: string }>(a);
  assert.deepEqual(created, await ok(b));
  assert.equal((await getProject(created.projectId, owner.id)).jobs.length, 0);
  assert.equal((await getCanvas(created.projectId, owner.id)).revision, 0);
  assert.equal((await api('projects/drafts', other.cookie, input)).status, 404);
  assert.equal(
    (await api('projects/drafts', owner.cookie, { requestKey: randomUUID() }))
      .status,
    429,
  );
});
test('canvas and normalized images remain private and assets cannot be borrowed across projects', async () => {
  const { owner, id, asset, record } = await fixture(),
    other = await member('Other');
  for (const route of [
    `projects/${id}/canvas`,
    `projects/${id}/canvas/assets/${asset.id}`,
  ]) {
    assert.equal((await api(route)).status, 401);
    assert.equal((await api(route, other.cookie)).status, 404);
  }
  assert.equal(
    (
      await api(`projects/${id}/canvas/assets`, other.cookie, {
        name: 'bad.png',
        data: 'not an image',
      })
    ).status,
    404,
  );
  const image = await api(
    `projects/${id}/canvas/assets/${asset.id}`,
    owner.cookie,
  );
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'no-store');
  assert.equal(
    (await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format,
    'png',
  );
  const again = await ok<CanvasAsset>(
    await api(`projects/${id}/canvas/assets`, owner.cookie, {
      name: 'renamed.png',
      data: await png(),
    }),
  );
  assert.equal(again.id, asset.id);
  const another = await project(owner.id);
  assert.equal(
    (
      await api(`projects/${another}/canvas`, owner.cookie, {
        revision: 0,
        document: record.document,
      })
    ).status,
    400,
  );
  assert.equal(
    (await api(`projects/${another}/canvas/assets/${asset.id}`, owner.cookie))
      .status,
    404,
  );
  for (const data of [
    'broken',
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
    ).toString('base64'),
  ])
    assert.equal(
      (
        await api(`projects/${id}/canvas/assets`, owner.cookie, {
          name: 'bad.png',
          data,
        })
      ).status,
      400,
    );
  assert.equal(
    (await api(`projects/${id}/canvas?versionId=${randomUUID()}`, owner.cookie))
      .status,
    404,
  );
});
test('submission freezes selected references; later drafts do not change the job, game or published version', async () => {
  const { owner, id, asset, record } = await fixture();
  const input = {
    projectId: id,
    ownerId: owner.id,
    baseVersionId: null,
    prompt: 'Use my selected design',
    requestKey: randomUUID(),
    canvas: { revision: record.revision, nodeIds: ['brief'] },
  };
  const submitted = await submitJob(input);
  assert.deepEqual(await submitJob(input), submitted);
  const job = (await claimJob())!;
  assert.equal(job.id, submitted.jobId);
  const snapshot = job.canvas_snapshot!;
  assert.deepEqual(snapshot.contextIds, ['brief', 'sprite']);
  assert.equal(snapshot.assets[0].id, asset.id);
  const later = structuredClone(record.document);
  later.nodes[0].title = '下一轮的新想法';
  const newer = await saveCanvas(id, owner.id, {
    revision: record.revision,
    document: later,
  });
  await assert.rejects(
    saveCanvas(id, owner.id, { revision: record.revision, document: later }),
    /其他修改/,
  );
  const versionId = randomUUID();
  await finishVersion(job, {
    id: versionId,
    artifactKey: versionId,
    artifactHash: 'a'.repeat(64),
    commitSha: 'b'.repeat(40),
    summary: 'Canvas fixture result',
    standardsVersion: '0.1.0',
    validation: {
      build: true,
      browser: true,
      start: true,
      restart: true,
      errors: [],
      checkedAt: new Date().toISOString(),
    },
  });
  await publishVersion(id, versionId, null, owner.id);
  assert.deepEqual(
    (await getCanvas(id, owner.id, versionId)).document,
    snapshot.document,
  );
  assert.equal(
    (await getCanvas(id, owner.id)).document.nodes[0].title,
    '下一轮的新想法',
  );
  const detail = await getProject(id, owner.id);
  assert.deepEqual(detail.versions[0].canvas_snapshot, snapshot);
  const json = await ok<{
    jobs: Record<string, unknown>[];
    versions: Record<string, unknown>[];
  }>(await api(`projects/${id}`, owner.cookie));
  assert.equal(json.jobs[0].canvas_snapshot, undefined);
  assert.equal(json.versions[0].canvas_snapshot, undefined);
  // A synthetic second version makes the first one historical. These are store
  // lifecycle fixtures; actual rendering/generation is checked separately.
  const second = randomUUID();
  await pool().query(
    "INSERT INTO studio_versions(id,project_id,number,commit_sha,artifact_key,artifact_hash,summary,kind,standards_version,validation) SELECT $1,project_id,2,commit_sha,artifact_key,artifact_hash,'Second fixture','generated',standards_version,validation FROM studio_versions WHERE id=$2",
    [second, versionId],
  );
  await pool().query(
    'UPDATE studio_projects SET latest_version_id=$2 WHERE id=$1',
    [id, second],
  );
  await assert.rejects(
    restoreVersion(id, versionId, second, owner.id, record.revision),
    /画布已有更新/,
  );
  const restored = await restoreVersion(
    id,
    versionId,
    second,
    owner.id,
    newer.revision,
  );
  assert.deepEqual((await getCanvas(id, owner.id)).document, snapshot.document);
  const after = await getProject(id, owner.id);
  assert.equal(after.project.latest_version_id, restored);
  assert.equal(after.project.released_version_id, versionId);
});
test('queued snapshot materializes immutable files and rejects changes or links before commit', async () => {
  const { owner, id, asset, record } = await fixture();
  const submitted = await submitJob({
    projectId: id,
    ownerId: owner.id,
    prompt: 'Use selected art',
    requestKey: randomUUID(),
    canvas: { revision: record.revision, nodeIds: ['brief'] },
  });
  const snapshot = (
    await pool().query('SELECT canvas_snapshot FROM studio_jobs WHERE id=$1', [
      submitted.jobId,
    ])
  ).rows[0].canvas_snapshot as CanvasSnapshot;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opengame-canvas-'));
  try {
    const images = await materializeCanvas(id, dir, snapshot);
    assert.deepEqual(images, [path.join(dir, canvasAssetPath(asset.id))]);
    assert.deepEqual(canvasImages(dir, snapshot), images);
    assert.match(canvasPrompt(snapshot), new RegExp(asset.id));
    await verifyCanvas(dir, snapshot);
    await writeFile(path.join(dir, 'canvas/board.json'), '{}');
    await assert.rejects(verifyCanvas(dir, snapshot), /改变了画布/);
    await materializeCanvas(id, dir, snapshot);
    await writeFile(images[0], 'bad');
    await assert.rejects(verifyCanvas(dir, snapshot), /改变了引用素材/);
    await rm(path.join(dir, 'assets'), { recursive: true });
    await mkdir(path.join(dir, 'outside'));
    await symlink(path.join(dir, 'outside'), path.join(dir, 'assets'));
    await assert.rejects(materializeCanvas(id, dir, snapshot), /普通目录/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await cancelJob(submitted.jobId, owner.id);
  }
});
test('stale, missing or excessive selected images cannot enqueue a task', async () => {
  const { owner, id, record } = await fixture();
  const base = {
    projectId: id,
    ownerId: owner.id,
    prompt: 'Use selected design',
    requestKey: randomUUID(),
  };
  await assert.rejects(
    submitJob({ ...base, canvas: { revision: 0, nodeIds: ['brief'] } }),
    /画布已有更新/,
  );
  await assert.rejects(
    submitJob({
      ...base,
      canvas: { revision: record.revision, nodeIds: ['missing'] },
    }),
    /已不存在/,
  );
  const doc = structuredClone(record.document);
  for (let i = 1; i <= 4; i++) {
    const asset = await ok<CanvasAsset>(
      await api(`projects/${id}/canvas/assets`, owner.cookie, {
        name: `${i}.png`,
        data: await png(`#${i}01199`),
      }),
    );
    doc.nodes.push({
      id: `art${i}`,
      title: `${i}`,
      type: 'image',
      assetId: asset.id,
      description: '',
      references: [],
    });
    doc.layout[`art${i}`] = { x: i * 100, y: 0 };
    doc.nodes[0].references.push(`art${i}`);
  }
  const saved = await saveCanvas(id, owner.id, {
    revision: record.revision,
    document: doc,
  });
  await assert.rejects(
    submitJob({
      ...base,
      canvas: { revision: saved.revision, nodeIds: ['brief'] },
    }),
    /最多引用 4/,
  );
  assert.equal(
    (await getProject(id, owner.id)).jobs.filter((j) => j.status === 'queued')
      .length,
    0,
  );
});
test('restoring a legacy version clears only the canvas draft and retains the image library', async () => {
  const { owner, id, record } = await fixture();
  const legacy = randomUUID();
  await pool().query(
    "INSERT INTO studio_versions(id,project_id,number,commit_sha,artifact_key,artifact_hash,summary,kind,standards_version,validation) VALUES($1::uuid,$2,1,$3,$1::text,$4,'Legacy','generated','0.1.0','{}')",
    [legacy, id, 'b'.repeat(40), 'a'.repeat(64)],
  );
  await restoreVersion(id, legacy, null, owner.id, record.revision);
  const restored = await getCanvas(id, owner.id);
  assert.deepEqual(restored.document, emptyCanvas());
  assert.equal(restored.assets.length, 1);
});
