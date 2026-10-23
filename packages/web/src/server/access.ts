import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { accessMode, appOrigin, previewOrigin, previewSecret } from './config';
import type pg from 'pg';
import { migrate, pool, transaction } from './db';
import { StudioError } from './errors';

const cookieName = appOrigin.startsWith('https:')
  ? '__Host-opengame_session'
  : 'opengame_session';
const sessionSeconds = 7 * 24 * 60 * 60;
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export interface Viewer {
  id: string;
  label: string;
  sessionHash: string;
  expiresAt: string;
}
export function sessionCookie(token: string, seconds = sessionSeconds): string {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${appOrigin.startsWith('https:') ? '; Secure' : ''}`;
}
function tokenFromRequest(request: Request): string {
  const matches = (request.headers.get('cookie') || '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${cookieName}=`));
  if (matches.length !== 1) return '';
  const token = matches[0].slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
}
export async function sessionViewer(request: Request): Promise<Viewer | null> {
  if (accessMode === 'local') return null;
  const token = tokenFromRequest(request);
  if (!token) return null;
  await migrate();
  const result = await pool().query(
    `SELECT u.id,u.label,s.token_hash AS "sessionHash",s.expires_at AS "expiresAt"
     FROM studio_sessions s JOIN studio_users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled AND u.expires_at>now()`,
    [hashToken(token)],
  );
  return result.rows[0] || null;
}
export async function requireViewer(request: Request): Promise<Viewer | null> {
  const viewer = await sessionViewer(request);
  if (accessMode === 'invite' && !viewer)
    throw new StudioError('请先登录工作台。', 401);
  return viewer;
}
export async function login(code: string): Promise<string> {
  if (accessMode !== 'invite') throw new StudioError('本机模式不需要登录。');
  await migrate();
  await limitLoginAttempts();
  return transaction(async (client) => {
    const result = await client.query(
      'SELECT id,invited_by,invitation_rewarded_at FROM studio_users WHERE access_hash=$1 AND NOT disabled AND expires_at>now() FOR UPDATE',
      [hashToken(code)],
    );
    if (!result.rows[0])
      throw new StudioError('访问码无效或已到期，请联系邀请人。', 401);
    const user = result.rows[0];
    const userId = user.id;
    // The invitee row lock makes the first-login award exactly once, even on retries.
    if (user.invited_by && !user.invitation_rewarded_at) {
      await client.query(
        'UPDATE studio_users SET bonus_job_credits=bonus_job_credits+5 WHERE id=$1',
        [user.invited_by],
      );
      await client.query(
        'UPDATE studio_users SET invitation_rewarded_at=now() WHERE id=$1',
        [userId],
      );
    }
    await client.query(
      'DELETE FROM studio_sessions WHERE user_id=$1 AND expires_at<=now()',
      [userId],
    );
    return issueSession(client, userId);
  });
}

export async function limitLoginAttempts(): Promise<void> {
  await migrate();
  // Persist the global login budget across restarts and all web processes.
  const bucket = Math.floor(Date.now() / 60000);
  const rate = await pool().query(
    'INSERT INTO studio_login_limits(bucket,attempts) VALUES($1,1) ON CONFLICT(bucket) DO UPDATE SET attempts=studio_login_limits.attempts+1 RETURNING attempts',
    [bucket],
  );
  if (rate.rows[0].attempts > 120)
    throw new StudioError('登录尝试较多，请稍后再试。', 429);
  await pool().query('DELETE FROM studio_login_limits WHERE bucket<$1', [
    bucket - 60,
  ]);
}
export async function issueSession(
  client: pg.PoolClient,
  userId: string,
): Promise<string> {
  // Serialize the device cap across concurrent logins for this account.
  await client.query('SELECT id FROM studio_users WHERE id=$1 FOR UPDATE', [
    userId,
  ]);
  // Retain at most five devices per member; the newest login takes a slot.
  await client.query(
    'DELETE FROM studio_sessions WHERE token_hash IN (SELECT token_hash FROM studio_sessions WHERE user_id=$1 ORDER BY created_at DESC OFFSET 4)',
    [userId],
  );
  const token = randomBytes(32).toString('base64url');
  await client.query(
    "INSERT INTO studio_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [hashToken(token), userId],
  );
  return token;
}
export async function logout(request: Request): Promise<void> {
  const token = tokenFromRequest(request);
  if (token)
    await pool().query('DELETE FROM studio_sessions WHERE token_hash=$1', [
      hashToken(token),
    ]);
}
export async function createInvitation(label: string, days = 30) {
  if (
    !label.trim() ||
    label.length > 80 ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 365
  )
    throw new StudioError('邀请名称或有效期不正确。');
  const code = `og_${randomBytes(32).toString('base64url')}`;
  const id = randomUUID();
  await migrate();
  await pool().query(
    "INSERT INTO studio_users(id,label,access_hash,expires_at) VALUES($1,$2,$3,now()+$4*interval '1 day')",
    [id, label.trim(), hashToken(code), days],
  );
  return { id, code };
}
function signature(versionId: string, scope: string, sessionHash: string) {
  return createHmac('sha256', previewSecret())
    .update(`${versionId}:${scope}:${sessionHash}`)
    .digest('base64url');
}
export function gameUrl(
  versionId: string,
  viewer: Viewer | null,
  scope: 'private' | 'released' = 'private',
): string {
  if (accessMode === 'local')
    return `${previewOrigin}/v/${versionId}/index.html`;
  if (!viewer) throw new StudioError('请先登录。', 401);
  const ticket = `${scope}.${viewer.sessionHash}.${signature(versionId, scope, viewer.sessionHash)}`;
  return `${previewOrigin}/v/${versionId}/${ticket}/index.html`;
}
export async function authorizedArtifact(
  versionId: string,
  ticket?: string,
): Promise<string | null> {
  await migrate();
  if (accessMode === 'local') {
    return (
      (
        await pool().query(
          'SELECT artifact_key FROM studio_versions WHERE id=$1',
          [versionId],
        )
      ).rows[0]?.artifact_key || null
    );
  }
  const parts =
    /^(private|released)\.([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(
      ticket || '',
    );
  if (!parts) return null;
  const [, scope, sessionHash, supplied] = parts;
  if (
    !timingSafeEqual(
      Buffer.from(supplied),
      Buffer.from(signature(versionId, scope, sessionHash)),
    )
  )
    return null;
  const result = await pool().query(
    `SELECT v.artifact_key FROM studio_versions v JOIN studio_projects p ON p.id=v.project_id
     JOIN studio_sessions s ON s.token_hash=$2 JOIN studio_users u ON u.id=s.user_id
     WHERE v.id=$1 AND s.expires_at>now() AND NOT u.disabled AND u.expires_at>now()
       AND (($3='private' AND p.owner_id=u.id) OR ($3='released' AND p.released_version_id=v.id))`,
    [versionId, sessionHash, scope],
  );
  return result.rows[0]?.artifact_key || null;
}
