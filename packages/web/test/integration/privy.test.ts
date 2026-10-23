import { before, after, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

process.env.OPENGAME_ACCESS_MODE = 'invite';
process.env.OPENGAME_AUTH_PROVIDER = 'privy';
process.env.OPENGAME_PRIVY_APP_ID = 'synthetic-privy-app';
process.env.OPENGAME_PREVIEW_SECRET = randomBytes(32).toString('hex');
const { databaseUrl, appOrigin, privyAppId } =
  await import('../../src/server/config');
const { pool, migrate } = await import('../../src/server/db');
const { dispatch } = await import('../../src/server/api');
const { createInvitation } = await import('../../src/server/access');
const { privyAuth } = await import('../../src/server/privy-access');
const { createPrivyVerifier } = await import('../../src/server/privy-token');
const pair = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test' };
let admin: pg.Client;
const name = `opengame_privy_test_${process.pid}`;
before(async () => {
  const original = databaseUrl();
  admin = new pg.Client({ connectionString: original });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(original);
  url.pathname = `/${name}`;
  process.env.OPENGAME_DATABASE_URL = url.toString();
  await migrate();
  mock.method(
    privyAuth,
    'verify',
    createPrivyVerifier(privyAppId, createLocalJWKSet({ keys: [jwk] })),
  );
});
after(async () => {
  mock.restoreAll();
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
const api = (route: string, cookie = '', body?: unknown) =>
  dispatch(request(route, cookie, body), route.split('/'));
const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0];
async function token(
  subject: string = randomUUID(),
  overrides: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: `did:privy:${subject}`,
    sid: randomUUID(),
    iss: 'privy.io',
    aud: privyAppId,
    iat: now,
    exp: now + 3600,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .sign(pair.privateKey);
}
async function registered() {
  const jwt = await token();
  const response = await api('session/privy', '', {
    token: jwt,
    action: 'login',
  });
  assert.equal(response.status, 200);
  const cookie = cookieOf(response);
  const session = await (await api('session', cookie)).json();
  return { jwt, cookie, id: session.user.id };
}
test('rejects forged, wrong-app, expired, anonymous links and cross-origin exchange', async () => {
  for (const jwt of [
    'forged',
    await token('bad-app', { aud: 'other' }),
    await token('expired', { exp: 1 }),
  ])
    assert.equal(
      (await api('session/privy', '', { token: jwt, action: 'login' })).status,
      401,
    );
  const jwt = await token();
  assert.equal(
    (
      await api('session/privy', '', {
        token: jwt,
        action: 'link',
        userId: randomUUID(),
      })
    ).status,
    401,
  );
  const req = request('session/privy', '', { token: jwt, action: 'login' });
  req.headers.set('origin', 'https://foreign.example');
  assert.equal((await dispatch(req, ['session', 'privy'])).status, 403);
  assert.equal(
    (await pool().query('SELECT count(*)::int AS n FROM studio_users')).rows[0]
      .n,
    0,
  );
});
test('concurrent first logins create one account and bounded sessions; registered users can invite', async () => {
  const jwt = await token();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      api('session/privy', '', { token: jwt, action: 'login' }),
    ),
  );
  assert.ok(results.every((r) => r.status === 200));
  const row = (
    await pool().query(
      'SELECT user_id FROM studio_identities WHERE subject=$1',
      [JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub],
    )
  ).rows[0];
  assert.equal(
    (await pool().query('SELECT count(*)::int AS n FROM studio_users')).rows[0]
      .n,
    1,
  );
  assert.equal(
    (
      await pool().query(
        'SELECT count(*)::int AS n FROM studio_sessions WHERE user_id=$1',
        [row.user_id],
      )
    ).rows[0].n,
    5,
  );
  const response = await api('session/privy', '', {
    token: jwt,
    action: 'login',
  });
  const cookie = cookieOf(response);
  const info = await (await api('session', cookie)).json();
  assert.equal(info.auth.appId, privyAppId);
  assert.equal(info.user.linked, true);
  const referral = await api('invitations', cookie, { label: 'Friend' });
  assert.equal(referral.status, 200);
  assert.ok(Number.isFinite(Date.parse((await referral.json()).expiresAt)));
});
test('linking preserves project, quota, expiry and ID, and revokes code and previous sessions', async () => {
  const old = await createInvitation('Existing creator');
  const login = await api('session', '', { code: old.code });
  const cookie = cookieOf(login);
  const project = randomUUID();
  await pool().query(
    "INSERT INTO studio_projects(id,title,description,owner_id) VALUES($1,'Old game','Saved',$2)",
    [project, old.id],
  );
  await pool().query(
    'UPDATE studio_users SET bonus_job_credits=7,total_job_limit=42 WHERE id=$1',
    [old.id],
  );
  const before = (
    await pool().query('SELECT expires_at FROM studio_users WHERE id=$1', [
      old.id,
    ])
  ).rows[0].expires_at;
  const jwt = await token();
  const linked = await api('session/privy', cookie, {
    token: jwt,
    action: 'link',
    userId: old.id,
  });
  assert.equal(linked.status, 200);
  const info = await (await api('session', cookieOf(linked))).json();
  assert.equal(info.user.id, old.id);
  assert.equal(info.user.label, 'Existing creator');
  assert.equal((await api('projects', cookie)).status, 401);
  assert.equal((await api('session', '', { code: old.code })).status, 401);
  assert.equal(
    (
      await pool().query('SELECT owner_id FROM studio_projects WHERE id=$1', [
        project,
      ])
    ).rows[0].owner_id,
    old.id,
  );
  const user = (
    await pool().query('SELECT * FROM studio_users WHERE id=$1', [old.id])
  ).rows[0];
  assert.equal(user.bonus_job_credits, 7);
  assert.equal(user.total_job_limit, 42);
  assert.deepEqual(user.expires_at, before);
  const again = await api('session/privy', '', { token: jwt, action: 'login' });
  assert.equal(
    (await (await api('session', cookieOf(again))).json()).user.id,
    old.id,
  );
});
test('identity conflicts and changed sessions cannot merge or replace accounts', async () => {
  const a = await registered(),
    b = await registered();
  assert.equal(
    (await api('session/privy', a.cookie, { token: b.jwt, action: 'login' }))
      .status,
    409,
  );
  assert.equal(
    (
      await api('session/privy', a.cookie, {
        token: b.jwt,
        action: 'link',
        userId: a.id,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('session/privy', a.cookie, {
        token: await token(),
        action: 'link',
        userId: a.id,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api('session/privy', a.cookie, {
        token: await token(),
        action: 'link',
        userId: b.id,
      })
    ).status,
    401,
  );
  assert.equal((await api('session', a.cookie)).status, 200);
});
test('disabled and expired accounts cannot regain access; logout is idempotent', async () => {
  const a = await registered();
  await pool().query('UPDATE studio_users SET disabled=true WHERE id=$1', [
    a.id,
  ]);
  assert.equal(
    (await api('session/privy', '', { token: a.jwt, action: 'login' })).status,
    403,
  );
  assert.equal((await api('projects', a.cookie)).status, 401);
  const b = await registered();
  await pool().query(
    "UPDATE studio_users SET expires_at=now()-interval '1 day' WHERE id=$1",
    [b.id],
  );
  assert.equal(
    (await api('session/privy', '', { token: b.jwt, action: 'login' })).status,
    403,
  );
  const c = await registered();
  assert.equal((await api('logout', c.cookie, {})).status, 200);
  assert.equal((await api('projects', c.cookie)).status, 401);
  assert.equal((await api('logout', c.cookie, {})).status, 200);
});
test('login exchange applies the shared persistent rate limit', async () => {
  await pool().query(
    'INSERT INTO studio_login_limits(bucket,attempts) VALUES($1,120) ON CONFLICT(bucket) DO UPDATE SET attempts=120',
    [Math.floor(Date.now() / 60000)],
  );
  assert.equal(
    (await api('session/privy', '', { token: await token(), action: 'login' }))
      .status,
    429,
  );
});
