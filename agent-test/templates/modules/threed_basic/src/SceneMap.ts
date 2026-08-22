export type SceneMap = {
  playerSpawn: { x: number; z: number };
  floorPatches: Array<{ x: number; z: number; radius: number }>;
  collectibles: Array<{ id: string; x: number; y: number; z: number }>;
  obstacles: Array<{
    x: number;
    y: number;
    z: number;
    scale: number;
    collisionRadius: number;
  }>;
};

/** Editor-facing data initialization; keep positions declarative and code-free. */
export function initSceneMap(): SceneMap {
  return {
    playerSpawn: { x: 0, z: 6.5 },
    // EXT: append authored path patches without changing GameScene.
    floorPatches: Array.from({ length: 14 }, (_, i) => ({
      x: Math.sin(i * 0.8) * 2.2,
      z: 2 - i * 6,
      radius: 5.2,
    })),
    collectibles: Array.from({ length: 8 }, (_, i) => ({
      id: `energy-${i + 1}`,
      x: Math.sin(i * 1.4) * 3.5,
      y: 1.35,
      z: -5 - i * 9,
    })),
    obstacles: Array.from({ length: 12 }, (_, i) => ({
      x: Math.sin(i * 0.8) * 2.2 + (i % 2 ? 2.2 : -2.2),
      y: 1.2,
      z: -i * 6,
      scale: 0.7 + (i % 3) * 0.25,
      collisionRadius: 0.8 + (i % 3) * 0.2,
    })),
  };
}
