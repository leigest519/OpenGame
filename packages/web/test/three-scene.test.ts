import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGame } from '../src/server/build-game';
const fixture = fileURLToPath(
  new URL('./fixtures/three-scene', import.meta.url),
);

test('Three.js scene and OrbitControls bundle offline through the production builder', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'three-build-'));
  try {
    await buildGame(fixture, temp);
    const js = await readFile(path.join(temp, 'game.js'), 'utf8');
    assert.match(js, /WebGLRenderer/);
    assert.match(js, /OrbitControls/);
    assert.ok(js.includes('restart-game'));
    assert.doesNotMatch(js, /from ["']three/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Three.js allowlist still rejects unsupported addons, packages and traversal', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'three-denied-'));
  const project = path.join(temp, 'project');
  try {
    await cp(fixture, project, { recursive: true });
    for (const dependency of [
      'three/addons/loaders/GLTFLoader.js',
      'three/../../package.json',
      'node:fs',
      'https://example.com/a.js',
    ]) {
      await writeFile(
        path.join(project, 'src/main.ts'),
        `import * as value from ${JSON.stringify(dependency)}; console.log(value);`,
      );
      await assert.rejects(
        buildGame(project, path.join(temp, 'output')),
        /不支持依赖/,
      );
    }
    await writeFile(
      path.join(project, 'src/main.ts'),
      "import Phaser from 'phaser'; console.log(Phaser.AUTO);",
    );
    await buildGame(project, path.join(temp, 'output'));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
