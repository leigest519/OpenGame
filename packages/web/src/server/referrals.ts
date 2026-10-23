import { randomBytes, randomUUID } from 'node:crypto';
import { hashToken } from './access';
import { migrate, pool, transaction } from './db';
import { StudioError } from './errors';
import type { AccountQuota } from '../shared/quota';

const invitationLimit = 10;

export async function accountQuota(ownerId: string): Promise<AccountQuota> {
  await migrate();
  const { rows } = await pool().query(
    `SELECT u.daily_job_limit,u.total_job_limit,u.bonus_job_credits,u.paid_job_credits,
      (SELECT count(*)::int FROM studio_users WHERE invited_by=u.id) AS invited,
      (SELECT count(*)::int FROM studio_users WHERE invited_by=u.id AND invitation_rewarded_at IS NOT NULL) AS activated,
      count(j.id) FILTER (WHERE j.kind='build' AND j.image_asset_id IS NULL AND NOT j.uses_bonus AND NOT j.uses_paid)::int AS total,
      count(j.id) FILTER (WHERE j.kind='build' AND j.image_asset_id IS NULL AND NOT j.uses_bonus AND NOT j.uses_paid AND j.created_at>now()-interval '24 hours')::int AS daily,
      count(j.id) FILTER (WHERE j.uses_bonus)::int AS bonus_used,
      count(j.id) FILTER (WHERE j.uses_paid)::int AS paid_used
    FROM studio_users u LEFT JOIN studio_projects p ON p.owner_id=u.id
    LEFT JOIN studio_jobs j ON j.project_id=p.id
    WHERE u.id=$1 AND NOT u.disabled AND u.expires_at>now() GROUP BY u.id`,
    [ownerId],
  );
  const user = rows[0];
  if (!user) throw new StudioError('内测访问已到期，请重新登录。', 401);
  const dailyRemaining = Math.max(0, user.daily_job_limit - user.daily);
  const totalRemaining = Math.max(0, user.total_job_limit - user.total);
  const bonusRemaining = Math.max(0, user.bonus_job_credits - user.bonus_used);
  const paidRemaining = Math.max(0, user.paid_job_credits - user.paid_used);
  return {
    paidRemaining,
    available:
      Math.min(dailyRemaining, totalRemaining) + bonusRemaining + paidRemaining,
    dailyRemaining,
    totalRemaining,
    bonusRemaining,
    invited: user.invited,
    activated: user.activated,
    invitationLimit,
  };
}

export async function createReferral(ownerId: string, label: string) {
  return transaction(async (client) => {
    const owner = (
      await client.query(
        "SELECT LEAST(expires_at,now()+interval '30 days') AS expires_at FROM studio_users WHERE id=$1 AND NOT disabled AND expires_at>now() FOR UPDATE",
        [ownerId],
      )
    ).rows[0];
    if (!owner) throw new StudioError('请重新登录。', 401);
    const count = (
      await client.query(
        'SELECT count(*)::int AS n FROM studio_users WHERE invited_by=$1',
        [ownerId],
      )
    ).rows[0].n;
    if (count >= invitationLimit)
      throw new StudioError('本轮内测最多邀请 10 人，已达到邀请上限。', 429);
    const code = `og_${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(
      Math.min(
        new Date(owner.expires_at).getTime(),
        Date.now() + 30 * 86400000,
      ),
    ).toISOString();
    await client.query(
      'INSERT INTO studio_users(id,label,access_hash,expires_at,invited_by) VALUES($1,$2,$3,$4,$5)',
      [randomUUID(), label, hashToken(code), expiresAt, ownerId],
    );
    return { code, expiresAt };
  });
}
