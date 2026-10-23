import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generatorArguments } from '../src/server/generator-policy';

test('public configuration fails closed and HTTPS uses host-only secure cookies', () => {
  const base = {
    ...process.env,
    OPENGAME_APP_ORIGIN: 'https://studio.example.com',
    OPENGAME_PREVIEW_ORIGIN: 'https://games.example.com',
    OPENGAME_PREVIEW_SECRET: 'synthetic-only-'.repeat(4),
  };
  const inspect = (overrides: Record<string, string>) =>
    spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        'const {previewSecret}=await import("./src/server/config.ts");previewSecret();const {sessionCookie}=await import("./src/server/access.ts");console.log(sessionCookie("test"))',
      ],
      { env: { ...base, ...overrides }, encoding: 'utf8' },
    );
  assert.notEqual(inspect({ OPENGAME_ACCESS_MODE: 'local' }).status, 0);
  assert.notEqual(
    inspect({
      OPENGAME_ACCESS_MODE: 'invite',
      OPENGAME_PREVIEW_ORIGIN: 'http://127.0.0.1:4191',
    }).status,
    0,
  );
  assert.notEqual(
    inspect({
      OPENGAME_ACCESS_MODE: 'invite',
      OPENGAME_PREVIEW_ORIGIN: base.OPENGAME_APP_ORIGIN,
    }).status,
    0,
  );
  assert.notEqual(
    inspect({
      OPENGAME_ACCESS_MODE: 'invite',
      OPENGAME_PREVIEW_SECRET:
        'CHANGE_ME_TO_A_RANDOM_VALUE_OF_AT_LEAST_32_CHARACTERS',
    }).status,
    0,
  );
  assert.notEqual(
    inspect({
      OPENGAME_ACCESS_MODE: 'invite',
      OPENGAME_AUTH_PROVIDER: 'privy',
      OPENGAME_PRIVY_APP_ID: '',
    }).status,
    0,
  );
  assert.notEqual(
    inspect({
      OPENGAME_ACCESS_MODE: 'local',
      OPENGAME_AUTH_PROVIDER: 'privy',
      OPENGAME_PRIVY_APP_ID: 'synthetic-privy-app',
    }).status,
    0,
  );
  assert.equal(
    inspect({
      OPENGAME_ACCESS_MODE: 'invite',
      OPENGAME_AUTH_PROVIDER: 'privy',
      OPENGAME_PRIVY_APP_ID: 'synthetic-privy-app',
    }).status,
    0,
  );
  const secure = inspect({ OPENGAME_ACCESS_MODE: 'invite' });
  assert.equal(secure.status, 0, secure.stderr);
  assert.match(
    secure.stdout,
    /__Host-opengame_session=test; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/,
  );
  assert.doesNotMatch(secure.stdout, /Domain=/);
});
test('generation selects a restricted profile without legacy sandbox overrides', () => {
  const args = generatorArguments('/workspace/game');
  assert.ok(args.includes('--strict-config'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(!args.includes('--sandbox'));
  const profile = args.find((arg) => arg.startsWith('permissions.'))!;
  assert.match(profile, /":root"="deny"/);
  assert.match(profile, /":tmpdir"="deny"/);
  assert.match(profile, /":slash_tmp"="deny"/);
  assert.match(profile, /network=\{enabled=false\}/);
});
