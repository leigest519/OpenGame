# Asset Generation Protocol

> **Scope**: generate_game_assets parameters, generate_tilemap ASCII rules, asset-pack.json / animations.json structure, key consistency rules.
> **NOT in scope**: Phaser implementation code (tilemap loading, collision setup) — see module-specific docs (`top_down.md`, `platformer.md`).

---

## 1. Asset Generation (Union-Type Interface)

### 1.1 Tool Call Template

```json
generate_game_assets({
  "style_anchor": "16-bit pixel art, vibrant colors, retro arcade style",
  "composition_env": "pure white background, centered, same size across frames, no position offset",
  "output_dir_name": "public/assets",
  "assets": [
    // See asset type examples below
  ]
})
```

### 1.1.1 Batch Generation (IMPORTANT)

If generating \*too many assets**, split into **2 separate tool calls\*\* to avoid timeout:

- **Call 1**: First half of animations + Backgrounds, tilesets, static images (type: background, tileset, image)
- \*_Call 2_: Remaining animations + audio

### 1.2 Asset Type Reference

| Type         | Parameters                                                         | Output Format              | Background Removal |
| ------------ | ------------------------------------------------------------------ | -------------------------- | ------------------ |
| `background` | `key`, `description`, `resolution`                                 | PNG 1536\*1024 (landscape) | No                 |
| `tileset`    | `key`, `description`, `tileset_size?` (default 3)                  | PNG 3*3 grid = 192*192px   | Yes                |
| `animation`  | `key`, `description`, `animations[]`                               | PNG 386\*560 (portrait)    | Yes                |
| `image`      | `key`, `description`                                               | PNG 386\*560 (portrait)    | Yes                |
| `audio`      | `key`, `description`, `audioType`, `duration?`, `genre?`, `tempo?` | WAV (8-bit chiptune)       | N/A                |

### 1.2.0 3D Image Assets (`threed_basic`)

Three.js games use the same `generate_game_assets` image pipeline. These are
2D images applied to geometry; they are not 3D models and do not create a new
tool type.

| 3D role | Existing type | Required description/runtime contract |
|---|---|---|
| skybox | `background` | equirectangular sky texture, `1024*1024`, no background removal |
| surface texture | `image` | seamless or centered surface art, runtime display/source <= `1024*1024` |
| billboard sprite | `image` | one centered subject, transparent background/removal allowed |
| circular floor patch | `image` | top-down circular patch, transparent outside edge |

- Asset Registry `displaySize` remains GDD/runtime metadata; never pass it as
  an unsupported MCP parameter. Source textures and declared display size must
  not exceed `1024*1024`.
- Keep every 3D image in the normal Asset Registry/display list and generated
  `asset-pack.json`; key and URL consistency rules below are unchanged.
- `colormap` is allowed only for matte/non-glossy art. Never colormap glossy,
  translucent, emissive, metallic, or skybox art.
- Allowed runtime consumers are `Texture`, `MeshStandardMaterial.map`, scene
  background, and `SpriteMaterial`. Never request GLB/FBX/OBJ, normal maps,
  model generation, or a text-to-3D API.

**CRITICAL — Parameter restrictions:**

- `type: "image"` accepts ONLY `key` and `description`. **Do NOT pass `size`, `resolution`, or any other parameter** — the output is always 386\*560 PNG. Game code scales the image via `setScale()` or `setDisplaySize()`. Icons, projectiles, and small sprites all use the same output size; scale in code.
- `type: "background"` is the ONLY type that accepts `resolution`. Format: `"1536*1024"` (use `*` asterisk, NOT `x`).
- **Dimension format**: Always use `*` (asterisk) between width and height: `"1536*1024"`, `"1024*1024"`, `"18*18"`. **Using `x` causes API errors.** This applies to `resolution`, `size`, or any dimension string.

### 1.2.1 Character Image Rules (CRITICAL)

**Rules vary by archetype:**

| Rule              | platformer                    | top_down                                        | tower_defense                                                                   | ui_heavy                    |
| ----------------- | ----------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| **One Per Image** | **ONE character per image**   | **ONE character per image**                     | **ONE entity per image**                                                        | **ONE character per image** |
| **View Angle**    | **SIDE VIEW** (profile)       | **TOP-DOWN / OVERHEAD**                         | **TOP-DOWN / OVERHEAD**                                                         | **FRONT VIEW** or 3/4 view  |
| **Direction**     | Face RIGHT by default         | **3 directions**: front, back, side             | Single direction (top-down)                                                     | Face FORWARD                |
| **Framing**       | Full body, action-ready       | Full body, overhead perspective                 | Full body, clear silhouette                                                     | **Bust shot** (chest up)    |
| **Asset Type**    | `type: "animation"` (2-frame) | `type: "animation"` (**1-frame per direction**) | `type: "image"` (towers/projectiles) or `type: "animation"` (enemies, optional) | `type: "image"` (static)    |

**CRITICAL**: Each character image must contain **exactly one character** — no groups, no multiple figures, no background characters.

**top_down characters**: Generate **3 directional images** per action:

- `{name}_{action}_front` (facing camera/down), `{name}_{action}_back` (facing away/up), `{name}_{action}_side` (right-facing profile)
- Each with `frameCount: 1`. Side sprites always face RIGHT; engine uses `flipX` for left.
- Prioritize directional coverage over frame count — 3 views × 1 frame >> 1 view × 2 frames.

**ui_heavy characters**: Generate SEPARATE images for each expression:

- `hero_neutral.png`, `hero_happy.png`, `hero_angry.png`
- Use `type: "image"` (NOT `type: "animation"`) for each

**tower_defense entities**: Towers, enemies, and projectiles are all top-down view:

- Towers: `type: "image"`, name `tower_{type}`. Clear silhouette, centered. Optional upgrade variants: `tower_{type}_lv2`, `tower_{type}_lv3`.
- Tower slots: `type: "image"`, name `tower_slot`. Visual placeholder for buildable cells that blends with the game theme (e.g., cushion, mat, stone platform, glowing circle). Slots are hidden by default and shown only during placement mode. If omitted, `drawTowerSlots()` falls back to a subtle graphic.
- Enemies: `type: "image"` (static) or `type: "animation"` (walk cycle). Name `enemy_{type}`. For animation: 2-frame walk cycle or 1-frame directional images.
- Projectiles: `type: "image"`, name `proj_{type}`. Small items (arrows, bullets, orbs). Code scales via `setScale()`. Use `projectileKey` in tower config; code uses 20px display for custom textures. Each tower type MUST have a distinct projectile image.
- Obstacles: `type: "image"`, name `obstacle_{type}`. Destructible objects placed on BLOCKED cells. Click-to-damage mechanic.
- Defense target: `type: "image"`, name `defense_target`. The object being defended at the exit point (optional but recommended for thematic games).
- **NO tilesets needed**: Tower defense maps use code-defined grids with a background image. Do NOT generate tileset assets for tower_defense.

### 1.2.2 Tileset Rules (CRITICAL)

| Rule                                      | Requirement                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Canvas Fill**                           | Tiles MUST fill the ENTIRE canvas, NO blank space, NO margins                                                                                                                                                                                                                                   |
| **Grid Layout**                           | Perfect 3\*3 grid with NO gaps between tiles                                                                                                                                                                                                                                                    |
| **Tile Edges**                            | Each tile should have clean, seamless edges                                                                                                                                                                                                                                                     |
| **Top-Down Dual Tilesets (tilemap mode)** | Top-down tilemap games require **TWO** tileset images per theme: `{theme}_floor` (ground/surface) and `{theme}_walls` (wall/barrier). Both use `tileset_size: 3` and get auto-expanded to 7\*7 by TilesetProcessor. **Arena mode games do NOT need tilesets** — use a background image instead. |
| **Floor Tileset Art**                     | Floor tiles should be **solid/simple color** with minimal detail (at most subtle lines). Floor is background — busy patterns clutter the scene and compete with characters                                                                                                                      |
| **Walls Tileset Art**                     | Walls should have **clear contrast** from floor (darker, thicker, raised appearance). More detail than floor is acceptable but keep it readable at small tile sizes                                                                                                                             |

### 1.2.3 Animation Guidelines

| Guideline                 | platformer / grid_logic | top_down                                            |
| ------------------------- | ----------------------- | --------------------------------------------------- |
| Characters with animation | **4-6**                 | **4-6**                                             |
| Frame count               | **2 frames** per action | **1 frame per direction** (3 directions per action) |
| Priority                  | Frame fluidity          | **Directional coverage**                            |

**Standard Animation Set (platformer / grid_logic):**

| Character Type  | Required Animations                   |
| --------------- | ------------------------------------- |
| **Player/Hero** | `idle`, `run`, `jump`, `punch`, `die` |
| **Enemy**       | `idle`, `walk`, `attack`, `die`       |

**Frame Count Rule:**

- platformer / grid_logic: ALL animations use **frameCount: 2**.

Use `type: "image"` for items that don't need animation (coins, powerups, etc.).

**ui_heavy exception**: UI Heavy games typically use `type: "image"` for ALL characters (portraits with expressions). Only use `type: "animation"` for visual effects (sparkles, explosions) if needed. See `docs/modules/ui_heavy/design_rules.md` for asset guidelines.

### 1.2.4 Animation Prompt Guidelines (CRITICAL)

**action_desc** is the most important parameter for animation quality. Write clear, specific descriptions:

| Animation | Good action_desc                                                         | Bad action_desc  |
| --------- | ------------------------------------------------------------------------ | ---------------- |
| idle      | "standing still, relaxed pose, holding weapon at side"                   | "idle"           |
| run       | "running forward, legs in full stride, arms pumping"                     | "running"        |
| jump      | "mid-air jump, crouched position, arms raised"                           | "jumping"        |
| punch     | "swinging fist/weapon in powerful horizontal arc, follow-through motion" | "punching"       |
| kick      | "kicking forward with extended leg, arms held for balance"               | "kicking"        |
| ultimate  | "raising weapon to sky, magical energy swirling around body"             | "special attack" |
| die       | "falling backward defeated, weapon dropping, body going limp"            | "dying"          |

**Key Principles for action_desc:**

1. **Be specific about body position**: Describe limb positions, body angle
2. **Include motion direction**: "forward", "overhead", "downward arc"
3. **Mention key visual elements**: "sword extended", "shield raised", "cape flowing"
4. **Keep consistency**: Same character description across all animations
5. **Include character-specific props**: "hammer raised", "armor glowing", "cape wrapping"

### 1.2.5 Audio Generation Guidelines

**Output Format**: All audio outputs as `.wav` files (8-bit chiptune style via ABC notation)

**Audio Types:**

| audioType | Purpose          | Default Duration | Typical Use               |
| --------- | ---------------- | ---------------- | ------------------------- |
| `sfx`     | Sound effects    | 1 second         | jump, hit, collect, click |
| `bgm`     | Background music | 5 seconds        | level theme, menu music   |

**Audio Parameters:**

| Parameter   | Values                                                                           | Description                                                 |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `audioType` | `"sfx"` / `"bgm"`                                                                | **Required**                                                |
| `duration`  | Number (seconds)                                                                 | Optional. sfx: 0.5-2s, bgm: 10-30s recommended              |
| `genre`     | `"chiptune"`, `"electronic"`, `"orchestral"`, `"rock"`, `"ambient"`, `"fantasy"` | Optional. Music style                                       |
| `tempo`     | `"slow"`, `"medium"`, `"fast"`                                                   | Optional. slow=60-90 BPM, medium=100-130 BPM, fast=140+ BPM |

**Recommended Durations:**

- Jump/Hit SFX: 0.3-0.5s
- Collect/Click SFX: 0.5-1s
- Level BGM: 15-30s (for looping)
- Menu BGM: 10-20s (calm, loopable)

**Audio Prompt Guidelines:**

| Audio Type  | Good description                                            | Bad description    |
| ----------- | ----------------------------------------------------------- | ------------------ |
| Jump SFX    | "8-bit style upward rising pitch, quick bouncy sound"       | "jump sound"       |
| Collect SFX | "magical sparkle chime, ascending notes, positive feedback" | "coin sound"       |
| Hit SFX     | "punchy impact, short bass thump with crack"                | "hit"              |
| Level BGM   | "adventurous orchestral theme, heroic brass, steady rhythm" | "background music" |
| Menu BGM    | "calm ambient melody, soft synth pads, relaxing atmosphere" | "menu music"       |

**Key Principles for Audio:**

1. **Describe the sound quality**: "8-bit", "orchestral", "electronic", "chiptune"
2. **Mention emotional tone**: "heroic", "mysterious", "urgent", "peaceful"
3. **Include instrument hints**: "brass", "strings", "synth", "piano"
4. **For SFX, describe the shape**: "rising pitch", "sharp attack", "quick decay"

### 1.3 Asset Type Examples (one per type)

```json
// Background — landscape, NO background removal
{ "type": "background", "key": "city_bg",
  "description": "New York City skyline at night, retro 16-bit pixel art", "resolution": "1536*1024" }

// Tileset — 3*3 core grid, auto-expanded to 7*7 by TilesetProcessor
{ "type": "tileset", "key": "ruins_tiles",
  "description": "Ancient ruins stone blocks with platforms, 3*3 grid", "tileset_size": 3 }

// Animation — platformer style (2-frame per action, SIDE VIEW)
{ "type": "animation", "key": "thor",
  "description": "Thor with red cape, silver armor, hammer, chibi style, SIDE VIEW facing RIGHT",
  "animations": [
    { "name": "idle", "frameCount": 2,
      "action_desc": "standing still, relaxed pose, holding hammer at side, cape flowing gently" },
    { "name": "run", "frameCount": 2,
      "action_desc": "running forward, legs in full stride, hammer held ready, cape flowing backward" },
    { "name": "die", "frameCount": 2,
      "action_desc": "falling backward defeated, hammer dropping, cape wrapping around body" }
  ]
}
// (Add more actions following the same pattern: jump, punch, kick, ultimate, etc.)

// Image — ONLY key and description. Output always 386*560; game code scales.
{ "type": "image", "key": "coin", "description": "golden coin collectible item, shiny" }
{ "type": "image", "key": "tower_spitfire", "description": "Top-down view of orange tabby cat on cushion, alert pose, clear silhouette" }
{ "type": "image", "key": "proj_tapioca", "description": "Black tapioca pearl with sticky glistening texture" }
{ "type": "image", "key": "icon_tower_tabby", "description": "Small icon of tabby cat for tower selection UI" }

// Audio SFX
{ "type": "audio", "key": "jump_sfx", "audioType": "sfx", "duration": 0.3,
  "description": "8-bit style upward rising pitch, quick bouncy arcade sound" }

// Audio BGM
{ "type": "audio", "key": "level1_bgm", "audioType": "bgm", "duration": 20,
  "description": "adventurous fantasy theme, heroic melody, steady rhythm, loopable",
  "genre": "fantasy", "tempo": "medium" }
```

### 1.4 Output File Naming Convention

```
public/assets/
  jungle_bg.png               <- type: "background" (1536*1024)
  jungle_tiles.png            <- type: "tileset" (7*7 = 448*448px)
  player_idle_01.png          <- type: "animation"
  player_run_01.png
  player_run_02.png
  player_run_03.png
  player_run_video.mp4        <- I2V source video (if useI2V: true)
  enemy_soldier.png           <- type: "image"
  coin.png                    <- type: "image"
  jump_sfx.wav                <- type: "audio" (sfx)
  level_bgm.wav               <- type: "audio" (bgm)
  asset-pack.json             <- auto-generated manifest
```

---

## 2. Tilemap Generation (ASCII Art to Tiled JSON)

**IMPORTANT**: Use predefined ASCII templates from the module's `design_rules.md`. Do NOT design maps from scratch.

### 2.1 Platformer Example (single tileset)

```json
generate_tilemap({
  "map_key": "level1_map",
  "tileset_key": "city_tiles",
  "tile_size": 64,
  "tileset_grid_size": 3,
  "layout_ascii": ["..P.........E..", "###############"],
  "legend": { ".": 0, "#": 1, "P": 0, "E": 0 },
  "object_markers": { "P": "player_spawn", "E": "enemy_spawn" },
  "output_dir_name": "public/assets"
})
```

### 2.2 Top-Down Example (dual tilesets — call TWICE per level)

```json
// Call 1: Floor (walkable, with spawn points)
generate_tilemap({
  "map_key": "base_floor", "tileset_key": "imperial_floor",
  "tile_size": 64, "mode": "floor",
  "layout_ascii": ["##########", "#..P...E.#", "#........#", "##########"],
  "object_markers": { "P": "player_spawn", "E": "enemy_spawn", "O": "obstacle" },
  "output_dir_name": "public/assets"
})

// Call 2: Walls (barriers, NO object_markers needed)
generate_tilemap({
  "map_key": "base_walls", "tileset_key": "imperial_walls",
  "tile_size": 64, "mode": "walls",
  "layout_ascii": ["##########", "#........#", "#........#", "##########"],
  "output_dir_name": "public/assets"
})
```

### 2.3 Parameter Reference

| Parameter           | Description                                                   | Example                   |
| ------------------- | ------------------------------------------------------------- | ------------------------- |
| `map_key`           | Unique Phaser key for the output JSON                         | `"level1_map"`            |
| `tileset_key`       | MUST match the asset key from `generate_game_assets`          | `"jungle_tiles"`          |
| `tile_size`         | Pixel size per tile                                           | `64`                      |
| `tileset_grid_size` | Tileset grid dimension (default 3)                            | `3`                       |
| `layout_ascii`      | ASCII map from GDD Section 4                                  | Array of strings          |
| `legend`            | Char → Tile ID mapping (`0` = air). Platformer only           | `{ ".": 0, "#": 1 }`      |
| `mode`              | Top-down only: `"floor"` or `"walls"` (auto-tiles internally) | `"floor"`                 |
| `object_markers`    | Char → spawn type                                             | `{ "P": "player_spawn" }` |

### 2.4 Legend (Platformer 9-Slice)

- `0` = Air (no tile), `1` = Solid tile (ground/platforms/walls)
- `2` = Floating platform (optional)
- Characters in `object_markers` map to `0` in legend (they stand on air)
- Top-down `mode: "floor"/"walls"` uses auto-tiling — `legend` is NOT needed

---

## 3. Asset Pack JSON Structure

### 3.1 Correct Format (Phaser load.pack())

```json
{
  "section_name": {
    "files": [
      { "type": "image", "key": "unique_key", "url": "path/to/asset.png" }
    ]
  }
}
```

### 3.2 Structure Example

```json
{
  "assetPack": {
    "files": [
      {
        "type": "animation",
        "key": "animations",
        "url": "assets/animations.json"
      }
    ]
  },
  "backgrounds": {
    "files": [
      { "type": "image", "key": "city_bg", "url": "assets/city_bg.png" }
    ]
  },
  "tilesets": {
    "files": [
      { "type": "image", "key": "city_tiles", "url": "assets/city_tiles.png" }
    ]
  },
  "tilemaps": {
    "files": [
      {
        "type": "tilemapTiledJSON",
        "key": "level1_map",
        "url": "assets/level1_map.json"
      }
    ]
  },
  "hero_frames": {
    "files": [
      {
        "type": "image",
        "key": "hero_idle_01",
        "url": "assets/hero_idle_01.png"
      },
      {
        "type": "image",
        "key": "hero_idle_02",
        "url": "assets/hero_idle_02.png"
      }
    ]
  },
  "audio": {
    "files": [
      { "type": "audio", "key": "jump_sfx", "url": "assets/jump_sfx.wav" }
    ]
  }
}
```

**Section naming**: Group by purpose (`backgrounds`, `tilesets`, `tilemaps`, `{char}_frames`, `audio`). Each section has a `files` array.

**Frame naming**: `{character}_{action}_{frame}.png` (platformer) or `{character}_{action}_{direction}.png` (top_down)

**CRITICAL**: animations.json entry MUST use `type: "animation"` (NOT `type: "json"`)

- `type: "json"` only loads JSON to cache — does NOT create Phaser animations
- `type: "animation"` auto-creates Phaser animations from the JSON

**WARNING**: animations.json must be loaded with `type: "animation"` ONLY. Do NOT also add a `type: "json"` entry for the same file — this causes double-loading and runtime errors. Example of CORRECT:

```json
{
  "type": "animation",
  "key": "animations_auto",
  "url": "assets/animations.json"
}
```

---

## 3.3 animations.json Format (CRITICAL - COMMON BUG SOURCE)

**Phaser 3 REQUIRES this exact format - any other format will cause "Missing animation" errors!**

```json
{
  "anims": [
    {
      "key": "thor_idle_anim",
      "type": "frame",
      "frames": [
        { "key": "thor_idle_01", "duration": 400 },
        { "key": "thor_idle_02", "duration": 400 }
      ],
      "repeat": -1
    }
  ]
}
```

| Field    | Required | Description                                         |
| -------- | -------- | --------------------------------------------------- |
| `anims`  | YES      | Root array containing all animations                |
| `key`    | YES      | Animation key (matches animKeys in code)            |
| `type`   | YES      | Always `"frame"`                                    |
| `frames` | YES      | Array of `{ "key": "texture_key", "duration": ms }` |
| `repeat` | YES      | `-1` = loop forever, `0` = play once                |

**Frame key naming (platformer)**: `{character}_{action}_{frame}` → `thor_idle_01`, `thor_idle_02`
**Frame key naming (top_down)**: `{character}_{action}_{direction}` → `mando_idle_front`, `mando_idle_back`, `mando_idle_side`
**Animation key naming**: `{character}_{action}_anim` → `thor_idle_anim` (base key used by FSM)
**Directional animation key (top_down)**: `{character}_{action}_{direction}_anim` → `mando_idle_front_anim`

**Pre-flight check**: Before running, verify EVERY frame key in animations.json exists in asset-pack.json!

### 3.4 Common Errors

| Error                                          | Consequence                        | Solution                                                                                |
| ---------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| Missing `"type"` field                         | Asset not loaded                   | Always include type                                                                     |
| `type: "json"` for animations                  | Animations not created             | Use `type: "animation"`                                                                 |
| All frames same URL                            | Animation static                   | Each frame unique file                                                                  |
| Wrong JSON structure                           | Parse error                        | Use `{ section: { files: [...] } }`                                                     |
| Leading slash in URL                           | 404 error                          | Use relative paths                                                                      |
| Animation key mismatch                         | Animation not found                | Configure animKeys in Player.ts                                                         |
| `Tongyi wanx edit API failed: 400 - url error` | I2I mode fails, 0 assets generated | Remove `useI2V: false` from animation assets; use default I2V. Ensure FFmpeg installed. |

---

## 4. Key Consistency Rule

**CRITICAL: These keys must ALL match across files!**

### Platformer (single tileset)

```
generate_game_assets: { type: "tileset", key: "jungle_tiles" }
                                              |
generate_tilemap: { tileset_key: "jungle_tiles" }
                                 |
asset-pack.json: { "key": "jungle_tiles", "url": "assets/jungle_tiles.png" }
                           |
Scene code: this.map.addTilesetImage('jungle_tiles', 'jungle_tiles')
```

### Top-Down (dual tilesets)

```
generate_game_assets: { key: "dungeon_floor" }  AND  { key: "dungeon_walls" }
                              |                               |
generate_tilemap (call 1): { tileset_key: "dungeon_floor", mode: "floor" }
generate_tilemap (call 2): { tileset_key: "dungeon_walls", mode: "walls" }
                                    |                               |
asset-pack.json: { "key": "dungeon_floor" }  AND  { "key": "dungeon_walls" }
                          |                                 |
Scene code: floorMap.addTilesetImage('dungeon_floor', 'dungeon_floor')
            wallsMap.addTilesetImage('dungeon_walls', 'dungeon_walls')
```

---

## 5. Verification Checklist

### 5.1 Common AI Mistakes (CHECK BEFORE CALLING)

| Mistake                           | Wrong                                                                         | Correct                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Passing `size` for type `"image"` | `{ "type": "image", "key": "icon_x", "description": "...", "size": "32x32" }` | `{ "type": "image", "key": "icon_x", "description": "..." }` — **no size param** |
| Using `x` in dimension strings    | `"18x18"`, `"1536x1024"`                                                      | `"18*18"`, `"1536*1024"` — **use asterisk `*`**                                  |

### 5.2 Before calling `generate_game_assets`

- [ ] `resolution` / `size` use `*` not `x` (e.g. `"1536*1024"`)
- [ ] `background` resolution is one of: `"1024*1024"`, `"1536*1024"`, `"2048*2048"`
- [ ] **`type: "image"` has NO `size` parameter** — remove if present
- [ ] Every `animations[]` item has `name`, `frameCount`, `action_desc`
- [ ] No `useI2V: false` unless FFmpeg unavailable (I2I may cause OSS errors)

### 5.3 Before proceeding to code implementation

- [ ] All asset files exist at specified URLs
- [ ] asset-pack.json keys match generated file names
- [ ] Tileset key matches across all files
- [ ] Animation frame keys use format `{key}_{anim}_{frame}`
- [ ] Tilemap tile layer name is 'Ground', object layer is 'Objects'
- [ ] Top-down **tilemap** games have TWO tileset images (`{theme}_floor` + `{theme}_walls`) and TWO tilemap JSONs per level
- [ ] Top-down **arena** games have NO tilesets, NO tilemap JSONs — use background image instead
