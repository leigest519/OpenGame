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
const manual = await readFile(
  new URL('../../../../docs/modules/threed_basic/threed_basic.md', import.meta.url),
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
assert.match(coreScene, /-Math\.sin\(this\.yaw\) \* strafe - Math\.cos\(this\.yaw\) \* forward/);
assert.doesNotMatch(moduleScene, /\+ Math\.sin\(this\.yaw\) \* forward/);
assert.match(moduleInput, /dispose\(\): void/);
assert.match(moduleScene, /this\.input\.dispose\(\)/);
assert.match(moduleScene, /object\.geometry\.dispose\(\)/);
assert.match(moduleScene, /material\.dispose\(\)/);
assert.match(coreMain, /this\.game\?\.dispose\(\)/);
assert.match(
  coreMain,
  /this\.ui\.show[\s\S]*this\.game = new GameScene/,
  'HUD must exist before GameScene emits its initial progress event',
);
assert.match(coreScene, /this\.renderer\.dispose\(\)/);
assert.match(manual, /protected runtime\s+contracts/);
assert.match(manual, /asset-pack\.json[\s\S]*relative URL/);
assert.match(manual, /Baseline evidence:[\s\S]*SHA-256[\s\S]*diff result/);
assert.match(manual, /generated edit that was reverted, not a[\s\S]*template defect/);
assert.match(manual, /intersection half-width[\s\S]*two player radii/);
assert.match(manual, /config leaf's `description`[\s\S]*final consumer/);

console.log('threed_basic runtime contract self-check: PASS');
