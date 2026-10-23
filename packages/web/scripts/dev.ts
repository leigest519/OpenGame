import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { appPort, webRoot } from '../src/server/config';
import { localDatabase } from './local-db';
import { seed } from './seed';
import { pool } from '../src/server/db';

await localDatabase('start');
try {
  await seed();
} catch (error) {
  console.error(
    '参考作品初始化未完成，可以稍后运行 npm run seed。',
    error instanceof Error ? error.message : '',
  );
}
await pool().end();
const require = createRequire(import.meta.url);
const children: ChildProcess[] = [];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill('SIGTERM'));
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const args of [
  ['--import', 'tsx', path.join(webRoot, 'src/server/worker-main.ts')],
  ['--import', 'tsx', path.join(webRoot, 'src/server/preview-main.ts')],
  [
    require.resolve('next/dist/bin/next'),
    'dev',
    '--webpack',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(appPort),
  ],
]) {
  const child = spawn(process.execPath, args, {
    cwd: webRoot,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
    stop();
  });
  child.on('exit', (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      stop();
    }
  });
}
