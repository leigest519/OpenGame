# Debug Protocol

> **Scope**: Pre-build verification, testing strategy, error diagnosis, forbidden operations

---

## 0. Pre-Build Verification Checklist (MUST READ BEFORE `npm run build`)

### 0.1 Animation System (3-Layer Check)

```
asset-pack.json → animations.json → Character.ts animKeys
```

- [ ] Every frame key in `animations.json` exists in `asset-pack.json`
- [ ] Every animation key in `animKeys` config exists in `animations.json`
- [ ] Physical asset files (`.png`) exist for all registered keys

### 0.2 Config Keys Alignment

- [ ] `gameConfig.json` has ALL fields referenced in code
- [ ] Character configs (thor, ironman, etc.) have required stats
- [ ] Common fields exist at correct nesting level (e.g., `playerConfig.hurtingDuration`)

### 0.3 Variable Name Consistency

- [ ] Hook method assignments use correct variable names:
  - `initUltimate()` → assign to `this.ultimate` (NOT `this.ultimateSkill`)
  - `initBehaviors()` → use `this.behaviors.add()`
- [ ] Base class property names match subclass references

### 0.4 Function Parameter Types

- [ ] `createPlayerByType(x, y, PlayerClass)` - pass CLASS, not factory function
- [ ] `getPlayerClasses()` returns `{ 'Name': Class }` map

### 0.5 Tilemap Layer Names (Case Sensitive!)

- [ ] Code uses EXACT layer name from tilemap JSON
- [ ] `"Ground"` in code matches `"Ground"` in JSON (not `"ground"`)
- [ ] Object layer name matches: `"Objects"` (capital O)

### 0.6 TypeScript Import Rules

- [ ] Interfaces imported with `type` keyword: `import { type PlayerConfig }`
- [ ] Classes imported without `type`: `import { BasePlayer }`
- [ ] Re-exports use `type`: `export { type IBehavior, BaseBehavior }`

### 0.7 Scene Registration

- [ ] All scenes registered in `main.ts` Phaser config
- [ ] Scene keys in `LevelManager.ts` match actual scene class names
- [ ] `LEVEL_ORDER` array contains valid scene keys

### 0.8 UI Heavy Specific Checks

- [ ] `initializeDialogues()` returns non-empty DialogueEntry array
- [ ] All `characterId` values in dialogues match `registerCharacter()` calls
- [ ] Character expression keys match asset-pack.json image keys
- [ ] Card `textureKey` values match asset-pack.json
- [ ] `getCardDeck()` returns non-empty array (for battle scenes)
- [ ] Quiz questions have `explanation` field (for educational games)
- [ ] Scene transitions in hooks use correct scene key strings
- [ ] `gameConfig.json` has `battleConfig` section (for battle scenes)
- [ ] `initializeBattle()` sets `playerMaxHP`, `playerHP`, `enemyMaxHP`, `enemyHP` (these values are used by createHUD)
- [ ] If overriding `resolveCardAction()`, hide quiz modal FIRST via `quizModal.hide()` so HP bar changes are visible (QuizModal depth 300 covers StatusBar depth 150)
- [ ] If overriding `executeEnemyTurn()`, ALWAYS call `completeEnemyTurn()` when finished (otherwise game freezes)
- [ ] Verify UI component depth ordering: StatusBars (150) < QuizModal overlay (300) < HelpPanel (500)
- [ ] Combo multiplier is only applied to attack/heavy_attack cards (not heal/shield)
- [ ] Config access: import `gameConfig.json` directly. NEVER use `this.gameConfig.getValue()` — no such API exists
- [ ] FloatingText is STATIC: use `this.showFloatingText()` or `FloatingText.show()`. NEVER use `new FloatingText()`
- [ ] TweenPresets exports individual functions: `import { fadeIn } from '../ui/TweenPresets'`. NEVER `import { TweenPresets }`
- [ ] TweenPresets functions use POSITIONAL arguments: `shake(scene, target, 5, 300)`. NEVER `shake(scene, target, { intensity: 5 })`
- [ ] Method visibility: NEVER narrow base class method visibility in overrides (public->protected WRONG, protected->private WRONG)
- [ ] Lifecycle: NEVER call `this.startBattle()` inside `initializeBattle()` — `create()` calls it automatically after
- [ ] Scene cleanup: use `this.events.once('shutdown', cb)`. NEVER `override shutdown()`
- [ ] Round cleanup: Destroy dynamically created UI elements (buttons, text, panels) BEFORE creating new ones each round
- [ ] Round state reset: Reset per-round mutable state (timers, counters, flags) at the START of each new round
- [ ] For BUZZER_RACE: track `lastBuzzedPlayerId` in 'playerBuzzed' event handler for damage attribution
- [ ] For PVP: Do NOT instantiate QuizModal — build custom answer buttons for mouse-click interaction
- [ ] Question dedup: use `this.questionBank.splice(idx, 1)[0]` or `popRandomQuestion()` to avoid repeats
- [ ] UI-heavy games with static portraits: `animations.json` should be `{ "anims": [] }`
- [ ] Type names: ONLY import types that actually exist in the source file. NEVER invent type names
- [ ] Hook names: ONLY override methods that actually exist in the base class. Verify by reading the base class

### 0.9 Cross-Script Consistency (ALL game types)

- [ ] `import { type X }` used for ALL interface/type imports (not just `import { X }`)
- [ ] ALL imported type names ACTUALLY EXIST in the source file (open and verify — never assume)
- [ ] ALL overridden method names ACTUALLY EXIST in the base class (open and verify — never assume)
- [ ] ALL override methods have SAME OR WIDER visibility as base class (never narrow: public->protected is WRONG)
- [ ] Animation keys referenced in code exist in `animations.json`
- [ ] Config keys referenced in code exist in `gameConfig.json`
- [ ] All `scene.start('SceneKey')` targets are registered in `main.ts`
- [ ] `LevelManager.LEVEL_ORDER[0]` matches the actual first game scene (NOT default `"Level1Scene"` if unused)
- [ ] All texture keys used in `this.add.image()` / `this.textures.exists()` match `asset-pack.json`
- [ ] No leftover template placeholder text (e.g., `_TemplateBattle`, `TODO: Replace`)
- [ ] If scene is reused via `scene.start()`, all mutable state is reset in `create()` (Phaser reuses instances)
- [ ] Event listeners registered in `create()` are not leaked on scene restart
- [ ] All dynamically created UI elements are properly destroyed before recreation (avoid accumulation)

### Quick Verification Commands:

1. Search `this.ultimate` - count assignments vs usages (platformer)
2. Search animation keys in code - verify each exists in animations.json (platformer)
3. Search config property access - verify each path exists in gameConfig.json
4. Search `createLayer("` - verify layer names match tilemap JSON (platformer)
5. Search `registerCharacter` - verify all dialogue characterIds are registered (ui_heavy)
6. Search `scene.start(` - verify all target scene keys are registered in main.ts
7. Search `import {` without `type` - verify interfaces use `type` keyword (all types)
8. Search `handleCardPlayed` / `handleQuizAnswered` - verify they are called from UI events (ui_heavy)
9. Search `completeEnemyTurn` - verify it is always called in custom `executeEnemyTurn` overrides (ui_heavy)
10. Search `import { type` - verify every imported type name exists in the source file (all types)
11. Search `override` - verify every overridden method exists in the base class and visibility matches (all types)
12. Search `LEVEL_ORDER` - verify first entry matches actual first game scene (all types)
13. Search `this.startBattle` - verify it is NOT called from initializeBattle (ui_heavy)
14. Search `new FloatingText` - should return 0 results; FloatingText is static (ui_heavy)
15. Search `TweenPresets` as default import - should return 0 results; use named imports (ui_heavy)

---

## 1. FORBIDDEN Operations (CRITICAL)

| NEVER DO                         | Why                                            | Do Instead                           |
| -------------------------------- | ---------------------------------------------- | ------------------------------------ |
| `npm install`                    | Dependencies pre-installed, wastes 30+ seconds | Read error, fix code directly        |
| `npm audit fix`                  | Security issues are not game logic errors      | Focus on the actual error            |
| `npm update`                     | Version changes break things                   | Use existing versions                |
| Delete `node_modules`            | Nuclear option, 2+ minutes to reinstall        | Never necessary for code bugs        |
| Reinstall packages               | Symptom of misdiagnosis                        | Check import paths instead           |
| Random code changes              | Guessing wastes time                           | Read error message carefully         |
| **Run dev server in foreground** | **Blocks terminal, agent loses control**       | **ALWAYS use `is_background: true`** |

**Rule**: If error message mentions a FILE and LINE NUMBER, go there FIRST.

---

## 2. Debug Commands

| Command         | Purpose                | Output                           | Mode                    |
| --------------- | ---------------------- | -------------------------------- | ----------------------- |
| `npm run build` | TypeScript compilation | Type errors, missing imports     | Foreground (terminates) |
| `npm run test`  | Headless Phaser tests  | Logic errors, runtime exceptions | Foreground (terminates) |
| `npm run dev`   | Dev server + browser   | Visual bugs, console errors      | **BACKGROUND ONLY**     |

**Execution Order**: `build` -> `test` -> `dev` (fix errors at each stage before proceeding)

### 2.1 Dev Server Rules (CRITICAL)

**NEVER run dev server in foreground mode!** It runs indefinitely and blocks the terminal.

```json
// WRONG - Agent will lose terminal control
{
  "command": "npm run dev",
  "is_background": false  // FORBIDDEN!
}

// CORRECT - Run in background
{
  "command": "npm run dev",
  "is_background": true   // Agent keeps control
}
```

**After starting dev server in background:**

1. Wait 2-3 seconds for server to start
2. Read terminal output to get the URL (usually `http://localhost:5173`)
3. Use browser tools to verify visual behavior
4. Continue with other tasks while server runs

### 2.2 Screenshot Evidence Is Path-Only

- Save screenshots as files under the current game workspace and report their
  relative paths. Never embed real media in source, config, HTML, Markdown, or
  chat/tool output.
- Never call `ReadMediaFile` or another media-read tool for screenshots, even
  after compression or through a sub-agent. That still injects Base64/Data URLs
  into the generation session.
- Use smoke's WebGL, non-blank pixel, error-array, and visible-DOM assertions for
  automated verification. Human visual review happens outside the generation
  session by opening the reported path.

---

## 3. Test Infrastructure

### 3.1 File Structure

```
src/test/
  setup.ts              # Global setup (fake timers, canvas mock)
  helpers/
    phaser.ts           # Headless Phaser utilities
  *.test.ts             # Your test files
```

### 3.2 Test Helper Functions

| Function      | Signature                                          | Purpose                                  |
| ------------- | -------------------------------------------------- | ---------------------------------------- |
| `bootScene`   | `bootScene<T>(SceneClass): Promise<{game, scene}>` | Boot scene in headless mode              |
| `tickFrames`  | `tickFrames(n): Promise<void>`                     | Advance game by n frames (~16.67ms each) |
| `destroyGame` | `destroyGame(game): Promise<void>`                 | Cleanup (call in `afterEach`)            |
| `waitUntil`   | `waitUntil(condition, maxFrames?): Promise<void>`  | Wait for async conditions                |

### 3.3 Writing a Test

```typescript
// src/test/level1.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { bootScene, tickFrames, destroyGame } from './helpers/phaser';
import { Level1Scene } from '../scenes/Level1Scene';

describe('Level1Scene', () => {
  let game: Phaser.Game;

  afterEach(async () => {
    if (game) await destroyGame(game);
  });

  it('should initialize player', async () => {
    const { game: g, scene } = await bootScene(Level1Scene);
    game = g;
    await tickFrames(10);

    expect(scene.player).toBeDefined();
    expect(scene.player.health).toBe(100);
  });

  it('should spawn enemies', async () => {
    const { game: g, scene } = await bootScene(Level1Scene);
    game = g;
    await tickFrames(10);

    expect(scene.enemies.getLength()).toBeGreaterThan(0);
  });
});
```

### 3.4 Debug Test (Quick Isolation)

When a specific feature fails, write a focused debug test:

```typescript
// src/test/debug.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { bootScene, tickFrames, destroyGame } from './helpers/phaser';
import { Level1Scene } from '../scenes/Level1Scene';

describe('DEBUG: Player Attack', () => {
  let game: Phaser.Game;

  afterEach(async () => {
    if (game) await destroyGame(game);
  });

  it('attack should damage enemy', async () => {
    const { game: g, scene } = await bootScene(Level1Scene);
    game = g;
    await tickFrames(10);

    const enemy = scene.enemies.getFirstAlive();
    const initialHealth = enemy.health;

    // Trigger attack via FSM
    scene.player.fsm.goto('attacking');
    await tickFrames(5);

    console.log('Enemy health before:', initialHealth);
    console.log('Enemy health after:', enemy.health);
    expect(enemy.health).toBeLessThan(initialHealth);
  });
});
```

---

## 4. Error Diagnosis

### 4.1 Error Types and Fix Strategy

| Error Pattern                             | Category     | Diagnosis               | Fix                                    |
| ----------------------------------------- | ------------ | ----------------------- | -------------------------------------- |
| `Cannot find module '../X'`               | Import       | Wrong relative path     | Count `../` levels, verify file exists |
| `Property 'X' does not exist on type 'Y'` | TypeScript   | Missing property/method | Check class definition, add property   |
| `Cannot read property 'X' of undefined`   | Runtime      | Object not initialized  | Check creation order in `create()`     |
| `Texture 'X' not found`                   | Asset        | Key mismatch            | Compare with `asset-pack.json` keys    |
| `Animation 'X' doesn't exist`             | Asset        | Key mismatch            | Compare with `animations.json` keys    |
| `Scene 'X' not found`                     | Registration | Scene not added         | Check `main.ts` scene registration     |
| `Maximum call stack exceeded`             | Logic        | Infinite recursion      | Check recursive calls, add base case   |

### 4.2 Diagnosis Workflow

```
Error occurs
    |
    v
Read FULL error message
    |
    v
Find FILE:LINE mentioned ----------------+
    |                                    |
    v                                    v
TypeScript error?                  Runtime error?
    |                                    |
    v                                    v
Check types, imports              Check object initialization
    |                                    |
    v                                    v
npm run build                     npm run test
    |                                    |
    +----------------+-------------------+
                     |
                     v
               Error fixed?
                     |
             +-------+-------+
             No              Yes
             |               |
             v               v
       Re-read error    npm run dev
       Try next fix     (visual check)
```

### 4.3 Common Fixes Quick Reference

**Import Errors:**

```typescript
// Wrong
import { Player } from './Player'; // File is in characters/
// Correct
import { Player } from '../characters/Player';
```

**Asset Key Errors:**

```typescript
// Key doesn't match asset-pack.json
this.setTexture('player_idle');
// Check asset-pack.json for exact key
this.setTexture('player_idle_01'); // Includes frame number
```

**Undefined Object Errors:**

```typescript
// Player accessed before creation
create() {
  this.player.setPosition(100, 100);  // player is undefined!
  this.player = new Player(...);
}
// Create before use
create() {
  this.player = new Player(...);
  this.player.setPosition(100, 100);
}
```

**Scene Not Found:**

```typescript
// Scene not registered in main.ts
this.scene.start('Level1Scene');

// Add to main.ts FIRST:
import { Level1Scene } from './scenes/Level1Scene';
game.scene.add('Level1Scene', Level1Scene);
```

---

## 5. Debug Checklist

When an error occurs, go through this checklist:

### 5.1 Before Debugging

- [ ] Read the COMPLETE error message (not just first line)
- [ ] Note the FILE and LINE NUMBER
- [ ] Identify error category (TypeScript / Runtime / Asset)

### 5.2 TypeScript Errors (`npm run build`)

- [ ] Check import paths (count `../` levels)
- [ ] Check type definitions match usage
- [ ] Check property names for typos
- [ ] Check function parameter types

### 5.3 Runtime Errors (`npm run test`)

- [ ] Check object creation order in `create()`
- [ ] Check for null/undefined before access
- [ ] Add `console.log()` to trace execution
- [ ] Write isolated debug test
- [ ] **Container.setInteractive() pitfall**: Phaser Containers have NO implicit hitArea. Calling `container.setInteractive()` causes `hitAreaCallback is not a function`. ALWAYS set interactive on the INNER shape (rectangle/image), not the container. Put click listeners on the inner shape too.
- [ ] **CharacterPortrait has no `displayObject` property**: It IS a Container. Pass it directly to tween/shake functions: `shake(this, portrait, 5, 300)`. Do NOT write `portrait.displayObject` — this property does not exist.

### 5.4 Asset Errors

- [ ] Compare texture key with `asset-pack.json`
- [ ] Compare animation key with `animations.json`
- [ ] Check file paths in asset-pack.json are correct
- [ ] Verify assets were generated successfully

### 5.5 Scene Errors

- [ ] Check scene registered in `main.ts`
- [ ] Check scene key matches exactly
- [ ] Check `LevelManager.ts` LEVEL_ORDER

---

## 6. Anti-Patterns (What NOT to Do)

| Anti-Pattern                                  | Why It's Wrong                  | Correct Approach                   |
| --------------------------------------------- | ------------------------------- | ---------------------------------- |
| Change random code hoping it fixes            | Guessing wastes time            | Read error, understand cause       |
| Add try/catch everywhere                      | Hides bugs instead of fixing    | Fix the root cause                 |
| Comment out broken code                       | Leaves incomplete features      | Fix or remove properly             |
| Copy code from internet without understanding | May not fit project patterns    | Understand template patterns first |
| Skip reading error message                    | Miss critical diagnostic info   | ALWAYS read full error             |
| Run `npm install` on any error                | Dependencies aren't the problem | Focus on code errors               |

---

## 7. Performance Tips

| Tip                                 | Benefit                                      |
| ----------------------------------- | -------------------------------------------- |
| Use `npm run build` before `test`   | Catch type errors faster (no runtime needed) |
| Write focused debug tests           | Isolate problems quickly                     |
| Use `console.log` strategically     | Trace execution flow                         |
| Check most likely cause first       | Import errors are most common                |
| Read template code before debugging | Understand expected behavior                 |
