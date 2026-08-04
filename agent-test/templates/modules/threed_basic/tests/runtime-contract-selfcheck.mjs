import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleScene = await readFile(
  new URL('../src/GameScene.ts', import.meta.url),
  'utf8',
);
const moduleInput = await readFile(
  new URL('../src/InputController.ts', import.meta.url),
  'utf8',
);
const coreScene = await readFile(
  new URL('../../../core3d/src/GameScene.ts', import.meta.url),
  'utf8',
);
const coreMain = await readFile(
  new URL('../../../core3d/src/main.ts', import.meta.url),
  'utf8',
);

const movement = (yaw, forward, strafe) => ({
  x: -Math.sin(yaw) * forward + Math.cos(yaw) * strafe,
  z: -Math.cos(yaw) * forward - Math.sin(yaw) * strafe,
});
for (const yaw of [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
  const forward = movement(yaw, 1, 0);
  assert(Math.abs(forward.x + Math.sin(yaw)) < 1e-12);
  assert(Math.abs(forward.z + Math.cos(yaw)) < 1e-12);
}

assert.match(moduleScene, /x: \(-sin \* forward \+ cos \* strafe\)/);
assert.match(moduleScene, /z: \(-cos \* forward - sin \* strafe\)/);
assert.match(coreScene, /Math\.cos\(this\.yaw\) \* strafe - Math\.sin\(this\.yaw\) \* forward/);
assert.doesNotMatch(moduleScene, /\+ Math\.sin\(this\.yaw\) \* forward/);
assert.match(moduleInput, /dispose\(\): void/);
assert.match(moduleScene, /this\.input\.dispose\(\)/);
assert.match(moduleScene, /object\.geometry\.dispose\(\)/);
assert.match(moduleScene, /material\.dispose\(\)/);
assert.match(coreMain, /this\.game\?\.dispose\(\)/);
assert.match(coreScene, /this\.renderer\.dispose\(\)/);

console.log('threed_basic runtime contract self-check: PASS');
