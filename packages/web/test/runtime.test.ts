import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { containerArguments } from '../src/server/project-runtime';
import { projectFiles } from '../src/server/project-files';

test('container configuration enforces an offline non-root project boundary', () => {
  const options = {
    name: 'test',
    input: '/tmp/project',
    image: 'image',
    projectId: '00000000-0000-4000-8000-000000000001',
    jobId: '00000000-0000-4000-8000-000000000002',
  };
  const args = containerArguments(options);
  const after = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(after('--network'), 'none');
  assert.equal(after('--user'), '1000:1000');
  assert.equal(after('--cap-drop'), 'ALL');
  assert.equal(after('--security-opt'), 'no-new-privileges');
  assert.equal(after('--memory'), '1g');
  assert.equal(after('--pids-limit'), '256');
  assert.ok(args.includes('--read-only'));
  assert.equal(args.filter((a) => a === '--mount').length, 1);
  assert.equal(
    after('--mount'),
    'type=bind,source=/tmp/project,target=/input,readonly',
  );
  assert.ok(!args.includes('--privileged') && !args.includes('--publish'));
  assert.throws(() =>
    containerArguments({ ...options, input: '/tmp/a,readonly=false' }),
  );
  assert.throws(() =>
    containerArguments({ ...options, projectId: '../other-project' }),
  );
});

test('runtime snapshot excludes Git and shared context and rejects project symlinks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opengame-snapshot-'));
  try {
    for (const name of ['.git', '.opengame-context', 'src'])
      await mkdir(path.join(dir, name));
    await writeFile(path.join(dir, '.git/config'), 'private git config');
    await writeFile(
      path.join(dir, '.opengame-context/source'),
      'shared context',
    );
    await writeFile(path.join(dir, 'src/main.ts'), 'export {}');
    assert.deepEqual(await projectFiles(dir), ['src/main.ts']);
    await symlink('/etc/passwd', path.join(dir, 'src/outside'));
    await assert.rejects(projectFiles(dir), /链接或特殊文件/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
