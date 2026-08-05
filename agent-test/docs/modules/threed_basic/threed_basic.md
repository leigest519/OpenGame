# threed_basic Implementation Manual

Read this file and every scaffolded `src/` file before editing the generated
game. Keep the reference lifecycle intact; customize data, materials, text,
and the one level rather than replacing the shell.

The scaffolded camera-relative movement block, `InputController.dispose()`,
`GameScene.dispose()`, and the `main.ts` restart call are protected runtime
contracts. Keep them verbatim while customizing a v1 game; edit `SceneMap`,
config, materials, text, and win logic around them.

## Phase 5 implementation order

| Order | Action                                                                    | Done when                                                                                         |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1     | map each semantic GDD asset key to its final texture consumer             | every used key exists in `asset-pack.json`; scaffold fallback keys are not mandatory              |
| 2     | edit `SceneMap.ts`                                                        | the chosen loop's targets and win/lose positions are reachable; collision leaves a traversable lane |
| 3     | merge tuning into `gameConfig.json`                                       | every leaf has one runtime consumer; superseded aliases are deleted                               |
| 4     | theme materials and DOM text                                              | canvas remains WebGL-only; HUD remains DOM-only                                                   |
| 5     | run build and smoke                                                       | zero errors, non-black canvas, WebGL context, ESC resume; smoke bridge remains read-only          |
| 6     | reconcile `GAME_DESIGN.md` after the final uninstrumented playthrough     | the GDD body, config, asset-pack, SceneMap, and observed win condition state one consistent truth |

Do not attribute a defect or fix to the scaffold, template, or frozen baseline
from memory. Compare the final file with the exact scaffold source first. Any
such GDD claim must include `Baseline evidence:` with the canonical source
path, its SHA-256, and the relevant diff result. If the protected block already
matches, describe the incident as a generated edit that was reverted, not a
template defect.

Before declaring reconciliation complete, search every backticked tuning name
in the final source/config and compare every player/camera spawn yaw claim with
the final `SceneMap.playerSpawn.yaw`. Remove stale aliases and old spawn values
from the GDD body; a completion note saying they were fixed is not evidence.

Replace roadmap instructions such as "keep renderConfig untouched" with the
final values and consumers after any tuning edit. Describe a camera far plane
or renderer setting as config-backed only when its final runtime consumer reads
that named leaf; a nearby fog or DPR field is not evidence for camera config.

## Runtime lifecycle

```text
Preloader.load -> TitleScreen.show -> GameScene constructor
  -> applyThreeSceneDefaults -> initSceneMap -> HUD.show
  -> requestAnimationFrame -> GameScene.update -> resolveMovement -> renderer.render
  -> declared gameplay loop reaches its win state -> onComplete -> GameCompleteUIScene
```

`deltaSeconds` is capped by `main.ts`; all movement must multiply by it.
`setPaused(true)` must clear input so a key held before pause cannot continue
moving after resume.

When replacing a `GameScene` instance, call `dispose()` before constructing the
next one. It unbinds input and releases scene-owned geometry, materials,
renderer state, and canvas; shared Preloader textures remain owned by the app.

Keep `CollisionResolver.ts` pure. Floor patches and obstacle circles come from
`SceneMap.ts`; player radius comes from `gameConfig.json`. Do not replace this
with a physics dependency in v1.

Before the final playthrough, validate the authored route with the same player
radius: shrink adjacent floor patches by that radius and require their
intersection half-width to be at least two player radii. The spawn, required
pickup centers, and finish center must be playable points outside expanded
obstacle circles. A trigger radius overlapping a playable boundary does not
make a finish center embedded in solid collision acceptable.

Treat config as executable data. Keep the existing path when it already serves
the intended value; if a generated design chooses a new path, update the code
and remove the old path together. Never add `fogDensity`, a second pickup
radius, or a duplicate collectible count while their existing equivalents stay
in the file. Record the final leaf-to-consumer mapping in GDD completion notes,
and reconcile each config leaf's `description` against the same final consumer.

## Asset hookup

Only call `generate_game_assets`. A skybox is a generated 2D equirectangular
image, floor art is a generated 2D patch/texture, and interactive world art is
a generated billboard sprite with a semantic key. Do not call shell image
tools or any 3D model API.
Keep returned media as workspace files and consume the `asset-pack.json`
relative URL; never copy media bytes or Base64/Data URLs into editable files.

If a texture is unavailable, keep the supplied primitive fallback and append
the fallback key to the GDD Asset Degradation Log. The fallback makes the game
playable; it does not authorize skipping the required asset call.

## Manual play check

Keep the scaffolded `window.__opengame3d` surface exact: `isPaused` and
`renderer` only. Never add teleport, time/state setters, or collectible cheats
to make this check pass.

1. Press Enter on the title screen.
2. Move with W/A/S/D or arrow keys; drag the mouse to look.
3. Press ESC, confirm the pause overlay, then ESC again and confirm movement.
4. Exercise the GDD Core Gameplay Contract through at least two cycles and all three escalation beats.
5. Trigger the visible failure/recovery path (or the declared no-fail pressure response), then reach the win state and verify restart.

## Frequent failures

| Symptom                                                               | Root cause                                                                       | Fix                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| black canvas, no console error                                        | level never rendered after title                                                 | keep the RAF loop and call `renderer.render` every active frame                             |
| ESC overlay opens but game stays paused                               | wrong scene key                                                                  | use the three-key fallback contract exactly                                                 |
| image 404s                                                            | invented key or leading slash mismatch                                           | read the generated `asset-pack.json`; use its key/url                                       |
| movement depends on frame rate                                        | raw per-frame displacement                                                       | multiply by capped `deltaSeconds`                                                           |
| W moves opposite the camera's horizontal X direction after mouse look | the forward vector uses `+sin(yaw)` while three.js camera forward is `-sin(yaw)` | use `(-sin(yaw), -cos(yaw))` for forward and `(cos(yaw), -sin(yaw))` for right              |
| a second run accumulates listeners or GPU resources                   | the previous scene instance was replaced without `dispose()`                     | call `dispose()` before rebuilding and keep textures under Preloader ownership              |
| player leaves the road or crosses a pylon                             | movement bypasses `resolveMovement` or collision radii are missing               | route every XZ move through the resolver and keep SceneMap radii explicit                   |
| route works only after repeated edge nudges                           | floor patches merely touch after player-radius shrink, or a target sits in collision | widen/reposition the authored patches and keep spawn, pickups, and finish centers playable |
| acceptance reports dead config                                        | a field was copied or renamed without removing its old path                      | keep one canonical leaf, update its consumer, and delete the duplicate                      |
| completion notes contradict the GDD body                              | Phase 6 appended differences without correcting stale design values              | reconcile the body in place, then keep the appendix only as change rationale                |
| GDD names a Set, mesh coordinate, or UV behavior absent from source   | Phase 6 rewrote prose from memory instead of the final consumer                  | copy the detail from final source or remove it and keep only stable player-visible behavior |
| GDD blames a template block that already matches the frozen baseline  | Phase 6 inferred provenance from its own edit history instead of a baseline diff | record path + SHA-256 + diff evidence, or attribute the reverted edit to this generated game |
| huge GPU cost                                                         | uncapped DPR or oversized textures                                               | DPR <= 2; texture/display size <= 1024 squared                                              |
