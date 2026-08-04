# threed_basic Design Rules

## 1. Product shape

Build one short, finishable 3D route: the player moves through a single world,
collects every required item, and reaches one completion state. Use three.js,
simple geometry, lights, fog, a sky texture, and DOM overlays.

Do not add physics, touch controls, multiplayer, imported 3D models, or any
text-to-3D service. 2D Phaser templates are unrelated and must remain unchanged.

Explicit prompt mechanics are binding. Never reinterpret ordered or sequential
objectives as unordered collection to match the scaffold. Keep the existing
public API and implement the requested rule with the smallest private state in
`GameScene`, such as one next-objective index over the authored `SceneMap` order.

## 2. Required runtime contract

| Area | Required |
|---|---|
| Renderer | `WebGLRenderer`, `PerspectiveCamera`, resize handling, visible non-black frame |
| World | primitives or custom low-poly geometry, ambient + directional light, fog |
| Collision | player circle stays on an authored floor patch and outside static obstacle circles |
| Input | WASD and arrow keys; mouse drag/look; ESC pause |
| HUD | DOM in `#ui-root`; canvas stays dedicated to three.js |
| Pause | resolve `gameSceneKey ?? currentLevelKey ?? LevelManager.getFirstLevelScene()` |
| Win | one explicit, reachable completion condition |

## 3. Asset registry rules

3D assets are still ordinary images produced by `generate_game_assets`.

| Key role | Tool type | Max/source rule | three.js use |
|---|---|---|---|
| `skybox_texture` | `background` | `1024*1024`; `displaySize: 1024*1024` in GDD | equirectangular scene background |
| `floor_patch` | `image` | generated image; declare display size <= `1024*1024` | `CircleGeometry` material map |
| `energy_billboard` | `image` | one centered subject, transparent removal allowed | `SpriteMaterial` |
| surface texture | `image` | <= `1024*1024`; no glossy colormap | `MeshStandardMaterial.map` |

Never request a model, mesh, GLB, FBX, normal map, or text-to-3D output. Do not
use `colormap` for glossy, translucent, emissive, or sky assets.

## 4. Level and camera budget

Use 8-14 floor patches, 5-10 collectibles, and 8-16 low-poly decorations.
Keep the camera far plane under 250 and cap device pixel ratio at 2. Manual
distance checks are enough for pickups and static collision; do not introduce a
physics dependency. Give every obstacle an explicit `collisionRadius` instead
of deriving gameplay collision from rendered scale.

Every `gameConfig.json` leaf must have one literal runtime consumer. Do not keep
aliases for the same value: if pickup code moves from
`levelConfig.collectRadius` to another path, delete the old leaf in the same
edit. The current linear fog consumes `renderConfig.fogNear` and `fogFar`; do
not add `fogDensity` unless the implementation changes and the superseded
linear-fog leaves are removed. Derive authored counts from `SceneMap` arrays
unless a separately consumed completion threshold is required.

## 5. GDD completion notes

The GDD must end with:

- the actual generated keys and their runtime consumers;
- a config leaf-to-consumer table with no duplicate or unconsumed leaf;
- any placeholder/fallback used;
- `3D scope: primitives + generated image textures; no model generation`;
- the command evidence from build and smoke.
