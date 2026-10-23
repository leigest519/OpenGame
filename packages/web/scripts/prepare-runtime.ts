import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot, webRoot } from '../src/server/config';
import { runtimeImage } from '../src/server/project-runtime';

await mkdir(dataRoot, { recursive: true });
const context = await mkdtemp(path.join(dataRoot, 'runtime-image-'));
try {
  for (const file of [
    'Dockerfile',
    'package.json',
    'package-lock.json',
    'guardian.mjs',
  ])
    await cp(path.join(webRoot, 'runtime', file), path.join(context, file));
  await build({
    entryPoints: [path.join(webRoot, 'runtime/check.ts')],
    outfile: path.join(context, 'check.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', ['build', '--tag', runtimeImage, context], {
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error('独立环境镜像构建失败。')),
    );
  });
  console.log('项目独立环境已准备好。');
} finally {
  await rm(context, { recursive: true, force: true });
}
