# threed_basic Template API

## Scaffolded files

| File | Contract |
|---|---|
| `src/main.ts` | boots title, runtime, DOM HUD, pause, completion, render loop |
| `src/GameScene.ts` | owns renderer, scene, camera, world, manual pickup checks |
| `src/CollisionResolver.ts` | pure XZ road/obstacle movement resolution with substeps |
| `src/InputController.ts` | keyboard + mouse state only |
| `src/SceneMap.ts` | Editor-facing declarative positions via `initSceneMap()` |
| `src/ThreeSceneDefaults.ts` | shared light, fog, and background defaults |
| `src/gameConfig.json` | wrapped `{ value, type, description }` tuning fields |

## `GameScene` constructor

```ts
new GameScene(container, {
  onProgress(collected, total) {},
  onComplete() {},
  onGameOver() {},
}, preloader.textures);
```

Required public methods:

| Method | Meaning |
|---|---|
| `update(deltaSeconds)` | advance input, collection, animation, and render |
| `setPaused(boolean)` | stop/resume simulation and clear held input |
| `isPaused()` | smoke/lifecycle observable pause state |
| `dispose()` | unbind input and release scene-owned geometry, material, renderer, and canvas resources before instance replacement |
| `resize()` | update camera aspect and renderer size |

`GameScene.dispose()` owns input listeners, geometry, materials, renderer state,
and its canvas. `Preloader` owns the shared texture map, so scene replacement
must not dispose those textures before the next scene reuses them.

## Smoke bridge

`window.__opengame3d` is an exact, read-only probe surface:

```ts
{ isPaused: () => boolean; renderer: 'three.js' }
```

Do not add `teleport`, time setters, collectible setters, mutable `state`, or
other gameplay shortcuts. Build, pause, completion, failure, and restart must
be verified through keyboard/mouse events and the visible DOM. Test time limits
with browser clock control or a pure unit check, not a shipped runtime setter.

## SceneMap

`initSceneMap()` returns `playerSpawn`, `floorPatches`, `collectibles`, and `obstacles`.
Change positions there instead of hard-coding level coordinates inside the
render loop. Add new declarative arrays at the `// EXT` point only when a real
consumer is implemented.

Each obstacle declares `collisionRadius` independently from visual `scale`.
`resolveMovement()` keeps the full player circle inside at least one floor
patch, subdivides long moves to prevent tunnelling, and slides along an
unblocked axis. Dynamic bodies, impulses, and gravity remain v2 concerns.

## Config ownership

The shipped config is a starting contract, not a compatibility registry. Keep
one leaf per runtime value and require a literal consumer for every leaf. When
renaming or regrouping a field, update its consumer and delete the old field in
the same change. Do not preserve unused 2D infrastructure fields in a 3D game.

Before build, search every config leaf outside `gameConfig.json`. A leaf with no
consumer is a failed implementation check, not a harmless preset.

## Texture keys

`Preloader` reads Phaser-compatible `asset-pack.json` sections and loads image
entries into `Map<string, THREE.Texture>`. The reference module recognizes:

| Key | Fallback |
|---|---|
| `skybox_texture` | dark blue `Color` background |
| `floor_patch` | rough blue material |
| `energy_billboard` | emissive sphere primitive |

Missing optional textures must not throw or block the game.

## Pause data contract

Both `UIScene.init()` and `PauseUIScene.init()` accept:

```ts
{ gameSceneKey?: string; currentLevelKey?: string }
```

Resolve in this exact order:

```ts
data.gameSceneKey ?? data.currentLevelKey ?? LevelManager.getFirstLevelScene()
```
