# threed_basic Implementation Manual

Read this file and every scaffolded `src/` file before editing the generated
game. Keep the reference lifecycle intact; customize data, materials, text,
and the one level rather than replacing the shell.

## Phase 5 implementation order

| Order | Action                                                                    | Done when                                                                                         |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1     | map GDD asset keys to `skybox_texture`, `floor_patch`, `energy_billboard` | every used key exists in `asset-pack.json`                                                        |
| 2     | edit `SceneMap.ts`                                                        | main route and every pickup are reachable; obstacle collision radii leave a traversable lane      |
| 3     | merge tuning into `gameConfig.json`                                       | every leaf has one runtime consumer; superseded aliases are deleted                               |
| 4     | theme materials and DOM text                                              | canvas remains WebGL-only; HUD remains DOM-only                                                   |
| 5     | run build and smoke                                                       | zero errors, non-black canvas, WebGL context, ESC resume; smoke bridge remains read-only          |
| 6     | reconcile `GAME_DESIGN.md` after the final uninstrumented playthrough     | the GDD body, config, asset-pack, SceneMap, and observed win condition state one consistent truth |

## Runtime lifecycle

```text
Preloader.load -> TitleScreen.show -> GameScene constructor
  -> applyThreeSceneDefaults -> initSceneMap -> HUD.show
  -> requestAnimationFrame -> GameScene.update -> resolveMovement -> renderer.render
  -> all collectibles removed -> onComplete -> GameCompleteUIScene
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

Treat config as executable data. Keep the existing path when it already serves
the intended value; if a generated design chooses a new path, update the code
and remove the old path together. Never add `fogDensity`, a second pickup
radius, or a duplicate collectible count while their existing equivalents stay
in the file. Record the final leaf-to-consumer mapping in GDD completion notes.

## Asset hookup

Only call `generate_game_assets`. A skybox is a generated 2D equirectangular
image, floor art is a generated 2D patch/texture, and an energy marker is a
generated billboard sprite. Do not call shell image tools or any 3D model API.

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
4. Follow the single route and collect all energy markers.
5. Confirm `TRAIL COMPLETE`, then verify restart.

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
| acceptance reports dead config                                        | a field was copied or renamed without removing its old path                      | keep one canonical leaf, update its consumer, and delete the duplicate                      |
| completion notes contradict the GDD body                              | Phase 6 appended differences without correcting stale design values              | reconcile the body in place, then keep the appendix only as change rationale                |
| GDD names a Set, mesh coordinate, or UV behavior absent from source   | Phase 6 rewrote prose from memory instead of the final consumer                  | copy the detail from final source or remove it and keep only stable player-visible behavior |
| huge GPU cost                                                         | uncapped DPR or oversized textures                                               | DPR <= 2; texture/display size <= 1024 squared                                              |
