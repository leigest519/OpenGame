import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dataRoot } from './config';
import { run } from './process';
import {
  generatorPermissionConfig,
  generatorProfile,
  deniedGeneratorDirectories,
  prepareGeneratorWorkspace,
} from './generator-policy';

export async function checkGeneratorSandbox(readOnly = false): Promise<void> {
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(path.join(dataRoot, 'sandbox-check-'));
  const work = path.join(dir, 'project');
  const temporary = await mkdtemp(path.join(tmpdir(), 'opengame-denied-'));
  try {
    await mkdir(work);
    await prepareGeneratorWorkspace(work);
    await writeFile(path.join(work, 'canvas', 'board.json'), '{}');
    await writeFile(
      path.join(work, 'assets/canvas', 'fixture.png'),
      'synthetic fixture',
    );
    for (const name of deniedGeneratorDirectories)
      await writeFile(
        path.join(work, name, 'private.txt'),
        'synthetic fixture',
      );
    await writeFile(path.join(dir, 'private.txt'), 'synthetic fixture');
    await writeFile(path.join(temporary, 'private.txt'), 'synthetic fixture');
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const script = `set -eu
${readOnly ? "if printf 'changed' > allowed.txt 2>/dev/null; then exit 36; fi" : 'printf \'ok\' > allowed.txt\ntest "$(cat allowed.txt)" = ok'}
test "$(cat canvas/board.json)" = '{}'
if printf 'changed' > canvas/board.json 2>/dev/null; then exit 34; fi
if printf 'changed' > assets/canvas/fixture.png 2>/dev/null; then exit 35; fi
if cat ../private.txt >/dev/null 2>&1; then exit 31; fi
if cat ${quote(path.join(temporary, 'private.txt'))} >/dev/null 2>&1; then exit 32; fi
${deniedGeneratorDirectories.map((name) => `if cat ${name}/private.txt >/dev/null 2>&1; then exit 33; fi`).join('\n')}
printf 'isolated'`;
    const result = await run(
      process.env.OPENGAME_CODEX_BIN || 'codex',
      [
        'sandbox',
        '-C',
        work,
        '--permission-profile',
        generatorProfile,
        '-c',
        readOnly
          ? generatorPermissionConfig.replace('"."="write"', '"."="read"')
          : generatorPermissionConfig,
        '--',
        '/bin/sh',
        '-c',
        script,
      ],
      work,
      { timeout: 15000 },
    );
    if (!result.endsWith('isolated')) throw new Error('隔离检查未完成。');
  } catch {
    throw new Error(
      '生成器文件隔离检查未通过。请安装支持权限配置的 Codex 并检查系统沙箱；不会退回宽松模式。',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(temporary, { recursive: true, force: true });
  }
}
