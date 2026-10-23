import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertLocalRequest } from '../src/server/api';
import { appOrigin } from '../src/server/config';
import { buildGame } from '../src/server/build-game';

test('local API rejects foreign sites, sandboxed games, DNS rebinding, and form posts', () => {
  const headers = {
    host: new URL(appOrigin).host,
    origin: appOrigin,
    'content-type': 'application/json',
  };
  assert.doesNotThrow(() =>
    assertLocalRequest(
      new Request(`${appOrigin}/api/projects`, { method: 'POST', headers }),
    ),
  );
  for (const changed of [
    { origin: 'https://foreign.example' },
    { origin: 'null' },
    { host: 'foreign.example' },
    { 'content-type': 'text/plain' },
  ]) {
    assert.throws(() =>
      assertLocalRequest(
        new Request(`${appOrigin}/api/projects`, {
          method: 'POST',
          headers: { ...headers, ...changed },
        }),
      ),
    );
  }
});
test('game build rejects imports and symbolic links outside the project', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'opengame-build-test-'));
  const root = path.join(parent, 'project');
  await mkdir(path.join(root, 'src'), { recursive: true });
  for (const file of [
    'game.project.json',
    'gameConfig.json',
    'modules.lock.json',
    'assets.manifest.json',
  ])
    await writeFile(path.join(root, file), '{}');
  for (const file of ['design.md', 'memory.md'])
    await writeFile(path.join(root, file), 'Test');
  await writeFile(
    path.join(parent, 'secret.ts'),
    'export const secret = "private";',
  );
  try {
    await writeFile(
      path.join(root, 'src/main.ts'),
      'import {secret} from "../../secret"; console.log(secret);',
    );
    await assert.rejects(
      buildGame(root, path.join(parent, 'output')),
      /导入必须/,
    );
    await mkdir(path.join(root, '.opengame-context'));
    await symlink(
      path.join(parent, 'secret.ts'),
      path.join(root, '.opengame-context/linked.ts'),
    );
    await writeFile(
      path.join(root, 'src/main.ts'),
      'import {secret} from "../.opengame-context/linked"; console.log(secret);',
    );
    await assert.rejects(
      buildGame(root, path.join(parent, 'output')),
      /禁止读取/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
