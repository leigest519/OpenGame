import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  accessMode,
  appOrigin,
  previewOrigin,
  previewSecret,
  appPort,
  webRoot,
} from '../src/server/config';
import { migrate, pool } from '../src/server/db';
import { requireRuntimeImage } from '../src/server/project-runtime';
import { checkGeneratorSandbox } from '../src/server/generator-check';

if (accessMode !== 'invite')
  throw new Error('正式启动需要 OPENGAME_ACCESS_MODE=invite。');
if (!process.env.OPENGAME_DATABASE_URL)
  throw new Error('正式启动需要显式配置 OPENGAME_DATABASE_URL。');
if (!process.env.OPENGAME_APP_ORIGIN || !process.env.OPENGAME_PREVIEW_ORIGIN)
  throw new Error('正式启动需要工作台和游戏两个访问地址。');
previewSecret();
process.env.OPENGAME_NEXT_DIST_DIR ||= '.next-production';
if (
  !existsSync(
    path.join(webRoot, process.env.OPENGAME_NEXT_DIST_DIR, 'BUILD_ID'),
  )
)
  throw new Error('缺少正式构建，请先运行 build:production。');
await migrate();
await requireRuntimeImage();
await checkGeneratorSandbox();
await pool().end();

const require = createRequire(import.meta.url);
const children: ChildProcess[] = [];
let stopping = false;
let timer: NodeJS.Timeout | undefined;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  timer = setTimeout(() => {
    for (const child of children)
      if (child.exitCode === null) child.kill('SIGKILL');
  }, 8000);
  timer.unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const args of [
  ['--import', 'tsx', path.join(webRoot, 'src/server/worker-main.ts')],
  ['--import', 'tsx', path.join(webRoot, 'src/server/preview-main.ts')],
  [
    require.resolve('next/dist/bin/next'),
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(appPort),
  ],
]) {
  const child = spawn(process.execPath, args, {
    cwd: webRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
    },
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
    if (
      children.every(
        (child) => child.exitCode !== null || child.signalCode !== null,
      ) &&
      timer
    )
      clearTimeout(timer);
  });
}
console.log(`内测工作台：${appOrigin}\n游戏服务：${previewOrigin}`);
