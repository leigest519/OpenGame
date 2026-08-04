# threed_basic Implementation Manual

Read this file and every scaffolded `src/` file before editing the generated
game. Keep the reference lifecycle intact; customize data, materials, text,
and the one level rather than replacing the shell.

## Phase 5 implementation order

| Order | Action | Done when |
|---|---|---|
| 1 | map GDD asset keys to `skybox_texture`, `floor_patch`, `energy_billboard` | every used key exists in `asset-pack.json` |
| 2 | edit `SceneMap.ts` | main route and every pickup are reachable |
| 3 | merge tuning into `gameConfig.json` | wrapper shape and core fields remain |
| 4 | theme materials and DOM text | canvas remains WebGL-only; HUD remains DOM-only |
| 5 | run build and smoke | zero errors, non-black canvas, WebGL context, ESC resume |

## Runtime lifecycle

```text
Preloader.load -> TitleScreen.show -> GameScene constructor
  -> applyThreeSceneDefaults -> initSceneMap -> HUD.show
  -> requestAnimationFrame -> GameScene.update -> renderer.render
  -> all collectibles removed -> onComplete -> GameCompleteUIScene
```

`deltaSeconds` is capped by `main.ts`; all movement must multiply by it.
`setPaused(true)` must clear input so a key held before pause cannot continue
moving after resume.

## Asset hookup

Only call `generate_game_assets`. A skybox is a generated 2D equirectangular
image, floor art is a generated 2D patch/texture, and an energy marker is a
generated billboard sprite. Do not call shell image tools or any 3D model API.

If a texture is unavailable, keep the supplied primitive fallback and append
the fallback key to the GDD Asset Degradation Log. The fallback makes the game
playable; it does not authorize skipping the required asset call.

## Manual play check

1. Press Enter on the title screen.
2. Move with W/A/S/D or arrow keys; drag the mouse to look.
3. Press ESC, confirm the pause overlay, then ESC again and confirm movement.
4. Follow the single route and collect all energy markers.
5. Confirm `TRAIL COMPLETE`, then verify restart.

## Frequent failures

| Symptom | Root cause | Fix |
|---|---|---|
| black canvas, no console error | level never rendered after title | keep the RAF loop and call `renderer.render` every active frame |
| ESC overlay opens but game stays paused | wrong scene key | use the three-key fallback contract exactly |
| image 404s | invented key or leading slash mismatch | read the generated `asset-pack.json`; use its key/url |
| movement depends on frame rate | raw per-frame displacement | multiply by capped `deltaSeconds` |
| huge GPU cost | uncapped DPR or oversized textures | DPR <= 2; texture/display size <= 1024 squared |
