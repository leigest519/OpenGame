# threed_basic Design Rules

## 1. Product shape

Build one short, finishable 3D experience around an explicit core loop. Use
three.js, simple geometry, lights, fog, a sky texture, and DOM overlays.
Collection is the reference scaffold fallback, not the archetype definition.

Before assets or level coordinates, declare a Core Gameplay Contract:

| Contract   | Required evidence                                                                           |
| ---------- | ------------------------------------------------------------------------------------------- |
| Verbs      | what the player repeatedly does through keyboard/mouse input                                |
| Loop       | one 20-60 second action-feedback-decision cycle that repeats at least twice                 |
| Demand     | one meaningful choice, timing, navigation, observation, or resource tradeoff                |
| Pressure   | an observable fail condition plus recovery, or an explicit no-fail tension/progression rule |
| Feedback   | visible DOM/world response for progress, danger, success, and failure                       |
| Escalation | at least three authored beats that intensify the same loop                                  |
| Outcome    | exact reachable win and lose conditions                                                     |

Immediately follow the contract with a Gameplay Feasibility Ledger. This is a
small arithmetic table, not a new runtime framework:

| Evidence       | Required                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Loop signature | cue -> player action -> decision -> state change -> feedback -> repeat                                                                  |
| Winning trace  | each required transition, its deadline, derived action/travel time, resource delta, and resulting state through the exact win condition |
| Losing trace   | one missed/low-priority/counterfactual decision whose same rules reach the declared failure or recovery response                        |
| Closure        | handled events equal the authored event count; terminal health/time/progress satisfies the exact outcome predicate                      |

Derive travel time from final authored distance and movement speed, and derive
state deltas from the final damage, recovery, timer, and threshold consumers.
If the ledger does not close, tune the authored data before calling the design
playable. Recompute it after every Phase 6 tuning edit; do not leave aggregate
counts that disagree with the final playthrough.

Do not reskin move-and-collect when the prompt asks for avoidance, timing,
switching, delivery, pursuit, defense, or another mechanic. Every private state
field and declarative SceneMap array in the contract must name its final runtime
consumer; do not invent a generic gameplay framework.

When the prompt explicitly requests peaceful or no-fail play, preserve that
semantics: state that there is no lose condition and specify how tension,
recovery, and progression still make the loop legible. Never add game over just
to fill the contract table.

Do not add physics, touch controls, multiplayer, imported 3D models, or any
text-to-3D service. 2D Phaser templates are unrelated and must remain unchanged.

Explicit prompt mechanics are binding. Never reinterpret ordered or sequential
objectives as unordered collection to match the scaffold. Keep the existing
public API and implement the requested rule with the smallest private state in
`GameScene`, such as one next-objective index over the authored `SceneMap` order.

## 2. Required runtime contract

| Area      | Required                                                                           |
| --------- | ---------------------------------------------------------------------------------- |
| Renderer  | `WebGLRenderer`, `PerspectiveCamera`, resize handling, visible non-black frame     |
| World     | primitives or custom low-poly geometry, ambient + directional light, fog           |
| Collision | player circle stays on an authored floor patch and outside static obstacle circles |
| Input     | WASD and arrow keys; mouse drag/look; ESC pause                                    |
| HUD       | DOM in `#ui-root`; canvas stays dedicated to three.js                              |
| Pause     | resolve `gameSceneKey ?? currentLevelKey ?? LevelManager.getFirstLevelScene()`     |
| Win       | one explicit, reachable completion condition                                       |

## 3. Asset registry rules

3D assets are still ordinary images produced by `generate_game_assets`.

| Key role            | Tool type    | Max/source rule                                                 | three.js use                     |
| ------------------- | ------------ | --------------------------------------------------------------- | -------------------------------- |
| `skybox_texture`    | `background` | `1024*1024`; `displaySize: 1024*1024` in GDD                    | equirectangular scene background |
| `floor_patch`       | `image`      | generated image; declare display size <= `1024*1024`            | `CircleGeometry` material map    |
| objective billboard | `image`      | semantic key, one centered subject, transparent removal allowed | `SpriteMaterial`                 |
| surface texture     | `image`      | <= `1024*1024`; no glossy colormap                              | `MeshStandardMaterial.map`       |

Never request a model, mesh, GLB, FBX, normal map, or text-to-3D output. Do not
use `colormap` for glossy, translucent, emissive, or sky assets.
Keep every image, audio file, and screenshot as a separate file inside the game
workspace. Reference runtime assets through `asset-pack.json` and relative paths;
never inline real media as Base64 or a Data URL in source, config, HTML, or GDD.

## 4. Level and camera budget

Use 8-14 floor patches and 8-16 low-poly decorations. Add only the objective,
hazard, switch, gate, patrol, trigger, or collectible entries consumed by the
chosen loop; do not keep the scaffold collectible budget when collection is not
the mechanic.
Keep the camera far plane under 250 and cap device pixel ratio at 2. Manual
distance checks are enough for pickups and static collision; do not introduce a
physics dependency. Give every obstacle an explicit `collisionRadius` instead
of deriving gameplay collision from rendered scale.

Mathematical overlap is not a playable lane. Shrink every floor patch by the
player collision radius, then require each authored neighbor pair to keep an
intersection half-width of at least two player radii. The spawn, every required
pickup center, and the finish trigger center must themselves be playable after
that shrink and must sit outside every expanded obstacle circle. Do not place a
finish center inside a lighthouse or other blocker and rely on the trigger
radius reaching a thin boundary crescent.

For a branched route, list intended neighbor pairs and forbidden cross-lane
transitions after the same shrink. A claimed committed choice is false if the
final floor union still lets the player switch lanes. The final uninstrumented
play check must finish every branch and attempt each claimed blocked switch;
testing only one branch does not prove a meaningful route decision.

Every `gameConfig.json` leaf must have one literal runtime consumer. Do not keep
aliases for the same value: if pickup code moves from
`levelConfig.collectRadius` to another path, delete the old leaf in the same
edit. The current linear fog consumes `renderConfig.fogNear` and `fogFar`; do
not add `fogDensity` unless the implementation changes and the superseded
linear-fog leaves are removed. Derive authored counts from `SceneMap` arrays
unless a separately consumed completion threshold is required.
Camera near/far values are source literals unless the final camera constructor
or update path reads an exact named config leaf. Fog distance and DPR fields do
not make a camera far plane config-backed.

## 5. GDD completion notes

The GDD must end with:

- the actual generated keys and their runtime consumers;
- a config leaf-to-consumer table with no duplicate or unconsumed leaf;
- any placeholder/fallback used;
- `3D scope: primitives + generated image textures; no model generation`;
- the command evidence from build and smoke.
- the final feasibility ledger totals and observed win/lose terminal states.

After Phase 6 changes, reconcile the GDD body itself against the final
`SceneMap`, config, asset-pack, and uninstrumented playthrough. Correct stale
numbers and consumers in place; an appendix may explain why a value changed,
but must not leave an older contradictory value as a second truth.

Treat each `gameConfig.json` description as part of that final truth. If a
consumer changes from a config leaf to a literal or another leaf, correct the
description and every GDD consumer table instead of leaving the old consumer
claim behind.

Implementation details need source anchors, not memory. Before keeping an
internal variable name, numeric mesh position, or texture behavior such as UV
repeat in the GDD, copy it from the final runtime source and verify that exact
consumer still exists. Otherwise state only the stable player-visible behavior;
delete invented implementation detail instead of preserving a plausible claim.

## 6. Verification integrity

Acceptance must test the declared win condition without strengthening or
replacing it. Optional collectibles, checkpoints, and side objectives cannot
become pass gates unless the prompt explicitly makes them required.

A complete-playthrough PASS must run against the final uninstrumented artifact.
Read-only diagnostic probes may explain a failure, but they cannot be required
for the final PASS. Save screenshots as files and report their paths; use the
official smoke pixel/WebGL assertions instead of reading screenshots back into
the generation session.
