import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

// Only Privy's fixed HTTPS endpoint may supply keys; never use a URL from a token.
export function createPrivyVerifier(appId: string, key?: JWTVerifyGetKey) {
  const keys =
    key ??
    createRemoteJWKSet(
      new URL(
        `https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`,
      ),
      { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000 },
    );
  return async (token: string): Promise<string> => {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ['ES256'],
      issuer: 'privy.io',
      audience: appId,
      requiredClaims: ['sub', 'iat', 'exp', 'sid'],
      maxTokenAge: '2h',
      clockTolerance: 5,
    });
    if (
      typeof payload.sub !== 'string' ||
      !/^did:privy:[A-Za-z0-9_-]{1,200}$/.test(payload.sub) ||
      typeof payload.sid !== 'string' ||
      !payload.sid ||
      payload.linked_accounts !== undefined
    )
      throw new Error('Invalid Privy access token');
    return payload.sub;
  };
}
