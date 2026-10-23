import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {
  dataRoot,
  databasePort,
  databaseUrl,
  localSettings,
} from '../src/server/config';

const directory = path.join(dataRoot, 'postgres');
const socket = path.join(dataRoot, 'pg-socket');
function command(name: string, args: string[]) {
  return execFileSync(name, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}
export async function localDatabase(action: 'start' | 'stop'): Promise<void> {
  if (process.env.OPENGAME_DATABASE_URL) return;
  if (action === 'stop') {
    if (existsSync(path.join(directory, 'postmaster.pid')))
      command('pg_ctl', ['-D', directory, '-m', 'fast', '-w', 'stop']);
    return;
  }
  const { password } = localSettings();
  mkdirSync(socket, { recursive: true, mode: 0o700 });
  if (!existsSync(path.join(directory, 'PG_VERSION'))) {
    const pwfile = path.join(dataRoot, 'init-password');
    writeFileSync(pwfile, password, { mode: 0o600 });
    try {
      command('initdb', [
        '-D',
        directory,
        '-U',
        'opengame',
        '--auth=scram-sha-256',
        '--pwfile',
        pwfile,
        '--encoding=UTF8',
        '--locale=C',
      ]);
    } finally {
      unlinkSync(pwfile);
    }
  }
  try {
    command('pg_ctl', ['-D', directory, 'status']);
  } catch {
    command('pg_ctl', [
      '-D',
      directory,
      '-l',
      path.join(dataRoot, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${databasePort} -k ${socket}`,
      '-w',
      'start',
    ]);
  }
  const url = new URL(databaseUrl());
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    if (
      !(
        await client.query("SELECT 1 FROM pg_database WHERE datname='opengame'")
      ).rowCount
    )
      await client.query('CREATE DATABASE opengame');
  } finally {
    await client.end();
  }
}
if (process.argv[1]?.endsWith('local-db.ts')) {
  await localDatabase(process.argv[2] === 'stop' ? 'stop' : 'start');
  console.log(
    process.argv[2] === 'stop'
      ? '本项目数据库已停止。'
      : '本项目数据库已就绪。',
  );
}
