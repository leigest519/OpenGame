import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Job } from '../src/shared/types';

test('version commits exclude protected checkpoints even when a generated ignore file is removed', async () => {
  const data = await mkdtemp(path.join(tmpdir(), 'production-version-'));
  process.env.OPENGAME_DATA_DIR = data;
  process.env.OPENGAME_WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
  const { prepareWorkspace, commitWorkspace } =
    await import('../src/server/workspace');
  const { run } = await import('../src/server/process');
  const job = {
    id: randomUUID(),
    project_id: randomUUID(),
    attempt: 1,
    base_version_id: null,
    prompt: '验证版本保存',
  } as Job;
  try {
    const workspace = await prepareWorkspace(job);
    await writeFile(path.join(workspace, '.gitignore'), '');
    await writeFile(
      path.join(workspace, '.opengame-context/checkpoint.txt'),
      'private intermediate artifact',
    );
    await writeFile(
      path.join(workspace, 'production-report.json'),
      '{"version":1}',
    );
    // Also cover a previously staged/tracked context, not only an untracked directory.
    await run('git', ['add', '--force', '.opengame-context'], workspace);
    const commit = await commitWorkspace(job, workspace);
    const files = (
      await run('git', ['ls-tree', '-r', '--name-only', commit], workspace)
    ).split('\n');
    assert.ok(files.includes('production-report.json'));
    assert.ok(files.includes('src/main.ts'));
    assert.ok(!files.some((file) => file.startsWith('.opengame-context/')));
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
