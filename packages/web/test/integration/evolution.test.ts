import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

process.env.OPENGAME_ACCESS_MODE = 'invite';
process.env.OPENGAME_PREVIEW_SECRET = randomBytes(32).toString('hex');
const { databaseUrl, appOrigin } = await import('../../src/server/config');
const { pool, migrate } = await import('../../src/server/db');
const { createInvitation } = await import('../../src/server/access');
const { dispatch } = await import('../../src/server/api');
const { submitJob, claimJob, finishVersion, getProject } =
  await import('../../src/server/store');
const { loadKnowledge, selectKnowledge, snapshotKnowledge } =
  await import('../../src/server/knowledge');
const { regressionSuite } =
  await import('../../src/server/evolution-regression');
const { recoverEvolutionChecks } = await import('../../src/server/evolution');
let admin: pg.Client;
const name = `opengame_evolution_test_${process.pid}`;
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
  const req = new Request(`${appOrigin}/api/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: new URL(appOrigin).host,
      origin: appOrigin,
      'content-type': 'application/json',
      cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return dispatch(req, route.split('/'));
}
async function member(label: string) {
  const invited = await createInvitation(label);
  const response = await api('session', '', { code: invited.code });
  assert.equal(response.status, 200);
  return {
    id: invited.id,
    cookie: response.headers.get('set-cookie')!.split(';')[0],
  };
}
const lesson = {
  title: '撤销保存随机状态',
  tags: ['撤销', '消除'],
  appliesTo: '会在落子后重新发牌的网格游戏',
  advice: '保存棋盘、手牌、计分和随机状态；重做同一步时发牌结果应保持一致。',
  pitfalls: '非法落子不应覆盖快照，撤销次数单独消费。',
};
async function source(ownerId: string) {
  const p = await submitJob({
    prompt: 'Private fixture',
    requestKey: randomUUID(),
    ownerId,
  });
  const job = (await claimJob())!;
  const versionId = randomUUID();
  await finishVersion(job, {
    id: versionId,
    artifactKey: versionId,
    artifactHash: 'a'.repeat(64),
    commitSha: 'b'.repeat(40),
    summary: 'Secret prototype title',
    standardsVersion: '0.1.0',
    validation: {
      build: true,
      browser: true,
      start: true,
      restart: true,
      errors: [],
      checkedAt: new Date().toISOString(),
    },
    lessons: [lesson],
  });
  const experienceId = (
    await pool().query('SELECT id FROM studio_experiences WHERE job_id=$1', [
      job.id,
    ])
  ).rows[0].id;
  return { ...p, versionId, sourceId: `${experienceId}:0` };
}
async function jsonOK(response: Response) {
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}
async function passed(id: string) {
  const suite = await regressionSuite();
  const row = (
    await pool().query(
      'SELECT content_hash FROM studio_knowledge_releases WHERE id=$1',
      [id],
    )
  ).rows[0];
  // Synthetic evidence tests lifecycle/authorization only. The real Docker
  // executor is exercised separately; this is not a gameplay test result.
  const report = {
    contentHash: row.content_hash,
    suiteHash: suite.hash,
    checkedAt: new Date().toISOString(),
    passed: true,
    scope: 'reference-rules',
    environment: { kind: 'docker', image: `sha256:${'a'.repeat(64)}` },
    cases: suite.cases.map((c) => ({
      id: c.id,
      title: c.title,
      passed: true,
      durationMs: 1,
      tests: c.tests.map((name) => ({ name, passed: true })),
    })),
  };
  await pool().query(
    "UPDATE studio_knowledge_releases SET status='passed',report=$2,checked_at=now() WHERE id=$1",
    [id, report],
  );
  return report;
}

test('only owners contribute and configured maintainers review; model metadata cannot bypass approval', async () => {
  const a = await member('Owner'),
    b = await member('Other'),
    reviewer = await member('Maintainer');
  process.env.OPENGAME_KNOWLEDGE_REVIEWERS = reviewer.id;
  const p = await source(a.id);
  assert.equal((await api('evolution')).status, 401);
  assert.equal(
    (
      await api('evolution/candidates', b.cookie, {
        sourceId: p.sourceId,
        lesson,
        consent: true,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await api('evolution/candidates', a.cookie, {
        sourceId: p.sourceId,
        lesson,
        consent: false,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api('evolution/candidates', a.cookie, {
        sourceId: p.sourceId,
        lesson: { ...lesson, verified: true },
        consent: true,
      })
    ).status,
    400,
  );
  const first = await jsonOK(
    await api('evolution/candidates', a.cookie, {
      sourceId: p.sourceId,
      lesson,
      consent: true,
    }),
  );
  const again = await jsonOK(
    await api('evolution/candidates', a.cookie, {
      sourceId: p.sourceId,
      lesson,
      consent: true,
    }),
  );
  assert.equal(first.id, again.id);
  const otherOverview = await jsonOK(await api('evolution', b.cookie));
  assert.equal(otherOverview.canReview, false);
  assert.equal(otherOverview.candidates.length, 0);
  assert.equal(otherOverview.sources.length, 0);
  const overview = await jsonOK(await api('evolution', reviewer.cookie)),
    c = overview.candidates.find((x: { id: string }) => x.id === first.id);
  const decision = {
    contentHash: c.contentHash,
    decision: 'reviewed',
    note: '仅保留通用做法，来源规则覆盖状态恢复与随机数回放。',
    generalOnly: true,
  };
  assert.equal(
    (await api(`evolution/candidates/${c.id}/review`, b.cookie, decision))
      .status,
    403,
  );
  assert.equal(
    (
      await api(`evolution/candidates/${c.id}/review`, reviewer.cookie, {
        ...decision,
        contentHash: 'f'.repeat(64),
      })
    ).status,
    409,
  );
  const draft = {
    requestKey: randomUUID(),
    candidateIds: [c.id],
    label: '审核门槛',
    expectedReleaseId: null,
  };
  assert.equal(
    (await api('evolution/releases', reviewer.cookie, draft)).status,
    400,
  );
  assert.equal((await api('evolution/releases', a.cookie, draft)).status, 403);
  await jsonOK(
    await api(`evolution/candidates/${c.id}/review`, reviewer.cookie, decision),
  );
  await jsonOK(
    await api(`evolution/candidates/${c.id}/review`, reviewer.cookie, decision),
  );
  const release = await jsonOK(
    await api('evolution/releases', reviewer.cookie, draft),
  );
  assert.equal(
    (await jsonOK(await api('evolution/releases', reviewer.cookie, draft))).id,
    release.id,
  );
  assert.equal(
    (
      await api('evolution/releases', reviewer.cookie, {
        ...draft,
        label: '同编号不同需求',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('evolution/releases', reviewer.cookie, {
        ...draft,
        requestKey: randomUUID(),
      })
    ).status,
    409,
  );
  const activation = { targetReleaseId: release.id, expectedReleaseId: null };
  assert.equal(
    (await api('evolution/activate', reviewer.cookie, activation)).status,
    409,
  );
  assert.equal(
    (await api('evolution/activate', b.cookie, activation)).status,
    403,
  );
  const report = await passed(release.id);
  await pool().query(
    'UPDATE studio_knowledge_releases SET report=$2 WHERE id=$1',
    [release.id, { ...report, cases: report.cases.slice(1) }],
  );
  assert.equal(
    (await api('evolution/activate', reviewer.cookie, activation)).status,
    409,
  );
  await pool().query(
    'UPDATE studio_knowledge_releases SET report=$2 WHERE id=$1',
    [release.id, report],
  );
  await jsonOK(await api('evolution/activate', reviewer.cookie, activation));
  await jsonOK(await api('evolution/activate', reviewer.cookie, activation));
  const publicEntries = (await loadKnowledge(b.id)).filter(
    (e) => e.origin === 'public',
  );
  assert.equal(publicEntries.length, 1);
  assert.equal(publicEntries[0].advice, lesson.advice);
  assert.ok(!JSON.stringify(publicEntries).includes(p.projectId));
  assert.ok(!JSON.stringify(publicEntries).includes('Secret prototype'));
  const selected = selectKnowledge(
    '消除游戏支持撤销',
    await loadKnowledge(b.id),
  );
  assert.ok(selected.some((e) => e.publicReleaseId === release.id));
  const snapshot = snapshotKnowledge(selected);
  assert.ok(snapshot.entries.some((e) => e.publicReleaseId === release.id));
  await jsonOK(
    await api('evolution/activate', reviewer.cookie, {
      targetReleaseId: null,
      expectedReleaseId: release.id,
    }),
  );
  assert.equal(
    (await loadKnowledge(b.id)).filter((e) => e.origin === 'public').length,
    0,
  );
  assert.ok(snapshot.entries.some((e) => e.publicReleaseId === release.id));
  assert.equal(
    (await getProject(p.projectId, a.id)).project.latest_version_id,
    p.versionId,
  );
  await jsonOK(await api('evolution/activate', reviewer.cookie, activation));
});

test('concurrent activation cannot overwrite another publication and interrupted checks fail closed', async () => {
  const reviewer = await member('Release maintainer');
  process.env.OPENGAME_KNOWLEDGE_REVIEWERS = reviewer.id;
  const overview = await jsonOK(await api('evolution', reviewer.cookie));
  const c = overview.candidates.find(
    (x: { status: string }) => x.status === 'reviewed',
  );
  const base = overview.activeReleaseId;
  const one = await jsonOK(
    await api('evolution/releases', reviewer.cookie, {
      requestKey: randomUUID(),
      candidateIds: [c.id],
      label: '发布竞争一',
      expectedReleaseId: base,
    }),
  );
  await passed(one.id);
  const two = await jsonOK(
    await api('evolution/releases', reviewer.cookie, {
      requestKey: randomUUID(),
      candidateIds: [c.id],
      label: '发布竞争二',
      expectedReleaseId: base,
    }),
  );
  await passed(two.id);
  const responses = await Promise.all(
    [one, two].map((r) =>
      api('evolution/activate', reviewer.cookie, {
        targetReleaseId: r.id,
        expectedReleaseId: base,
      }),
    ),
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const current = (await jsonOK(await api('evolution', reviewer.cookie)))
    .activeReleaseId;
  const interrupted = await jsonOK(
    await api('evolution/releases', reviewer.cookie, {
      requestKey: randomUUID(),
      candidateIds: [c.id],
      label: '中断复验',
      expectedReleaseId: current,
    }),
  );
  await pool().query(
    "UPDATE studio_knowledge_releases SET status='running' WHERE id=$1",
    [interrupted.id],
  );
  await recoverEvolutionChecks();
  assert.equal(
    (
      await api('evolution/activate', reviewer.cookie, {
        targetReleaseId: interrupted.id,
        expectedReleaseId: current,
      })
    ).status,
    409,
  );
  assert.equal(
    (await jsonOK(await api('evolution', reviewer.cookie))).activeReleaseId,
    current,
  );
});

test('outdated or changed evidence and tampered entries cannot be newly published', async () => {
  const reviewer = await member('Evidence maintainer');
  process.env.OPENGAME_KNOWLEDGE_REVIEWERS = reviewer.id;
  const overview = await jsonOK(await api('evolution', reviewer.cookie));
  const c = overview.candidates.find(
    (x: { status: string }) => x.status === 'reviewed',
  );
  const release = await jsonOK(
    await api('evolution/releases', reviewer.cookie, {
      requestKey: randomUUID(),
      candidateIds: [c.id],
      label: '证据时效',
      expectedReleaseId: overview.activeReleaseId,
    }),
  );
  await passed(release.id);
  const activation = {
    targetReleaseId: release.id,
    expectedReleaseId: overview.activeReleaseId,
  };
  await pool().query(
    "UPDATE studio_knowledge_releases SET checked_at=now()-interval '2 days' WHERE id=$1",
    [release.id],
  );
  assert.equal(
    (await api('evolution/activate', reviewer.cookie, activation)).status,
    409,
  );
  await pool().query(
    'UPDATE studio_knowledge_releases SET checked_at=now(),suite_hash=$2 WHERE id=$1',
    [release.id, '0'.repeat(64)],
  );
  assert.equal(
    (await api('evolution/activate', reviewer.cookie, activation)).status,
    409,
  );
  const suite = await regressionSuite();
  await pool().query(
    "UPDATE studio_knowledge_releases SET suite_hash=$2,entries='[]'::jsonb WHERE id=$1",
    [release.id, suite.hash],
  );
  assert.equal(
    (await api('evolution/activate', reviewer.cookie, activation)).status,
    409,
  );
});
