import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';

process.env.OPENGAME_ACCESS_MODE = 'invite';
process.env.OPENGAME_PREVIEW_SECRET = randomBytes(32).toString('hex');
const { databaseUrl, appOrigin } = await import('../../src/server/config');
const { pool, migrate } = await import('../../src/server/db');
const {
  createInvitation,
  sessionViewer,
  sessionCookie,
  gameUrl,
  authorizedArtifact,
  hashToken,
} = await import('../../src/server/access');
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
const { loadKnowledge } = await import('../../src/server/knowledge');
let admin: pg.Client;
const name = `opengame_access_test_${process.pid}`;
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
function request(route: string, cookie = '', body?: unknown) {
  return new Request(`${appOrigin}/api/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: new URL(appOrigin).host,
      origin: appOrigin,
      'content-type': 'application/json',
      cookie,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function api(route: string, cookie = '', body?: unknown) {
  return dispatch(request(route, cookie, body), route.split('/'));
}
async function member(label: string) {
  const invited = await createInvitation(label);
  const response = await api('session', '', { code: invited.code });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const viewer = (await sessionViewer(request('session', cookie)))!;
  assert.ok(viewer);
  return { ...invited, cookie, viewer };
}
async function version(ownerId: string) {
  const project = await submitJob({
    prompt: 'Private game',
    requestKey: randomUUID(),
    ownerId,
  });
  const job = (await claimJob())!;
  assert.equal(job.project_id, project.projectId);
  const id = randomUUID();
  await finishVersion(job, {
    id,
    artifactKey: id,
    artifactHash: 'a'.repeat(64),
    commitSha: 'b'.repeat(40),
    summary: 'Private title and summary',
    standardsVersion: '0.1.0',
    validation: {
      build: true,
      browser: true,
      start: true,
      restart: true,
      errors: [],
      checkedAt: new Date().toISOString(),
    },
    lessons: [
      {
        title: '私有玩法经验',
        tags: ['撤销'],
        appliesTo: '私有回退玩法',
        advice: '只应该在本人知识库中读取。',
        pitfalls: '不要泄露私有游戏内容。',
      },
    ],
  });
  return { projectId: project.projectId, versionId: id, jobId: job.id };
}
test('all data endpoints require an active session and writes enforce origin', async () => {
  for (const route of [
    'projects',
    'account',
    'marketplace',
    'knowledge',
    'standards',
    'status',
    `play/${randomUUID()}`,
    `projects/${randomUUID()}/memory`,
  ])
    assert.equal((await api(route)).status, 401);
  assert.equal(
    (
      await api('projects', '', {
        prompt: 'unauthorized game',
        requestKey: randomUUID(),
      })
    ).status,
    401,
  );
  assert.equal((await api('session', '', { code: 'invalid' })).status, 401);
  const foreign = request('session', '', { code: 'invalid' });
  foreign.headers.set('origin', 'https://foreign.example');
  assert.equal((await dispatch(foreign, ['session'])).status, 403);
  const stored = (
    await pool().query('SELECT count(*)::int AS n FROM studio_projects')
  ).rows[0];
  assert.equal(stored.n, 0);
});
test('accounts cannot read, edit, restore, publish, cancel or reuse another member request', async () => {
  const a = await member('A'),
    b = await member('B');
  const p = await version(a.id);
  assert.equal(
    (await (await api('projects', b.cookie)).json()).projects.length,
    0,
  );
  for (const route of [
    `projects/${p.projectId}`,
    `projects/${p.projectId}/memory`,
  ])
    assert.equal((await api(route, b.cookie)).status, 404);
  for (const action of ['publish', 'restore'])
    assert.equal(
      (
        await api(`projects/${p.projectId}/${action}`, b.cookie, {
          versionId: p.versionId,
          expectedVersionId: null,
        })
      ).status,
      404,
    );
  assert.equal(
    (
      await api(`projects/${p.projectId}/jobs`, b.cookie, {
        prompt: 'change private game',
        requestKey: randomUUID(),
        baseVersionId: p.versionId,
      })
    ).status,
    404,
  );
  assert.equal((await api(`jobs/${p.jobId}/cancel`, b.cookie, {})).status, 404);
  const key = randomUUID();
  const pending = await submitJob({
    prompt: 'Another game',
    requestKey: key,
    ownerId: a.id,
  });
  await assert.rejects(
    submitJob({ prompt: 'Another game', requestKey: key, ownerId: b.id }),
    /找不到/,
  );
  await assert.rejects(
    restoreVersion(p.projectId, p.versionId, p.versionId, b.id),
    /找不到/,
  );
  await assert.rejects(
    publishVersion(p.projectId, p.versionId, null, b.id),
    /找不到/,
  );
  await cancelJob(pending.jobId, a.id);
  assert.ok(
    (await loadKnowledge(a.id)).some((e) => e.source.projectId === p.projectId),
  );
  assert.ok(
    !(await loadKnowledge(b.id)).some(
      (e) => e.source.projectId === p.projectId,
    ),
  );
  assert.equal(
    (await getProject(p.projectId, a.id)).project.latest_version_id,
    p.versionId,
  );
});
test('preview tickets protect all assets, scope, logout and revoked accounts', async () => {
  const a = await member('Preview owner'),
    b = await member('Player');
  const p = await version(a.id);
  const ticket = (url: string) => new URL(url).pathname.split('/')[3];
  assert.equal(await authorizedArtifact(p.versionId), null);
  const own = ticket(gameUrl(p.versionId, a.viewer));
  assert.equal(await authorizedArtifact(p.versionId, own), p.versionId);
  assert.equal(await authorizedArtifact(randomUUID(), own), null);
  assert.equal(
    await authorizedArtifact(
      p.versionId,
      ticket(gameUrl(p.versionId, b.viewer)),
    ),
    null,
  );
  const released = ticket(gameUrl(p.versionId, b.viewer, 'released'));
  assert.equal(await authorizedArtifact(p.versionId, released), null);
  const before = await (await api('marketplace', b.cookie)).json();
  assert.ok(
    !before.projects.some((item: { id: string }) => item.id === p.projectId),
  );
  await publishVersion(p.projectId, p.versionId, null, a.id);
  const listing = await api('marketplace', b.cookie);
  assert.equal(listing.status, 200);
  assert.equal(listing.headers.get('cache-control'), 'no-store');
  const shared = (await listing.json()).projects.find(
    (item: { id: string }) => item.id === p.projectId,
  );
  assert.ok(shared);
  assert.equal(shared.released_version_id, p.versionId);
  assert.equal(shared.owner_id, undefined);
  assert.equal(
    await authorizedArtifact(p.versionId, ticket(shared.previewUrl)),
    p.versionId,
  );
  assert.equal((await api(`projects/${p.projectId}`, b.cookie)).status, 404);
  assert.equal(await authorizedArtifact(p.versionId, released), p.versionId);
  assert.equal((await api(`play/${p.projectId}`, b.cookie)).status, 200);
  assert.equal((await api('logout', b.cookie, {})).status, 200);
  assert.equal(await authorizedArtifact(p.versionId, released), null);
  assert.equal((await api('projects', b.cookie)).status, 401);
  await pool().query('UPDATE studio_users SET disabled=true WHERE id=$1', [
    a.id,
  ]);
  assert.equal(await authorizedArtifact(p.versionId, own), null);
  assert.equal((await api('projects', a.cookie)).status, 401);
});
test('quotas serialize concurrent creations and idempotent retries consume one slot', async () => {
  const a = await member('Limited');
  await pool().query(
    'UPDATE studio_users SET daily_job_limit=2,total_job_limit=2,project_limit=2 WHERE id=$1',
    [a.id],
  );
  const input = {
    prompt: 'Quota game',
    requestKey: randomUUID(),
    ownerId: a.id,
  };
  const [x, y] = await Promise.all([submitJob(input), submitJob(input)]);
  assert.deepEqual(x, y);
  await assert.rejects(
    submitJob({ ...input, requestKey: randomUUID() }),
    /已有一个/,
  );
  await cancelJob(x.jobId, a.id);
  const results = await Promise.allSettled([
    submitJob({ ...input, requestKey: randomUUID() }),
    submitJob({ ...input, requestKey: randomUUID() }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const done = results.find(
    (r) => r.status === 'fulfilled',
  )! as PromiseFulfilledResult<typeof x>;
  await cancelJob(done.value.jobId, a.id);
  await assert.rejects(
    submitJob({ ...input, requestKey: randomUUID() }),
    /次数上限/,
  );
  assert.equal(
    (
      await pool().query(
        'SELECT count(*)::int AS n FROM studio_projects WHERE owner_id=$1',
        [a.id],
      )
    ).rows[0].n,
    2,
  );
});
test('ratings are per account, reversible and visits are idempotent', async () => {
  const a = await member('Rating A'),
    b = await member('Rating B');
  const p = await version(a.id);
  const route = `play/${p.projectId}`;
  assert.equal(
    (await api(`${route}/rating`, b.cookie, { rating: 1 })).status,
    404,
  );
  await publishVersion(p.projectId, p.versionId, null, a.id);
  assert.equal((await api(`${route}/rating`, '', { rating: 1 })).status, 401);
  assert.equal(
    (await api(`${route}/rating`, b.cookie, { rating: 2 })).status,
    400,
  );
  assert.equal(
    (await api(`${route}/visit`, b.cookie, { visitId: 'bad' })).status,
    400,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await api(`${route}/rating`, a.cookie, { rating: 1 })).status,
      200,
    );
  let stats = await (
    await api(`${route}/rating`, b.cookie, { rating: -1 })
  ).json();
  assert.deepEqual(stats, { likes: 1, dislikes: 1, visits: 0, myRating: -1 });
  stats = await (await api(`${route}/rating`, b.cookie, { rating: 1 })).json();
  assert.deepEqual(stats, { likes: 2, dislikes: 0, visits: 0, myRating: 1 });
  stats = await (await api(`${route}/rating`, b.cookie, { rating: 0 })).json();
  assert.deepEqual(stats, { likes: 1, dislikes: 0, visits: 0, myRating: 0 });
  const visitId = randomUUID();
  await Promise.all(
    Array.from({ length: 3 }, () =>
      api(`${route}/visit`, b.cookie, { visitId }),
    ),
  );
  stats = await (
    await api(`${route}/visit`, a.cookie, { visitId: randomUUID() })
  ).json();
  assert.equal(stats.visits, 2);
  const play = await (await api(route, b.cookie)).json();
  assert.equal(play.stats.visits, 2);
  assert.equal(play.stats.myRating, 0);
  const listing = await (await api('marketplace', b.cookie)).json();
  const card = listing.projects.find(
    (item: { id: string }) => item.id === p.projectId,
  );
  assert.equal(card.likes, 1);
  assert.equal(card.dislikes, 0);
  assert.equal(card.visits, 2);
});

test('referrals award once on first login and bonus credits work beyond both base limits', async () => {
  const a = await member('Inviter');
  assert.equal((await api('invitations', '', { label: 'Friend' })).status, 401);
  assert.equal((await api('invitations', a.cookie, { label: '' })).status, 400);
  const foreign = request('invitations', a.cookie, { label: 'Friend' });
  foreign.headers.set('origin', 'https://foreign.example');
  assert.equal((await dispatch(foreign, ['invitations'])).status, 403);
  await pool().query(
    'UPDATE studio_users SET daily_job_limit=1,total_job_limit=1 WHERE id=$1',
    [a.id],
  );
  const base = await submitJob({
    ownerId: a.id,
    prompt: 'Base',
    requestKey: randomUUID(),
  });
  await cancelJob(base.jobId, a.id);
  const quota = async () => await (await api('account', a.cookie)).json();
  assert.equal((await quota()).available, 0);
  const response = await api('invitations', a.cookie, { label: 'Friend' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const invitation = await response.json();
  assert.equal((await quota()).bonusRemaining, 0);
  const logins = await Promise.all(
    Array.from({ length: 4 }, () =>
      api('session', '', { code: invitation.code }),
    ),
  );
  assert.ok(logins.every((r) => r.status === 200));
  const friendCookie = logins[0].headers.get('set-cookie')!.split(';')[0];
  assert.equal(
    (await (await api('account', friendCookie)).json()).bonusRemaining,
    0,
  );
  assert.deepEqual(await quota(), {
    available: 5,
    dailyRemaining: 0,
    totalRemaining: 0,
    bonusRemaining: 5,
    paidRemaining: 0,
    invited: 1,
    activated: 1,
    invitationLimit: 10,
  });
  for (let i = 0; i < 5; i++) {
    const input = {
      ownerId: a.id,
      projectId: base.projectId,
      prompt: 'Bonus',
      requestKey: randomUUID(),
    };
    const [x, y] = await Promise.all([submitJob(input), submitJob(input)]);
    assert.deepEqual(x, y);
    await cancelJob(x.jobId, a.id);
    assert.equal((await quota()).available, 4 - i);
  }
  await assert.rejects(
    submitJob({
      ownerId: a.id,
      projectId: base.projectId,
      prompt: 'Empty',
      requestKey: randomUUID(),
    }),
    /次数上限/,
  );
  await api('session', '', { code: invitation.code });
  assert.equal((await quota()).bonusRemaining, 0);
  // Ageing bonus jobs must not replenish the one-time reward.
  await pool().query(
    "UPDATE studio_jobs SET created_at=now()-interval '2 days' WHERE project_id=$1",
    [base.projectId],
  );
  assert.equal((await quota()).available, 0);
});

test('invitation creation is bounded under concurrency and expiry cannot outlive inviter', async () => {
  const a = await member('Bounded inviter');
  await pool().query(
    "UPDATE studio_users SET expires_at=now()+interval '1 day' WHERE id=$1",
    [a.id],
  );
  const responses = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      api('invitations', a.cookie, { label: `Friend ${i}` }),
    ),
  );
  assert.equal(responses.filter((r) => r.status === 200).length, 10);
  assert.equal(responses.filter((r) => r.status === 429).length, 2);
  assert.equal(
    (
      await pool().query(
        'SELECT count(*)::int AS n FROM studio_users c JOIN studio_users p ON c.invited_by=p.id WHERE p.id=$1 AND c.expires_at>p.expires_at',
        [a.id],
      )
    ).rows[0].n,
    0,
  );
  const invitation = await responses.find((r) => r.status === 200)!.json();
  await pool().query(
    "UPDATE studio_users SET expires_at=now()-interval '1 second' WHERE access_hash=$1",
    [hashToken(invitation.code)],
  );
  assert.equal(
    (await api('session', '', { code: invitation.code })).status,
    401,
  );
  assert.equal((await (await api('account', a.cookie)).json()).activated, 0);
});

test('credentials are hashed, expiring, and login attempts are bounded', async () => {
  const a = await member('Expired');
  const row = (
    await pool().query('SELECT access_hash FROM studio_users WHERE id=$1', [
      a.id,
    ])
  ).rows[0];
  assert.equal(row.access_hash, hashToken(a.code));
  assert.match(sessionCookie('token'), /HttpOnly; SameSite=Strict/);
  await pool().query(
    "UPDATE studio_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [a.id],
  );
  assert.equal((await api('projects', a.cookie)).status, 401);
  await pool().query(
    "UPDATE studio_users SET expires_at=now()-interval '1 second' WHERE id=$1",
    [a.id],
  );
  assert.equal((await api('session', '', { code: a.code })).status, 401);
  await pool().query(
    'INSERT INTO studio_login_limits(bucket,attempts) VALUES($1,120) ON CONFLICT(bucket) DO UPDATE SET attempts=120',
    [Math.floor(Date.now() / 60000)],
  );
  assert.equal((await api('session', '', { code: a.code })).status, 429);
});
