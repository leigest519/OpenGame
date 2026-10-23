import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createPrivyVerifier } from '../src/server/privy-token';

const pair = await generateKeyPair('ES256');
const jwk = {
  ...(await exportJWK(pair.publicKey)),
  kid: 'test-key',
  alg: 'ES256',
  use: 'sig',
};
const verify = createPrivyVerifier(
  'test-privy-app',
  createLocalJWKSet({ keys: [jwk] }),
);
async function token(
  overrides: Record<string, unknown> = {},
  key = pair.privateKey,
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: 'did:privy:alice',
    sid: 'session-1',
    iss: 'privy.io',
    aud: 'test-privy-app',
    iat: now,
    exp: now + 3600,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .sign(key);
}
test('accepts only signed access tokens for this Privy application', async () => {
  assert.equal(await verify(await token()), 'did:privy:alice');
  for (const invalid of [
    { aud: 'another-app' },
    { iss: 'attacker.example' },
    { exp: 1 },
    { sub: 'alice' },
    { sid: null },
    { exp: undefined },
    { iat: undefined },
    { iat: Math.floor(Date.now() / 1000) + 3600 },
    { linked_accounts: [] },
  ])
    await assert.rejects(verify(await token(invalid)));
  const attacker = await generateKeyPair('ES256');
  await assert.rejects(verify(await token({}, attacker.privateKey)));
  await assert.rejects(verify('not-a-jwt'));
});
