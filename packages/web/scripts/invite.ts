import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInvitation } from '../src/server/access';
import { dataRoot } from '../src/server/config';
import { migrate, pool, transaction } from '../src/server/db';

const [command, value, extra] = process.argv.slice(2);
try {
  await migrate();
  if (command === 'create' && value) {
    const invitation = await createInvitation(
      value,
      extra ? Number(extra) : 30,
    );
    const dir = path.join(dataRoot, 'invitations');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${invitation.id}.txt`);
    try {
      await writeFile(
        file,
        `${value}\n内测访问码：${invitation.code}\n这是个人登录凭据，请勿公开。\n`,
        { mode: 0o600, flag: 'wx' },
      );
    } catch (error) {
      await pool().query('DELETE FROM studio_users WHERE id=$1', [
        invitation.id,
      ]);
      throw error;
    }
    console.log(`已创建成员 ${invitation.id}。访问码仅保存到 ${file}`);
  } else if (command === 'list') {
    console.table(
      (
        await pool().query(
          'SELECT id,label,disabled,expires_at,daily_job_limit,total_job_limit,project_limit FROM studio_users ORDER BY created_at',
        )
      ).rows,
    );
  } else if (command === 'disable' && /^[a-f0-9-]{36}$/.test(value || '')) {
    await transaction(async (client) => {
      const result = await client.query(
        'UPDATE studio_users SET disabled=true WHERE id=$1 RETURNING id',
        [value],
      );
      if (!result.rowCount) throw new Error('找不到该成员。');
      await client.query('DELETE FROM studio_sessions WHERE user_id=$1', [
        value,
      ]);
      await client.query(
        "UPDATE studio_jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE project_id IN (SELECT id FROM studio_projects WHERE owner_id=$1) AND status IN ('queued','running')",
        [value],
      );
    });
    console.log('成员已停用，登录和试玩凭据已失效，制作任务已请求停止。');
  } else if (command === 'claim-local' && /^[a-f0-9-]{36}$/.test(value || '')) {
    await transaction(async (client) => {
      if (
        !(
          await client.query(
            'SELECT id FROM studio_users WHERE id=$1 AND NOT disabled AND expires_at>now() FOR UPDATE',
            [value],
          )
        ).rowCount
      )
        throw new Error('找不到有效成员。');
      const result = await client.query(
        'UPDATE studio_projects SET owner_id=$1 WHERE owner_id IS NULL RETURNING id',
        [value],
      );
      console.log(`已将 ${result.rowCount} 个本地项目归属给该成员。`);
    });
  } else
    throw new Error(
      '用法：invite create <成员名> [有效天数] | list | disable <成员ID> | claim-local <成员ID>',
    );
} finally {
  await pool().end();
}
