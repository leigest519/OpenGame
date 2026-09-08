export type XzPoint = { x: number; z: number };

export type FloorPatch = XzPoint & { radius: number };

export type StaticObstacle = XzPoint & { collisionRadius: number };

export type CollisionMap = {
  floorPatches: FloorPatch[];
  obstacles: StaticObstacle[];
};

const EPSILON = 1e-6;

function isPlayable(
  point: XzPoint,
  playerRadius: number,
  map: CollisionMap,
): boolean {
  // ponytail: linear scans fit the 8-16 authored object budget; add spatial
  // indexing only when measured level budgets grow beyond that ceiling.
  const onFloor = map.floorPatches.some(
    (patch) =>
      Math.hypot(point.x - patch.x, point.z - patch.z) + playerRadius <=
      patch.radius + EPSILON,
  );
  if (!onFloor) return false;

  return map.obstacles.every(
    (obstacle) =>
      Math.hypot(point.x - obstacle.x, point.z - obstacle.z) + EPSILON >=
      playerRadius + obstacle.collisionRadius,
  );
}

export function resolveMovement(
  position: XzPoint,
  movement: XzPoint,
  playerRadius: number,
  map: CollisionMap,
): XzPoint {
  const distance = Math.hypot(movement.x, movement.z);
  if (distance === 0) return { ...position };

  const stepCount = Math.max(
    1,
    Math.ceil(distance / Math.max(0.05, playerRadius * 0.5)),
  );
  const step = { x: movement.x / stepCount, z: movement.z / stepCount };
  let current = { ...position };

  for (let index = 0; index < stepCount; index++) {
    const candidates = [
      { x: current.x + step.x, z: current.z + step.z },
      { x: current.x + step.x, z: current.z },
      { x: current.x, z: current.z + step.z },
    ];
    current =
      candidates.find((candidate) =>
        isPlayable(candidate, playerRadius, map),
      ) ?? current;
  }

  return current;
}
