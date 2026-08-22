import { resolveMovement, type CollisionMap } from '../src/CollisionResolver.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const openFloor: CollisionMap = {
  floorPatches: [{ x: 0, z: 0, radius: 5 }],
  obstacles: [],
};
const roadEdge = resolveMovement(
  { x: 0, z: 0 },
  { x: 20, z: 0 },
  0.5,
  openFloor,
);
assert(roadEdge.x <= 4.5 + 1e-6, 'player escaped the authored floor');

const blockedFloor: CollisionMap = {
  ...openFloor,
  obstacles: [{ x: 0, z: 0, collisionRadius: 0.75 }],
};
const blocked = resolveMovement(
  { x: -3, z: 0 },
  { x: 6, z: 0 },
  0.5,
  blockedFloor,
);
assert(blocked.x < -1.2, 'high-delta movement tunneled through an obstacle');

const sliding = resolveMovement(
  { x: -2, z: -1.5 },
  { x: 2, z: 1 },
  0.5,
  blockedFloor,
);
assert(sliding.z > -1.5, 'unblocked axis did not slide along the obstacle');

console.log('threed_basic collision self-check: PASS');
