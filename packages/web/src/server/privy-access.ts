import { randomUUID } from 'node:crypto';
import { authProvider, privyAppId } from './config';
import { transaction } from './db';
import { issueSession, limitLoginAttempts, type Viewer } from './access';
import { StudioError } from './errors';
import { createPrivyVerifier } from './privy-token';

// A narrow verification seam lets integration tests use signed synthetic tokens.
export const privyAuth = { verify: createPrivyVerifier(privyAppId) };

export async function privySession(
  token: string,
  action: 'login' | 'link',
  viewer: Viewer | null,
) {
  if (authProvider !== 'privy')
    throw new StudioError('邮箱和 Google 登录尚未启用。', 503);
  if (action === 'link' && !viewer)
    throw new StudioError('请先用原访问码登录，再绑定账号。', 401);
  await limitLoginAttempts();
  let subject: string;
  try {
    subject = await privyAuth.verify(token);
  } catch {
    throw new StudioError('身份验证未完成或已过期，请重新登录。', 401);
  }
  return transaction(async (client) => {
    // Serialize first login and linking of the same provider identity across processes.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `privy:${privyAppId}:${subject}`,
    ]);
    const identity = (
      await client.query(
        "SELECT user_id FROM studio_identities WHERE provider='privy' AND app_id=$1 AND subject=$2",
        [privyAppId, subject],
      )
    ).rows[0];
    let userId: string;
    if (viewer) {
      // Recheck the session under the account lock; it may have been revoked while verifying.
      await client.query('SELECT id FROM studio_users WHERE id=$1 FOR UPDATE', [
        viewer.id,
      ]);
      const valid = await client.query(
        `SELECT u.id FROM studio_users u JOIN studio_sessions s ON s.user_id=u.id
         WHERE u.id=$1 AND s.token_hash=$2 AND s.expires_at>now() AND NOT u.disabled AND u.expires_at>now()`,
        [viewer.id, viewer.sessionHash],
      );
      if (!valid.rowCount)
        throw new StudioError('当前会话已过期，请重新登录。', 401);
      if (identity && identity.user_id !== viewer.id)
        throw new StudioError(
          '这个登录身份已属于另一个账号，请退出后登录；不会自动合并作品。',
          409,
        );
    }
    if (action === 'link') {
      userId = viewer!.id;
      const linked = await client.query(
        "SELECT subject FROM studio_identities WHERE provider='privy' AND app_id=$1 AND user_id=$2",
        [privyAppId, userId],
      );
      if (linked.rows[0] && linked.rows[0].subject !== subject)
        throw new StudioError('当前账号已经绑定其他登录身份。', 409);
      if (!identity)
        await client.query(
          "INSERT INTO studio_identities(provider,app_id,subject,user_id) VALUES('privy',$1,$2,$3)",
          [privyAppId, subject, userId],
        );
      // A used invitation must not remain a permanent alternative credential.
      await client.query(
        'UPDATE studio_users SET access_hash=NULL WHERE id=$1',
        [userId],
      );
      await client.query('DELETE FROM studio_sessions WHERE user_id=$1', [
        userId,
      ]);
    } else if (identity) {
      userId = identity.user_id;
    } else {
      if (viewer)
        throw new StudioError(
          '请使用“绑定邮箱 / Google”保留当前账号的作品。',
          409,
        );
      userId = randomUUID();
      // Registered accounts have no invitation expiry. Existing invited accounts keep theirs.
      await client.query(
        "INSERT INTO studio_users(id,label,expires_at) VALUES($1,$2,'infinity')",
        [userId, `创作者 ${userId.slice(0, 6)}`],
      );
      await client.query(
        "INSERT INTO studio_identities(provider,app_id,subject,user_id) VALUES('privy',$1,$2,$3)",
        [privyAppId, subject, userId],
      );
    }
    const active = await client.query(
      'SELECT id FROM studio_users WHERE id=$1 AND NOT disabled AND expires_at>now() FOR UPDATE',
      [userId],
    );
    if (!active.rowCount)
      throw new StudioError('账号已停用或访问资格已到期。', 403);
    return issueSession(client, userId);
  });
}
