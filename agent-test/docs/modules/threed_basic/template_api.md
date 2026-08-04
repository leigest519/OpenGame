# threed_basic Template API

## Scaffolded files

| File | Contract |
|---|---|
| `src/main.ts` | boots title, runtime, DOM HUD, pause, completion, render loop |
| `src/GameScene.ts` | owns renderer, scene, camera, world, manual pickup checks |
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
| `resize()` | update camera aspect and renderer size |

## SceneMap

`initSceneMap()` returns `floorPatches`, `collectibles`, and `obstacles`.
Change positions there instead of hard-coding level coordinates inside the
render loop. Add new declarative arrays at the `// EXT` point only when a real
consumer is implemented.

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
