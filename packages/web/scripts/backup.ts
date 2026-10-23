import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { dataRoot, databaseUrl } from '../src/server/config';
import { migrate, pool } from '../src/server/db';
import { artifactHash } from '../src/server/build-game';
import { run } from '../src/server/process';

const destination = path.resolve(process.argv[2] || '');
let created = false;
try {
  if (
    !process.argv[2] ||
    destination === dataRoot ||
    destination.startsWith(`${dataRoot}${path.sep}`)
  )
    throw new Error('请指定数据目录以外、尚不存在的备份目录。');
  await migrate();
  const busy = await pool().query(
    "SELECT EXISTS(SELECT 1 FROM studio_worker_health WHERE heartbeat_at>now()-interval '15 seconds') OR EXISTS(SELECT 1 FROM studio_jobs WHERE status IN ('queued','running')) AS busy",
  );
  if (busy.rows[0].busy)
    throw new Error(
      '请先完成或取消制作任务，停止工作台服务，15 秒后再备份；数据库保持运行。',
    );
  await mkdir(destination, { mode: 0o700 });
  created = true;
  const db = new URL(databaseUrl());
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: db.hostname,
    PGPORT: db.port || '5432',
    PGUSER: decodeURIComponent(db.username),
    PGPASSWORD: decodeURIComponent(db.password),
    PGDATABASE: decodeURIComponent(db.pathname.slice(1)),
  };
  const parameters: Record<string, string> = {
    sslmode: 'PGSSLMODE',
    sslrootcert: 'PGSSLROOTCERT',
    sslcert: 'PGSSLCERT',
    sslkey: 'PGSSLKEY',
    connect_timeout: 'PGCONNECT_TIMEOUT',
    application_name: 'PGAPPNAME',
  };
  for (const [key, value] of db.searchParams) {
    if (!parameters[key])
      throw new Error(`备份暂不支持数据库连接参数 ${key}。`);
    env[parameters[key]] = value;
  }
  // Database credentials travel only in the child environment, never in argv/logs.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'pg_dump',
      [
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--file',
        path.join(destination, 'database.dump'),
      ],
      { env, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let failed = '';
    child.stderr.on('data', () => {
      failed = '数据库导出失败，请检查 pg_dump 版本和连接。';
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(failed || '数据库导出失败。')),
    );
  });
  for (const directory of ['projects', 'artifacts']) {
    if (existsSync(path.join(dataRoot, directory)))
      await cp(
        path.join(dataRoot, directory),
        path.join(destination, directory),
        { recursive: true },
      );
  }
  const versions = (
    await pool().query(
      'SELECT id,project_id,commit_sha,artifact_key,artifact_hash FROM studio_versions',
    )
  ).rows;
  for (const version of versions) {
    if (
      (await artifactHash(
        path.join(destination, 'artifacts', version.artifact_key),
      )) !== version.artifact_hash
    )
      throw new Error(`版本 ${version.id} 的备份产物校验失败。`);
    await run(
      'git',
      [
        '--git-dir',
        path.join(destination, 'projects', version.project_id, 'repo.git'),
        'cat-file',
        '-e',
        `${version.commit_sha}^{commit}`,
      ],
      destination,
    );
  }
  const sha256 = createHash('sha256')
    .update(await readFile(path.join(destination, 'database.dump')))
    .digest('hex');
  await writeFile(
    path.join(destination, 'manifest.json'),
    JSON.stringify(
      {
        format: 1,
        createdAt: new Date().toISOString(),
        databaseSha256: sha256,
        versions,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`备份完成，已校验 ${versions.length} 个版本：${destination}`);
} catch (error) {
  if (created) await rm(destination, { recursive: true, force: true });
  throw error;
} finally {
  await pool().end();
}
