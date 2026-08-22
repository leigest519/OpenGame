import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import type { Config } from '../config/config.js';
import { ToolNames, ToolDisplayNames } from './tool-names.js';
import { resolveProviderConfig } from '../services/providerConfig.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Game archetype based on physics classification
 */
export type GameArchetype =
  | 'platformer'
  | 'top_down'
  | 'grid_logic'
  | 'tower_defense'
  | 'ui_heavy'
  | 'threed_basic';

export interface GenerateGDDParams {
  /**
   * Raw user's game idea or description
   */
  raw_user_requirement: string;

  /**
   * Game archetype (REQUIRED) - determined by classify-game-type tool in Phase 1
   */
  archetype: GameArchetype;

  /**
   * Optional: Config summary if agent already read gameConfig.json
   * Tool will auto-load archetype-specific rules if not provided
   */
  config_summary?: string;
}

export function configMergeInstruction(archetype: GameArchetype): string {
  if (archetype === 'threed_basic') {
    return '- MERGE GDD Section 2 values INTO the existing `src/gameConfig.json`; every leaf must have a runtime consumer, and renamed or superseded leaves must be removed in the same edit. Derive authored counts from `SceneMap` arrays: do not add a config count leaf merely to mirror or assert an authored array `.length`; keep a count in config only when gameplay consumes it as a separate completion threshold.';
  }
  return '- MERGE GDD Section 2 values INTO the existing `src/gameConfig.json` -- add/update game-specific fields using `{ "value": X }` wrapper format, but NEVER delete infrastructure fields (`screenSize`, `renderConfig`, and Phaser\'s `debugConfig`)';
}

export function gameplaySemanticsInstruction(archetype: GameArchetype): string {
  if (archetype !== 'threed_basic') return '';
  return '5. **3D Gameplay Contract**: Do not default to the scaffold pickup loop unless the user asks for collection. Declare the player verbs, a repeatable 20-60 second core loop, one meaningful decision or skill demand, pressure and an observable failure condition, recovery/restart feedback, at least three escalating beats, and exact win/lose conditions. Write the loop as cue -> player action -> decision -> state change -> feedback -> repeat, not as theme prose. If the user explicitly requests a no-fail experience, state that constraint and define tension plus recovery/progression instead of inventing game over. Map every gameplay state and authored array to a final `GameScene` or DOM consumer. Public API limits forbid new external hooks, not private state inside `GameScene`; preserve explicit mechanics such as ordered or sequential objectives, and never weaken the user requirement to match the scaffold. Treat camera near/far as source literals unless the final code reads a named config leaf; fog or DPR leaves do not make camera far config-backed. For a branched choice, list intended neighbor pairs and forbidden cross-lane transitions under the player-radius-shrunk collision predicate, then play every branch and attempt any claimed blocked switch before calling the decision meaningful. Before calling the loop playable, add a Gameplay Feasibility Ledger with one complete winning trace and one losing or counterfactual trace. Each row must name the cue/deadline, required input or route, derived traversal/action time, resource or health delta, and resulting state. Label every trace DERIVED or OBSERVED; only the exact route, strategy, and terminal state exercised through keyboard/mouse input on the final uninstrumented artifact may be OBSERVED PASS. A substitute route, stand-in mechanic, or partial cycle proves only the shared transitions it actually exercised and must not upgrade the target trace to observed. Derived traces must carry state across escalation thresholds and recompute later timing/damage with the resulting beat or phase, rather than freezing the initial rate. Derive the budget from final SceneMap distances/timings and config speed/damage/recovery values; handled-action counts must equal the authored event count. Recompute the ledger after every tuning edit and reconcile the GDD body against the final uninstrumented playthrough; observed terminal values override conflicting estimates. Acceptance must preserve the declared win condition: never strengthen, replace, or contradict it, and optional objectives must not become pass gates. A complete-playthrough PASS must run against the final uninstrumented artifact; diagnostic probes must not be a prerequisite for PASS.';
}

export interface GDDModelConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  temperature?: number;
  timeout?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message: string;
  };
}

class GenerateGDDInvocation extends BaseToolInvocation<
  GenerateGDDParams,
  ToolResult
> {
  /** Lazily resolved on first access; see GameTypeClassifierTool for the rationale. */
  private resolvedModelConfig?: GDDModelConfig;

  constructor(
    private config: Config,
    params: GenerateGDDParams,
    private overrideModelConfig?: GDDModelConfig,
  ) {
    super(params);
  }

  private get modelConfig(): GDDModelConfig {
    if (this.overrideModelConfig) return this.overrideModelConfig;
    if (!this.resolvedModelConfig) {
      this.resolvedModelConfig = GenerateGDDTool.resolveModelConfig(
        this.config,
      );
    }
    return this.resolvedModelConfig;
  }

  getDescription(): string {
    return `Generate GDD for ${this.params.archetype}.`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    try {
      const systemPrompt = await this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt();

      const result = await this.callModel(systemPrompt, userPrompt, signal);
      const response = this.formatResult(result);

      const llmContent = `<gdd-content>
${response}
</gdd-content>

<system-reminder>
GDD GENERATED for archetype: **${this.params.archetype}**

## NOW: Save GDD
Save content between <gdd-content> tags to \`GAME_DESIGN.md\`

## Next Steps (follow GDD sections):

### Phase 3: Assets (use GDD Section 1)
- Read \`{DOCS_DIR}/asset_protocol.md\`
- Call \`generate_game_assets\` with the Asset Registry table from **GDD Section 1**
- Call \`generate_tilemap\` with ASCII maps from **GDD Section 4** (NOT for ui_heavy, tower_defense, grid_logic, or threed_basic)
- Read \`public/assets/asset-pack.json\` for generated texture keys

### Phase 4: Config (use GDD Section 2)
${configMergeInstruction(this.params.archetype)}

### Phase 5: Code Implementation (use GDD Sections 0, 3, 5)
- **GDD Section 0** has scene keys -> update \`LevelManager.ts\` and \`main.ts\`
- **GDD Section 3** has entity/scene specifications -> implement each file
- **GDD Section 5** has the step-by-step roadmap -> follow it as your todo list
- Read Module Manual \`{DOCS_DIR}/modules/${this.params.archetype}/${this.params.archetype}.md\` + ALL template source files BEFORE coding

### Phase 6: Verify
- Read \`{DOCS_DIR}/debug_protocol.md\`
- Build, test, run

DO NOT STOP. CONTINUE TO PHASE 3 NOW.
</system-reminder>`;

      return {
        llmContent,
        returnDisplay: this.formatDisplayOutput(response),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error generating GDD: ${errorMessage}`,
        returnDisplay: `**GDD Generation Failed**\n\nError: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }

  /**
   * Build system prompt by combining:
   * 1. Core GDD rules (docs/gdd/core.md) -- universal GDD format
   * 2. Design rules (docs/modules/{archetype}/design_rules.md) -- game design guide
   * 3. Template API (docs/modules/{archetype}/template_api.md) -- code capabilities
   */
  private async buildSystemPrompt(): Promise<string> {
    const projectRoot = this.config.getProjectRoot();
    const archetype = this.params.archetype;

    // Find docs directory
    let docsDir = '';
    let searchDir = projectRoot;
    while (searchDir !== path.dirname(searchDir)) {
      const candidate = path.join(searchDir, 'docs');
      try {
        await fs.access(candidate);
        docsDir = candidate;
        break;
      } catch {
        searchDir = path.dirname(searchDir);
      }
    }

    // Load core GDD rules
    let coreRules = '';
    if (docsDir) {
      try {
        coreRules = await fs.readFile(
          path.join(docsDir, 'gdd', 'core.md'),
          'utf-8',
        );
        console.log(`[GenerateGDD] Loaded core.md`);
      } catch {
        console.warn(`[GenerateGDD] core.md not found, using built-in`);
      }
    }

    // Load archetype-specific design rules (game designer perspective)
    let designRules = '';
    if (docsDir) {
      try {
        designRules = await fs.readFile(
          path.join(docsDir, 'modules', archetype, 'design_rules.md'),
          'utf-8',
        );
        console.log(`[GenerateGDD] Loaded ${archetype}/design_rules.md`);
      } catch {
        console.warn(`[GenerateGDD] ${archetype}/design_rules.md not found`);
      }
    }

    // Load archetype-specific template API (code capabilities)
    let templateApi = '';
    if (docsDir) {
      try {
        templateApi = await fs.readFile(
          path.join(docsDir, 'modules', archetype, 'template_api.md'),
          'utf-8',
        );
        console.log(`[GenerateGDD] Loaded ${archetype}/template_api.md`);
      } catch {
        console.warn(`[GenerateGDD] ${archetype}/template_api.md not found`);
      }
    }

    // Build combined prompt
    let prompt = `# Game Design Document Generator

You are a game design engineer. Produce a **Technical Game Design Document** — a specification where every section maps to a downstream tool input or code file.

**Archetype**: ${archetype}

**Core Rules:**
1. **User-Faithful**: Fulfill stated requirements. Do not invent unasked features.
2. **Config-First**: Numeric values go in \`gameConfig.json\` using \`{ "value": X }\` wrapper.
3. **Zero Custom Code**: Use existing behaviors/hooks from template_api.md only.
4. **Hook Integrity**: Every hook name MUST exist in template_api.md. Non-existent hooks cause compilation failure.

`;

    const semanticsInstruction = gameplaySemanticsInstruction(archetype);
    if (semanticsInstruction) prompt += `${semanticsInstruction}\n\n`;

    if (coreRules) {
      prompt += `---\n\n## Universal GDD Rules\n\n${coreRules}\n\n`;
    } else {
      prompt += this.getBuiltinCoreRules();
    }

    if (designRules) {
      prompt += `---\n\n## ${archetype.toUpperCase()} Design Guide\n\n${designRules}\n\n`;
    } else {
      prompt += this.getBuiltinArchetypeRules(archetype);
    }

    if (templateApi) {
      prompt += `---\n\n## ${archetype.toUpperCase()} Template Capabilities\n\n${templateApi}\n\n`;
    }

    return prompt;
  }

  private getBuiltinCoreRules(): string {
    return `---

## Universal GDD Rules (Built-in)

### GDD Structure (6 Sections)
| Section | Title | Downstream Consumer |
|---------|-------|-------------------|
| 0 | Technical Architecture | LevelManager.ts, main.ts |
| 1 | Visual Style & Asset Registry | generate_game_assets tool |
| 2 | Game Configuration | gameConfig.json (MERGE, not replace) |
| 3 | Entity/Scene Architecture | Template files — behavior composition |
| 4 | Level/Content Design | generate_tilemap tool or content data |
| 5 | Implementation Roadmap | File-level task list |

### Asset Table Format
| type | key | description | params |
|------|-----|-------------|--------|
| background | level_bg | [description] | resolution: "1536*1024" |
| animation | player | [SIDE VIEW facing RIGHT] | idle(2), run(2) |
| image | hero_neutral | [FRONT VIEW bust shot] | **(none)** |
| audio | jump_sfx | [sound description] | audioType: "sfx" |

\`type: "image"\` params must ALWAYS be empty. One character per image.

### Forbidden
- "Implement from scratch" — use existing behaviors/hooks
- Unspecified numeric values — write exact numbers
- Inventing hook names not in template_api.md

`;
  }

  private getBuiltinArchetypeRules(archetype: GameArchetype): string {
    const rules: Record<GameArchetype, string> = {
      platformer: `---

## Platformer Rules (Built-in)

### Physics
- Gravity: ON (Y-axis), side view, Left/Right + Jump

### Available Behaviors
- PlatformerMovement (walkSpeed, jumpPower; optional: doubleJumpEnabled, coyoteTime, jumpBufferTime)
- MeleeAttack (damage, range, cooldown)
- RangedAttack (damage, projectileKey, projectileSpeed)
- PatrolAI, ChaseAI

### Ultimate Skills (pick one per character)
DashAttackSkill, AreaDamageSkill, TargetedAOESkill, TargetedExecutionSkill, BeamAttackSkill, GroundQuakeSkill, BoomerangSkill, MultishotSkill, ArcProjectileSkill. All share base config: id, name, cooldown.

### Level Design (ASCII)
- Legend: # = Ground, = = Platform, . = Air, P = Player, E = Enemy, B = Boss, C = Coin
- Entities FALL. Don't place enemies in mid-air.
- MUST copy from predefined templates (A/B/C/D), NEVER invent from scratch

### Config Schema
\`\`\`json
{
  "playerConfig": {
    "maxHealth": { "value": 100 }, "walkSpeed": { "value": 360 },
    "jumpPower": { "value": 2400 }, "attackDamage": { "value": 40 },
    "gravityY": { "value": 1200 }, "hurtingDuration": { "value": 100 },
    "invulnerableTime": { "value": 1000 }
  },
  "enemyConfig": { "maxHealth": { "value": 50 }, "walkSpeed": { "value": 80 }, "damage": { "value": 20 } },
  "bossConfig": { "maxHealth": { "value": 200 }, "damage": { "value": 35 }, "speed": { "value": 120 } },
  "ultimateConfig": { "cooldown": { "value": 5000 }, "damage": { "value": 80 } }
}
\`\`\`
All values use \`{ "value": X, "type": "...", "description": "..." }\` wrapper format.

### Hook Integrity
Every hook name MUST exist in template_api.md. Do NOT invent hooks.
`,
      top_down: `---

## Top-Down Rules (Built-in Fallback)

### Sub-Mode Detection (decide FIRST)
| Sub-Mode | Base Class | World Model |
|----------|-----------|-------------|
| **tilemap** | \`BaseLevelScene\` | ASCII tilemap, dual tilesets, camera follow |
| **arena** | \`BaseArenaScene\` | Fixed screen, scrolling bg, wave spawning |
Default: tilemap. Arena keywords: space shooter, bullet hell, survival, endless, waves, scrolling.

### Physics
Zero gravity, 8-way WASD movement, 360° mouse aim, dash with i-frames.

### Tilemap Level Design
- Copy Templates A/B/C/D verbatim. Call \`generate_tilemap\` TWICE per level (mode: "floor" + mode: "walls").
- Do NOT pass \`tileset_grid_size\`. Camera zoom: 0.6-0.8.

### Arena Level Design
- NO tilemap. Scrolling bg or solid color. Enemies spawned dynamically via \`spawnEnemy()\`.

### Config
Default import: \`import gameConfig from '../gameConfig.json'\`. Wrapper format: \`{ "value": X }\`.

### Implementation
1. UPDATE LevelManager.ts + main.ts
2. COPY _TemplatePlayer.ts -> Player. Override \`playAnimation()\` (directional sprites).
3. REFERENCE _TemplateEnemy.ts -> Enemy. Override \`getAnimationKey()\`.
4. TILEMAP: COPY _TemplateLevel.ts. ARENA: COPY _TemplateArena.ts.
5. Character art: TOP-DOWN view, 3 directions per action, frameCount: 1.

### Hook Integrity
Every hook name MUST exist in template_api.md. Do NOT invent hooks.
`,
      grid_logic: `---

## Grid Logic Rules (Built-in)

### Sub-Type Detection (decide FIRST)
| Sub-Type | Timing Mode | Input | Examples |
|----------|-------------|-------|----------|
| **puzzle** | \`step\` | Arrow keys | Sokoban, sliding puzzles, Baba Is You |
| **tactics** | \`turn\` | Click select + move | Fire Emblem, Into the Breach, chess |
| **match** | \`freeform\` | Click/swap cells | Candy Crush, Bejeweled |
| **arcade** | \`realtime\` | Arrow keys (timed) | Snake, Pac-Man, Tetris |
| **roguelike** | \`step\` | Arrow + Spacebar | Mystery Dungeon, Shiren, dungeon crawlers |
Default: puzzle (step mode). Roguelike is puzzle with combat/enemy AI.

### Physics & Movement
- Gravity: None (all movement is discrete grid steps)
- No physics engine -- all collision/movement is manual grid logic
- Entities snap to grid positions (no sub-cell positions)
- Input is locked during processing pipeline (auto-managed)
- All game state lives in BoardManager (2D cell array + entity tracking)
- Entities have optional \`facingDirection\` (up/down/left/right) for directional attacks

### Core Loop (Three-Phase Pipeline)
Player Input -> Player Phase -> World Phase -> Enemy Phase -> Check Win/Lose -> Repeat.

The processing pipeline runs automatically after each player action:
1. **Player Phase** (\`onProcessComplete\`): resolve player action, enqueue animations
2. **World Phase** (\`onWorldPhase\`): traps activate, tiles transform, items collected
3. **Enemy Phase** (\`onEnemyPhase\`): enemy AI takes steps, periodic effects emit
4. Win/Lose check after all three phases complete
5. Chain reaction loop (\`onMoveProcessed\`) for cascading effects (Match-3)

### Grid System
- Grid defined in CODE (NOT via generate_tilemap tool)
- Background image for visual layer; grid lines rendered by code overlay
- Cell types: EMPTY(0), WALL(1), FLOOR(2), GOAL(3), HAZARD(4), SPAWN(5), SPECIAL(6), ICE(7), PORTAL(8)
- ICE(7): slippery surface -- entity slides until stopped (wall, entity, non-ICE cell)
- PORTAL(8): teleportation pad -- paired with another portal by shared ID
- Typical grid: 6-16 cols x 6-16 rows, cellSize 64px
- Grid is centered on screen via offsetX/offsetY calculation
- Why NOT tilemap: grid cells change at runtime (holes fill, doors open, items collected). BoardManager is the single source of truth; a tilemap would create dual-data sync issues.

### Entity System
- Entities are grid-bound sprites with discrete positions
- Each entity has: id, entityType, textureKey, gridX, gridY, facingDirection
- Flags: isWalkable, isPushable, isDestructible
- Optional HP: maxHealth > 0 enables combat system (health, takeDamage, onDamage, onDeath)
- Common types: player, box, enemy, item, goal, bomb, portal

### Combat System (Optional -- for roguelike/tactics)
- Entity HP: set \`maxHealth > 0\` in GridEntityConfig to enable
- Bump attack: move into enemy cell = attack instead of move (use \`damageEntity()\`)
- Ranged attack: use \`getCellsInDirection(x, y, facingDirection, range, w, h)\` to find targets
- Area effects: use \`getCellsInRadius(x, y, radius, w, h)\` for splash/AoE
- Death handling: \`onEntityDeath(entity)\` hook fires when HP reaches 0
- Cooldowns: track via turn number in \`onStep(turnNumber)\` hook

### Interactive Tiles
- \`onEntityEnteredCell(entity, gridX, gridY, cellType)\` fires automatically after \`moveEntity()\`
- Use for: traps (HAZARD damages player), stealth (SPECIAL hides from enemies), keys (collect items), holes (box fills HAZARD->FLOOR)
- Cell types can be changed at runtime: \`boardManager.setCell(x, y, newCellType)\`

### Advanced Puzzle Mechanics (Optional)

**Sliding (Ice Physics)**:
- Use \`slideEntity(entity, direction, shouldStop, stepDuration?)\` to slide an entity continuously
- \`shouldStop(nextX, nextY)\` callback returns true when the entity should stop (wall, non-ICE, blocking entity)
- Fires \`onEntityEnteredCell\` at every intermediate cell (enables mid-slide interactions: traps, portals, items)
- Typical usage: in \`onDirectionInput\`, after moving player to an ICE cell, call \`await this.slideEntity(player, direction, ...)\`

**Teleportation (Portal Pairs)**:
- PORTAL(8) cells come in pairs with a shared ID
- Implement via \`onEntityEnteredCell\`: detect PORTAL cell, find paired portal entity, call \`moveEntity(entity, pairedX, pairedY, false)\`
- Portals are entities with \`isWalkable: true\` and a custom \`portalPairId\` property
- One-way per step: arriving at destination portal does NOT re-teleport

**Elemental Interaction (Environment Conduction)**:
- Ability hits different cell types/entity types for different effects
- Electric + Water(HAZARD): use \`getCellsInRadius()\` for AOE damage to all entities near the water
- Electric + Mechanical(entity): use \`boardManager.setCell()\` to open doors, toggle switches
- Implement in \`onActionInput()\`: check target cell type and entity type, apply context-sensitive effects

**Turrets (Turn-Based Auto-Fire)**:
- Turret entities fire in a fixed direction every N turns during Enemy Phase
- Use \`onStep(turnNumber)\`: if \`turnNumber % fireInterval === 0\`, scan \`getCellsInDirection()\`, damage first entity hit
- Players must time movement to avoid turret fire patterns (timing puzzle)

### Enemy AI (via Enemy Phase)
- Call \`stepAllEntities()\` or \`stepEntitiesOfType(type)\` in \`onEnemyPhase()\`
- Each entity's \`onStep(turnNumber)\` runs its AI logic
- Chaser AI: use \`findPath()\` (A*) to move toward player
- Patrol AI: track direction in entity state, reverse on wall
- Area emitter: use turn number modulo for periodic effects
- Vision check: use \`hasLineOfSight()\` and \`manhattanDistance()\`

### Undo System
- Built-in undo stack (BoardManager.pushState/popState)
- Call \`saveUndoState()\` BEFORE each move
- Z key triggers undo; UI undo button emits \`undoRequested\` event (auto-handled)

### Animation Queue
- Sequential and parallel animation support
- Input auto-locked during entire pipeline
- Factory methods: move, movePath, fade, scale, destroy, shake, popIn, bounce, delay

### Controls
- Arrow Keys / WASD: Trigger \`onDirectionInput(direction)\` hook
- Spacebar: Trigger \`onActionInput()\` hook (abilities, ranged attacks, interactions)
- Left Click: Trigger \`onCellClicked()\` / \`onEntityClicked()\` hooks
- Z: Undo last move
- ESC: Pause menu

### UI Events (Game Scene -> UIScene)
- \`hpChanged\` (current, max): show hearts display
- \`statusChanged\` (text): show status line (energy, inventory, cooldown)
- \`moveCountChanged\`, \`turnChanged\`, \`scoreChanged\`, \`undoAvailable\`, \`showLevelTitle\`

### Config Schema
\`\`\`json
{
  "gridConfig": {
    "cellSize": { "value": 64, "type": "number", "description": "Grid cell size in pixels" },
    "gridWidth": { "value": 10, "type": "number", "description": "Grid width in cells" },
    "gridHeight": { "value": 10, "type": "number", "description": "Grid height in cells" },
    "maxMoves": { "value": -1, "type": "number", "description": "Max moves (-1 = unlimited)" },
    "animationSpeed": { "value": 200, "type": "number", "description": "Move animation duration ms" },
    "inputDebounceMs": { "value": 150, "type": "number", "description": "Keyboard input debounce ms" }
  }
}
\`\`\`

### Implementation
1. UPDATE LevelManager.ts + main.ts with scene keys
2. COPY _TemplateEntity.ts for each entity type (player, box, enemy, etc.)
3. COPY _TemplateGridLevel.ts for each level, implement all abstract methods
4. Entity art: TOP-DOWN view (puzzle/tactics/arcade/roguelike) or FRONT-FACING (match-3)
5. Grid logic does NOT use generate_tilemap -- maps are code-defined grids

### Visual Setup (in createEnvironment)
1. Background: use \`createBackground()\` for full-screen coverage
2. Grid lines: use \`drawGridLines()\` with subtle alpha (0.1-0.15)
3. Terrain sprites: use \`createTerrainVisuals()\` to place cell-type images (ice, puddles, portals, generators)
4. Terrain animations: portals rotate, goals pulse, items float
5. Use \`GridDepth\` constants for consistent layering (BACKGROUND=-10, GRID_LINES=-5, CELL_TERRAIN=-4, ENTITY=0, VFX=10)
6. Entity sizing: set \`sizeFactor\` per entity type (player 0.8, crate 0.85, enemy 0.75, item 0.5)

### Hook Integrity
Every hook name MUST exist in template_api.md. Do NOT invent hooks.
Grid Logic does NOT use generate_tilemap -- maps are code-defined grids.
`,
      tower_defense: `---

## Tower Defense Rules (Built-in)

### Physics & Perspective
- Top-down perspective, zero gravity
- Enemies follow predefined waypoint paths (NOT free movement)
- Towers are static grid-placed objects (NOT player-controlled)
- Projectiles travel from tower to enemy with physics velocity
- No player character -- all interaction is mouse click

### Core Loop
Place towers -> Defend against waves -> Earn gold -> Upgrade/expand -> Repeat.
Win = survive all waves. Lose = lives reach 0 (too many enemies reach exit).

### Grid System
- Map is a 2D grid of CellType values: BUILDABLE(0), PATH(1), BLOCKED(2), SPAWN(3), EXIT(4)
- Grid defined in code (NOT via generate_tilemap tool)
- Background image generated via generate_game_assets for visual layer
- Grid overlay rendered on top for gameplay clarity
- Typical grid: 12-18 columns x 8-12 rows, cellSize 64px

### Tower Design
- 3-5 distinct tower types per game (Basic, AOE/Splash, Sniper, Slow/Utility, Rapid)
- Each tower has: cost, damage, range, fireRate, projectileKey, targetingMode, upgrades[]
- Targeting modes: 'first' (furthest on path), 'last', 'closest', 'strongest'
- 3 upgrade levels per tower (base + 2 upgrades)
- Splash damage: set splashRadius on projectile in createProjectile() hook
- Slow effect: set slowAmount + slowDuration on projectile, apply via onProjectileHitEnemy override

### Enemy Design
- Enemies follow waypoints from SPAWN to EXIT
- Types: Basic (cannon fodder), Fast (low HP high speed), Tank (high HP slow), Swarm (tiny HP, many), Boss (extreme HP)
- Each enemy has: maxHealth, speed, reward (gold), damage (lives lost on exit)
- Status effect system: enemies can be slowed (speed multiplier + duration + tint)

### Wave Design
- Waves contain groups of enemies with spawn intervals
- Progressive difficulty: increase count, decrease interval, mix tougher types
- Boss waves every 5 waves or as final wave
- preDelay for first wave, timeBetweenWaves for gaps

### Economy
- Single currency (gold/kibble/coins)
- Income: enemy kill rewards + wave clear bonuses
- Spending: tower placement + tower upgrades
- Sell refund: 70% of total invested (configurable)

### Controls
- Left Click: place tower (with type selected) or interact with existing tower
- Right Click / ESC: cancel tower selection
- Spacebar: force start next wave
- ESC: pause menu

### Config Schema
\`\`\`json
{
  "towerDefenseConfig": {
    "startingGold": { "value": 100, "type": "number", "description": "Gold player starts with" },
    "startingLives": { "value": 20, "type": "number", "description": "Lives before game over" },
    "cellSize": { "value": 64, "type": "number", "description": "Grid cell size in pixels" },
    "timeBetweenWaves": { "value": 5000, "type": "number", "description": "Delay ms between waves" },
    "sellRefundRate": { "value": 0.7, "type": "number", "description": "Fraction refunded on sell" }
  }
}
\`\`\`

### Implementation
1. UPDATE LevelManager.ts + main.ts with scene keys
2. COPY _TemplateTower.ts for each tower type, fill TowerTypeConfig + hook overrides
3. COPY _TemplateTDEnemy.ts for each enemy type, fill TDEnemyConfig + hook overrides
4. COPY _TemplateTDLevel.ts for each level, implement all 6 abstract methods
5. Tower art: TOP-DOWN view, clear silhouette, upgrade variants optional
6. Enemy art: TOP-DOWN view, directional animation optional

### Hook Integrity
Every hook name MUST exist in template_api.md. Do NOT invent hooks.
Tower Defense does NOT use generate_tilemap -- maps are code-defined grids.
`,
      ui_heavy: `---

## UI Heavy Rules (Built-in)

### Physics
- Minimal/None
- Click/tap interactions
- State machine driven

### Design Focus
- UI panels and layouts
- Card/button interactions
- Dialogue systems

### Scene Flow
- TitleScreen uses LevelManager.getFirstLevelScene() to determine first scene
- LEVEL_ORDER[0] MUST be updated to the actual first game scene
- All scenes MUST be registered in main.ts

### Implementation Roadmap Requirements
1. ALWAYS start with: UPDATE LevelManager.ts and main.ts
2. ALWAYS specify which _Template*.ts to COPY for each scene
3. ALWAYS list the exact scene key strings
4. For PVP games: use _TemplateDualBattle.ts, set useTurnCycle = false, build mouse-click buzzer buttons
5. For quiz/educational games: use QuizModal component for question display (prevents double-click bugs)

### Exported Types (use EXACT names)
- BaseBattleScene: CardConfig, QuizQuestion, EnemyBattleConfig, BattlePhase, CardType
- BaseChapterScene: DialogueEntry, ChoiceOption, ChapterCharacterConfig
- BaseEndingScene: EndingData, EndingType (NOT EndingConfig!)
- BaseCharacterSelectScene: SelectableCharacter, GridConfig

### Hook Integrity Rule (CRITICAL)
- Every hook name you reference in the GDD MUST exist in template_api.md
- Do NOT invent new hooks (e.g., onRoundStart, onBuzzerPressed, onAnswerSelected, onTimeout do NOT exist)
- If template_api.md doesn't list a hook, it DOES NOT EXIST -- design around existing hooks only

`,
      threed_basic: `---

## Three.js Basic Rules (Built-in)

- Runtime: pinned three.js + TypeScript + Vite; do not import Phaser.
- World: primitives/custom low-poly geometry, one PerspectiveCamera, ambient + directional light, fog, and a sky texture.
- Input: WASD/arrows + mouse; ESC uses the existing DOM pause contract. No touch controls.
- Gameplay: one short, explicit core loop with player verbs, pressure/failure, feedback, escalation, and reachable win/lose states; collection is only the reference fallback.
- Collision: manual bounds/proximity only. Do not add a physics engine.
- Assets: use generate_game_assets only for skybox/texture/billboard/floor patch images. No models, GLB/FBX/OBJ, text-to-3D, or generate_tilemap.
- Architecture: keep main.ts RAF wiring; put declarative positions in SceneMap.ts and rendering/gameplay in GameScene.ts.
- Required verification: build, WebGL context, non-black canvas, zero console errors, and ESC pause/resume.
`,
    };

    return rules[archetype] || '';
  }

  private buildUserPrompt(): string {
    const archetype = this.params.archetype;

    let prompt = `**User's Game Idea**: ${this.params.raw_user_requirement}

**Archetype**: ${archetype}

Generate a Technical GDD with **6 sections** (Section 0–5) following the structure defined in the GDD Core Rules above. Be specific — the coding agent should never need to guess.

**Section-specific guidance:**

### Section 1 — Asset Registry
${this.getAssetGuidance(archetype)}

### Section 2 — Game Configuration
MERGE into existing \`src/gameConfig.json\`. Write only game-specific values — do NOT include screenSize, debugConfig, renderConfig.

### Section 3 — ${this.getSection3Title(archetype)}
${this.getSection3Guidance(archetype)}

### Section 4 — ${this.getSection4Title(archetype)}
${this.getSection4Guidance(archetype)}`;

    if (this.params.config_summary) {
      prompt += `\n\n**Current Config Summary**:\n${this.params.config_summary}`;
    }

    return prompt;
  }

  private getAssetGuidance(archetype: GameArchetype): string {
    const guidance: Record<GameArchetype, string> = {
      platformer: `**Platformer asset rules:**
- Characters: \`type: "animation"\`, SIDE VIEW facing RIGHT, **ONE character per image**, frames: \`idle(2), run(2), jump(2), attack_1(2), attack_2(2), die(2)\`
- Backgrounds: \`type: "background"\`, one per level, \`resolution: "1536*1024"\`. Keep clean — no characters or platforms
- Tilesets: \`type: "tileset"\`, \`tileset_size: 3\` (3x3 grid). Keep simple — complex bricks clutter the scene
- Projectiles/effects: \`type: "image"\` for skill projectiles (hammer, missile, boulder) or ranged bullets
- Audio: BGM per level + SFX for jump, attack, damage, death, coin, victory, ultimate`,

      ui_heavy: `**UI Heavy asset rules:**
- Characters: \`type: "image"\` (NOT animation!), FRONT VIEW bust shot, one image PER expression
- Naming: \`{character}_{expression}.png\` (e.g., hero_neutral, hero_angry)
- Backgrounds: \`type: "background"\`, one per scene, \`resolution: "1536*1024"\`
- Audio: include BGM per scene type + SFX for click, correct, wrong, damage, victory`,

      top_down: `**Top-Down asset rules** (see Design Guide Sections 4-5 for full art direction):
- Characters: \`type: "animation"\`, TOP-DOWN view, **ONE character per image**, 3 directional images per action (\`{name}_{action}_front/back/side\`), each with \`frameCount: 1\`
- **TILEMAP sub-mode**: TWO \`type: "tileset"\` per theme (\`{theme}_floor\` + \`{theme}_walls\`, both \`tileset_size: 3\`), plus 2-3 obstacle \`type: "image"\` + 1-2 decoration \`type: "image"\`
- **ARENA sub-mode**: NO tilesets. 1 \`type: "background"\` (\`resolution: "1536*1024"\`, seamlessly tileable for scrolling)
- Audio: BGM per level + SFX for combat actions`,

      grid_logic: `**Grid Logic asset rules:**
- **Background**: \`type: "background"\`, one per level, \`resolution: "1536*1024"\`. Top-down view of the environment (dungeon floor, garden, abstract board). The code renders a grid overlay on top of this image. Description should depict the ENTIRE map surface (e.g., "dark stone dungeon floor with subtle cracks, top-down view").
- **Player**: \`type: "image"\` (static) or \`type: "animation"\` (animated), TOP-DOWN view for puzzle/tactics/arcade/roguelike, FRONT-FACING for match-3. **ONE character per image.** \`type: "image"\` ONLY passes \`key\` and \`description\`.
- **Entities**: \`type: "image"\`, one per entity type. TOP-DOWN view. Names: \`box\`, \`gem_red\`, \`enemy_chaser\`, etc. Clear, distinct silhouettes. **ONLY pass \`key\` and \`description\` -- NO \`size\`, NO \`resolution\`.**
- **Match-3 Pieces**: \`type: "image"\`, 5-7 distinct piece types. FRONT-FACING icons. Names: \`piece_1\` through \`piece_N\`. Unique shape AND color each. **ONLY pass \`key\` and \`description\`.**
- **Cell Visuals** (optional): \`type: "image"\` for special cell types. Names: \`cell_goal\`, \`cell_hazard\`, \`cell_ice\`, \`cell_portal\`. Placed by code at grid positions. **ONLY pass \`key\` and \`description\`.**
- **UI Elements**: \`type: "image"\` for icons. Names: \`icon_move\`, \`icon_hp\`, \`icon_score\`. **ONLY pass \`key\` and \`description\`.**
- **Audio**: BGM per level + SFX for move, push, collect, attack, damage, match, win, lose, undo. Use \`audioType: "sfx"\` or \`audioType: "bgm"\`.
- **NO tilesets needed**: Grid logic maps use code-defined grids with a background image, NOT tilemaps. Do NOT generate tileset assets.

**CRITICAL -- \`type: "image"\` parameter rule**: The ONLY accepted parameters are \`type\`, \`key\`, and \`description\`. Do NOT pass \`size\`, \`resolution\`, or any other parameter.`,

      tower_defense: `**Tower Defense asset rules:**
- **Background**: \`type: "background"\`, one per level, \`resolution: "1536*1024"\`. Description should depict the ENTIRE map environment from top-down view (e.g., "wooden floor with scattered toys, top-down view"). This is the visual base layer; grid/path overlay is rendered by code on top.
- **Towers**: \`type: "image"\`, TOP-DOWN view, **ONE tower per image**, clear silhouette, centered on canvas. Name: \`tower_{type}\`. Optional upgrade variants: \`tower_{type}_lv2\`, \`tower_{type}_lv3\`. **ONLY pass \`key\` and \`description\` -- NO \`size\`, NO \`resolution\`.**
- **Tower Slot**: \`type: "image"\`, name \`tower_slot\`. Visual placeholder for buildable cells. **ONLY pass \`key\` and \`description\`.**
- **Enemies**: \`type: "image"\` (static) or \`type: "animation"\` (animated walk), TOP-DOWN view, **ONE enemy per image**. Name: \`enemy_{type}\`. For animation: use 1-frame directional images (\`{name}_walk_front\`, \`{name}_walk_side\`) or 2-frame walk cycle. **\`type: "image"\` ONLY passes \`key\` and \`description\`.**
- **Projectiles**: \`type: "image"\`, small items (beans, arrows, cannonballs). Name: \`proj_{type}\`. Code auto-scales to 16px -- do NOT specify size or resolution. **ONLY pass \`key\` and \`description\`.**
- **UI elements**: \`type: "image"\` for tower icons, currency icons, spawn/exit markers. Name: \`icon_{name}\`. **ONLY pass \`key\` and \`description\`.**
- **Audio**: BGM per level + SFX for tower fire, enemy death, wave start, tower place, tower sell, game over. Use \`audioType: "sfx"\` or \`audioType: "bgm"\`.
- **NO tilesets needed**: Tower defense maps use code-defined grids with a background image, NOT tilemaps. Do NOT generate tileset assets.

**CRITICAL -- \`type: "image"\` parameter rule**: The ONLY accepted parameters are \`type\`, \`key\`, and \`description\`. Do NOT pass \`size\`, \`resolution\`, or any other parameter. The output is always 386*560 PNG; game code handles scaling. This applies to ALL image assets: towers, enemies, projectiles, icons, tower slots.

**Correct tower_defense image examples:**
\`\`\`json
{ "type": "image", "key": "tower_spitfire", "description": "Top-down view of a cute orange tabby cat sitting upright on a cushion, looking alert" }
{ "type": "image", "key": "proj_tapioca", "description": "A black tapioca pearl with sticky, glistening texture" }
{ "type": "image", "key": "icon_tower_tabby", "description": "Icon for Spitfire Tabby tower selection UI: small version of tabby cat" }
{ "type": "image", "key": "tower_slot", "description": "A round stone platform with subtle moss, top-down view" }
\`\`\``,
      threed_basic: `**Three.js image asset rules:**
- Skybox: \`type: "background"\`, key \`skybox_texture\`, equirectangular, \`resolution: "1024*1024"\`.
- Floor patch/surface: \`type: "image"\`, key \`floor_patch\`; declare runtime \`displaySize\` in the GDD, never pass it to the tool.
- Interactive/objective billboard: \`type: "image"\`, one centered subject and a semantic key; \`energy_billboard\` is only the collection scaffold fallback.
- Keep source/display size <= 1024*1024. Colormap only matte art; never glossy/translucent/emissive/sky art.
- Every generated image must remain in asset-pack.json. Do not request models, meshes, normal maps, or text-to-3D output.`,
    };
    return guidance[archetype] || '';
  }

  private getSection3Title(archetype: GameArchetype): string {
    const titles: Record<GameArchetype, string> = {
      platformer: 'Entity Architecture (Behavior Composition)',
      ui_heavy: 'Scene Architecture (Scene-by-Scene Specification)',
      top_down: 'Entity Architecture (Behavior Composition)',
      grid_logic: 'Entity Architecture (Grid Logic)',
      tower_defense: 'Entity Architecture (Towers & Waves)',
      threed_basic: '3D Scene Architecture (SceneMap + GameScene)',
    };
    return titles[archetype] || 'Entity Architecture';
  }

  private getSection3Guidance(archetype: GameArchetype): string {
    const guidance: Record<GameArchetype, string> = {
      platformer: `Define every entity with its behavior composition. This maps directly to code files.

**For Player** (\`src/characters/Player.ts\`):
- Base class: \`BasePlayer\`
- Behaviors: PlatformerMovement (required), MeleeAttack (optional), RangedAttack (optional), one Ultimate skill (optional)
- \`animKeys\` mapping: idle, walk, jumpUp, jumpDown always needed; punch, kick if melee; shoot if ranged; ultimate if skill
- Hook overrides: \`onDamageTaken\`, \`onDeath\`, etc. -- list WHAT each does

**For each Enemy** (\`src/characters/EnemyName.ts\`):
- Base class: \`BaseEnemy\`, \`aiType\`: 'patrol' | 'chase' | 'stationary' | 'custom'
- Stats: maxHealth, speed, damage (exact numbers)

**For Boss** (if applicable):
- \`aiType: 'custom'\`, phase descriptions (at >X% HP do Y, at <X% HP do Z)

Use only behaviors and hooks that serve the game's requirements. Refer to the design guide and template API for available skill types and config params.`,

      ui_heavy: `Define every scene with its EXACT hook implementations. This maps directly to code files.

**Character Select scenes** (player picks character/avatar):
- Base class: \`BaseCharacterSelectScene\`, Template: \`_TemplateCharacterSelect.ts\`
- Scene key: exact string (e.g., \`"CharSelectScene"\`)
- \`getSelectableCharacters()\`: array of { id, name, description, imageKey, stats? } (REQUIRED)
- \`getNextSceneKey()\`: scene to transition to after selection
- \`onCharacterSelected(character)\`: custom logic on confirm (e.g., store P2 choice in PVP)
- \`shouldAutoTransition()\`: return false for PVP sequential pick mode
- \`playSelectSound()\`, \`playConfirmSound()\`: SFX hooks
- For PVP: override shouldAutoTransition() -> false, in onCharacterSelected() store P1 choice then call resetForNextPick(index), update this.titleText for P2, then store P2 choice and call triggerTransition()

**Chapter scenes** (narrative/dialogue):
- Base class: \`BaseChapterScene\`, Template: \`_TemplateChapter.ts\`
- Scene key: exact string (e.g., \`"IntroScene"\`)
- \`initializeDialogues()\`: FULL dialogue array -- every DialogueEntry with type, speaker, text, expression
- \`createCharacters()\`: each character with id, textureKey, displayName, expressions map
- \`onChapterComplete()\`: exact scene transition (\`this.scene.start('NextSceneKey')\`)

**Battle scenes** (combat/quiz):
- Base class: \`BaseBattleScene\`, Template: \`_TemplateBattle.ts\` or \`_TemplateDualBattle.ts\` (PVP)
- Scene key: exact string
- \`initializeBattle()\`: set playerHP, enemyHP, create QuizModal if using quiz mechanics (REQUIRED)
- \`createHUD()\`: create StatusBar for HP, score display, round counter
- \`getCardDeck()\`: list every card -- id, name, type, value, description (for card battles)
- \`getQuestionBank()\`: list every question -- question, options[4], correctIndex, explanation (for quiz battles)
- \`getEnemyConfig()\`: name, maxHP, textureKey, damageRange
- \`onBattleEnd(result)\`: scene transition based on win/lose
- **Quiz display**: Use \`QuizModal\` component from \`ui/\` for question/answer display -- it handles layout, timer, and prevents double-click bugs. Create it in \`initializeBattle()\` and call \`quizModal.showQuestion(question)\` in \`onQuizPhaseStart()\`
- **Custom questions**: Define questions in \`getQuestionBank()\`. If the game needs custom subject-specific questions, add them directly to this array -- the template manages selection and no-repeat logic
- **PVP battles**: use \`_TemplateDualBattle.ts\`, set useTurnCycle = false. For mouse-click PVP, build custom buzzer buttons in createHUD() and use QuizModal for answer display

**Ending scenes** (game completion):
- Base class: \`BaseEndingScene\`, Template: \`_TemplateEnding.ts\`
- \`getEndingData()\`: type ('victory'|'defeat'), title, description, background
- \`onContinue()\`: where to navigate

**CRITICAL -- Hook Integrity**: 
Only reference hooks that EXIST in template_api.md. Do NOT invent hooks like onRoundStart, onBuzzerPressed, onAnswerSelected, onTimeout -- these DO NOT EXIST. If a hook is not listed in template_api.md, it does not exist and must not be referenced.

These scene types are all **plug-and-play modules**. Use only the types the game needs -- a visual novel needs only Chapter + Ending; a quiz game needs only Battle + Ending.`,

      top_down: `Define every entity with behavior composition. Refer to Template Capabilities for available hooks, behaviors, and scene groups.

**For each Player** (COPY _TemplatePlayer.ts):
- textureKey, stats (from gameConfig), animKeys (base keys from animations.json), combat config, dash config
- MANDATORY: \`playAnimation()\` override for directional sprites (see Template Capabilities)
- List each hook override with WHAT it does (e.g., "onDamageTaken: camera shake + hurt sound")
- Sound properties: \`this.shootSound\`, \`this.hurtSound\`, etc. (NOT \`this.sounds.xxx\`)

**For each Enemy** (REFERENCE _TemplateEnemy.ts):
- aiType, stats, combat mode (melee/ranged)
- MANDATORY: \`getAnimationKey()\` override for directional sprites
- For chase AI: note "call setTarget(this.player) after creation"

**For each Level Scene**:
- **TILEMAP**: COPY _TemplateLevel.ts -> list abstract methods: setupMapSize, createEnvironment, createEntities
- **ARENA**: COPY _TemplateArena.ts -> list abstract methods: createBackground, createEntities, spawnEnemy; plus hook overrides: onEnemyKilled (MUST call super), getSpawnInterval, onBossSpawn

Refer to Design Guide Section 7 for screen shake rules, Template Capabilities Section 4 for complete hook tables.`,
      grid_logic: `Define every entity type and level scene with EXACT configurations. This maps directly to code files.

**Sub-Type**: Specify which sub-type (puzzle/tactics/match/arcade/roguelike) and the corresponding \`TurnManagerConfig.mode\` (step/turn/freeform/realtime).

**For each Entity Type** (COPY \`_TemplateEntity.ts\` -> \`EntityName.ts\`):
- Define a \`GridEntityConfig\` object:
  - \`id\`: unique instance identifier (e.g., \`"player_1"\`)
  - \`entityType\`: type string for queries (e.g., \`"player"\`, \`"box"\`, \`"enemy"\`)
  - \`textureKey\`: asset key from Preloader (must match Asset Registry)
  - \`sizeFactor\`: fraction of cell to fill (0.0-1.0). Player ~0.8, crate ~0.85, enemy ~0.75, item ~0.5. Default 0.85
  - \`isWalkable\`: can others walk through this? (true for items, goals)
  - \`isPushable\`: can this be pushed? (true for boxes, crates)
  - \`isDestructible\`: can this be destroyed? (true for enemies, items)
  - \`maxHealth\`: 0 = no HP system; set > 0 for combat entities (player HP, enemy HP)
- Hook overrides (only those needed):
  - \`onPlaced()\`: spawn effect
  - \`onMoved(fromX, fromY)\`: move sound, update facingDirection
  - \`onSelected()\` / \`onDeselected()\`: highlight effect
  - \`onInteraction(type)\`: push/collect/damage reaction
  - \`onStep(turnNumber)\`: per-step AI logic (chaser pathfinding, patrol direction, periodic effects)
  - \`onDamage(amount, oldHP, newHP)\`: damage visual feedback (tint red, shake)
  - \`onDeath()\`: death behavior (scene handles removal via onEntityDeath)
  - \`onCellEntered(cellType)\`: entity reacts to tile (e.g., stealth on grass)

**For each Level Scene** (COPY \`_TemplateGridLevel.ts\` -> \`LevelN.ts\`):
- Scene key string (e.g., \`"Level1"\`)
- Abstract method implementations:
  - \`getBoardConfig()\`: grid dimensions, cellSize, 2D cell array from Section 4
  - \`getTurnConfig()\`: timing mode + maxMoves/actionsPerTurn/realtimeInterval
  - \`createEnvironment()\`: background image + grid lines
  - \`createEntities()\`: place all entities at starting positions
  - \`checkWinCondition()\`: exact boolean logic for victory
  - \`checkLoseCondition()\`: exact boolean logic for defeat
- Input hook overrides (implement those matching the sub-type):
  - \`onDirectionInput(direction)\`: movement/push/bump-attack logic (puzzle/arcade/roguelike)
  - \`onActionInput()\`: special ability (Spacebar) -- ranged attack, interact, confirm
  - \`onCellClicked(gridX, gridY)\`: selection/swap logic (tactics/match)
  - \`onEntityClicked(entity)\`: unit selection (tactics)
- Pipeline hook overrides (the three-phase turn structure):
  - \`onProcessComplete()\`: Player Phase -- enqueue player action animations
  - \`onWorldPhase()\`: World Phase -- traps activate, tiles transform, items collected
  - \`onEnemyPhase()\`: Enemy Phase -- call \`stepAllEntities()\` or \`stepEntitiesOfType(type)\` for AI
  - \`onMoveProcessed()\`: chain reactions -- return true to re-process (Match-3 cascades)
- Entity lifecycle hooks:
  - \`onEntityEnteredCell(entity, gridX, gridY, cellType)\`: tile interactions (traps, items, terrain)
  - \`onEntityDeath(entity)\`: handle death -- remove entity, play animation, check lose condition
  - \`onEntityMoved(entity, fromX, fromY, toX, toY)\`: per-move effects
- Other hooks:
  - \`onTurnStart(turnNumber)\`: turn start effects, decrement cooldowns
  - \`onRealtimeTick()\`: timer-driven step (arcade mode only)
  - \`onPostCreate()\`: emit initial HP/status to UIScene
- Built-in methods to use in hooks:
  - \`damageEntity(entity, amount)\`: deal damage, auto-triggers onEntityDeath if HP reaches 0
  - \`stepAllEntities()\`: call onStep on all active entities (use in onEnemyPhase)
  - \`stepEntitiesOfType(type)\`: call onStep on specific entity type only
  - \`moveEntity(entity, toX, toY)\`: move + auto-trigger onEntityEnteredCell
  - \`slideEntity(entity, direction, shouldStop, stepDuration?)\`: slide entity until shouldStop returns true (ice, conveyor, wind)
  - \`getDirectionDelta(direction)\`: get (dx, dy) for a direction
  - \`getCellsInDirection(x, y, dir, range, w, h)\`: cells in a line (ranged attacks)
  - \`getCellsInRadius(x, y, radius, w, h)\`: cells in area (AoE effects)

**CRITICAL**: Every hook name must exist in template_api.md. Do NOT invent hooks.`,
      threed_basic: `Start with a Core Gameplay Contract table: player verbs, 20-60 second repeated loop, decision/skill demand, pressure, failure and recovery, visible feedback, three escalating beats, and exact win/lose conditions. If the prompt explicitly requires no-fail play, record that constraint and specify tension plus recovery/progression instead. Do not use collection unless the prompt calls for it.

Define the exact \`SceneMap.ts\` arrays required by that loop (floorPatches and obstacles plus only real objective/hazard/trigger arrays), the \`GameScene\` state transitions and consumers, texture-key mapping, camera start/bounds, and completion/failure conditions. Every declared state and array needs a final runtime consumer. Add a Gameplay Feasibility Ledger for one winning trace and one losing/counterfactual trace: cue/deadline, required input/route, derived action time, resource delta, and resulting state. Derive it from the final authored distances/timings and config speed/damage/recovery values, and make handled-action totals equal the authored event count.

For branched routes, list intended neighboring floor-patch pairs and forbidden cross-lane transitions, then require the final uninstrumented play check to complete every branch and attempt any claimed blocked switch. Never call a route choice committed when the final collision geometry permits lane switching. Treat camera near/far as source literals unless final code reads an exact named config leaf; fog and DPR config are not camera-far consumers.

Use only the public constructor and methods from template_api.md: \`update\`, \`setPaused\`, \`isPaused\`, and \`resize\`. Preserve main.ts RAF and DOM-screen wiring. List exact config fields and values; do not invent editor/runtime hooks. After any tuning edit, recompute the ledger and reconcile its counts, terminal state, and GDD body against the final uninstrumented playthrough.`,
      tower_defense: `Define every tower type, enemy type, and level scene with EXACT configurations. This maps directly to code files.

**For each Tower Type** (COPY \`_TemplateTower.ts\` -> \`TowerName.ts\`):
- Export a \`TowerTypeConfig\` object with ALL fields:
  - \`id\`: unique string identifier (e.g., \`"arrow_tower"\`)
  - \`name\`: display name for UI panel
  - \`textureKey\`: asset key from Preloader (must match Asset Registry)
  - \`cost\`: gold cost to place
  - \`damage\`, \`range\` (pixels), \`fireRate\` (shots/sec)
  - \`projectileKey\`: asset key for projectile
  - \`projectileSpeed\`: pixels/sec
  - \`targetingMode\`: \`'first'\` | \`'last'\` | \`'closest'\` | \`'strongest'\`
  - \`upgrades\`: array of { level, cost, damage, range, fireRate }
- Hook overrides (only those needed):
  - \`onFire(target)\`: fire sound/animation
  - \`onUpgrade(newLevel)\`: visual change on upgrade
  - \`createProjectile(target)\`: customize projectile (set splashRadius for AOE, slowAmount+slowDuration for slow towers)

**For each Enemy Type** (COPY \`_TemplateTDEnemy.ts\` -> \`EnemyName.ts\`):
- Define a \`TDEnemyConfig\` object:
  - \`textureKey\`: asset key
  - \`displayHeight\`: pixel height for scaling (24-96px range, see design_rules.md)
  - \`stats\`: { maxHealth, speed (px/sec), reward (gold), damage (lives lost on exit) }
- Hook overrides (only those needed):
  - \`onSpawn()\`: spawn visual effect
  - \`onDamageTaken(damage)\`: damage flash
  - \`onDeath()\`: death particle/sound
  - \`getAnimationKey(direction)\`: directional walk animation

**For each Level Scene** (COPY \`_TemplateTDLevel.ts\` -> \`LevelN.ts\`):
- Scene key string (e.g., \`"Level1"\`)
- Abstract method implementations:
  - \`getGridConfig()\`: grid dimensions, cellSize, 2D CellType array
  - \`getPathWaypoints()\`: ordered PathPoint[] from SPAWN to EXIT
  - \`createEnvironment()\`: background image + grid overlay
  - \`getWaveDefinitions()\`: all waves with enemy groups and intervals
  - \`getTowerTypes()\`: available tower configs (import from tower files)
  - \`createEnemy(enemyType)\`: factory mapping type strings to enemy classes
- Hook overrides (only those needed):
  - \`onTowerClicked(tower)\`: upgrade/sell interaction
  - \`onProjectileHitEnemy(projectile, enemy)\`: apply slow effects (read properties BEFORE calling super)
  - \`onWaveStart(waveNumber)\`: wave start sound/effect
  - \`onEnemyReachedEnd(enemy)\`: screen shake on leak

**Slow Tower Pattern** (if game has slow/debuff towers):
In the level scene, override \`onProjectileHitEnemy\`:
\`\`\`
const slowAmt = (projectile as any).slowAmount;
const slowDur = (projectile as any).slowDuration;
super.onProjectileHitEnemy(projectile, enemy);
if (slowAmt && slowDur) enemy.applyStatusEffect('slow', slowAmt, slowDur, 0x4488ff);
\`\`\`

**CRITICAL**: Every hook name must exist in template_api.md. Do NOT invent hooks.`,
    };
    return guidance[archetype] || '';
  }

  private getSection4Title(archetype: GameArchetype): string {
    const titles: Record<GameArchetype, string> = {
      platformer: 'Level Design (ASCII Blueprints)',
      ui_heavy: 'Content Design (Dialogues, Cards, Questions)',
      top_down: 'Level Design',
      grid_logic: 'Level & Puzzle Design (Code-Defined Grid)',
      tower_defense: 'Map & Wave Design',
      threed_basic: '3D Level & Gameplay Loop',
    };
    return titles[archetype] || 'Level Design';
  }

  private getSection4Guidance(archetype: GameArchetype): string {
    const guidance: Record<GameArchetype, string> = {
      platformer: `This section is the DIRECT INPUT to the \`generate_tilemap\` tool.

**HOW MANY LEVELS?**
- If user doesn't specify -> **1 level only** (use Template A or D)
- If user says "a few" -> 2-3 levels
- Otherwise, use the number they asked for

**CRITICAL -- ASCII MAP RULES:**
- You MUST copy a predefined template (A, B, C, or D) from the Design Guide **VERBATIM**
- Do NOT invent new ASCII map layouts -- the AI cannot reliably design valid tilemaps from scratch
- After copying, you may ONLY: add/remove coins (C), platforms (=), enemies (E, max 4)
- NEVER change: map dimensions, bottom 2 rows, player spawn side, door/boss side

**Template Quick Reference:**
| Template | Size | Best For |
|----------|------|----------|
| A: "Tutorial Flatlands" | 30x20 | First level, learning movement |
| B: "The Climb" | 35x22 | Vertical jumping challenge |
| C: "The Fortress" | 40x22 | Combat-focused, many enemies |
| D: "Boss Chamber" | 40x22 | Final level, boss fight arena |

**For EACH level**, provide:
- Level name, theme, and which template (A/B/C/D) it is based on
- Tileset key (from Asset Registry)
- Complete ASCII map (**copied from template**, with minor modifications noted)
- Map dimensions: Width x Height (must match template)
- Enemy placement: which type at which position`,

      ui_heavy: `**UI Heavy games do NOT use tilemaps.** This section contains game content.

**Dialogues** (for Chapter scenes):
Write the COMPLETE dialogue scripts. Each dialogue entry must have: type, speaker, text, expression (if applicable).
Include choice branches with effects.

**Card Decks** (for Battle scenes):
List EVERY card with: id, name, type (attack/defend/heal/special), value, description.

**Question Banks** (for Quiz/Educational games):
List ALL questions with: question text, 4 options, correctIndex, explanation.
Minimum 10 questions. Group by subject/difficulty if applicable.
Questions are returned by the \`getQuestionBank()\` hook and displayed via the \`QuizModal\` UI component.
The template's \`QuizManager\` handles random selection without repeats and auto-refills when exhausted.

**Character Profiles**:
For each character: id, displayName, textureKey for each expression, defaultPosition.`,

      top_down: `**Choose based on sub-mode** (see Design Guide Section 0 for detection rules):

### If sub-mode = TILEMAP:
Follow Design Guide Section 2 strictly:
1. COPY Template A/B/C/D **VERBATIM** -- write the COMPLETE ASCII map
2. Only tweak \`O\` (obstacles) / \`E\` (enemies) on floor tiles
3. Provide \`generate_tilemap\` call specs (2 calls per level: floor + walls mode)
4. List entity placement: enemy types, positions, AI types

### If sub-mode = ARENA:
**NO ASCII maps, NO tilesets, NO generate_tilemap calls.** Provide instead:
- Background description (for scrolling image asset)
- Player start position
- Enemy types table: type, movement, attack, spawn rate, min difficulty
- Difficulty scaling rules
- Boss config (optional): kill threshold, behavior, phases
- Score system: points per enemy type`,
      grid_logic: `**Grid Logic maps are code-defined grids. Do NOT use generate_tilemap.** The visual background is a single generated image; the grid logic is defined in \`getBoardConfig()\`.

### Why Code-Defined Grids (NOT Tilemaps)
Grid logic games mutate cell types at runtime (holes fill, doors open, items collected). BoardManager is the single source of truth for logic; a tilemap would create dual-data sync issues. The visual layer is a background image + code-rendered grid overlay (same pattern as tower_defense). Cell sprites for special types (goals, hazards) are optional images placed by code.

### Grid Map Definition
For EACH level, provide the COMPLETE grid as an ASCII diagram using these symbols:

| Symbol | CellType | Value | Meaning |
|--------|----------|-------|---------|
| \`.\` | EMPTY | 0 | Void / out of bounds |
| \`#\` | WALL | 1 | Impassable barrier |
| \`_\` | FLOOR | 2 | Walkable ground |
| \`G\` | GOAL | 3 | Target/objective cell |
| \`!\` | HAZARD | 4 | Dangerous cell (traps, lava, water puddle) |
| \`S\` | SPAWN | 5 | Player start position |
| \`*\` | SPECIAL | 6 | Game-specific (pressure plate, switch, tall grass) |
| \`~\` | ICE | 7 | Slippery surface (entity slides until stopped) |
| \`O\` | PORTAL | 8 | Teleportation pad (paired with another portal) |

**Grid Rules:**
- Size: 6-16 columns x 6-16 rows (puzzle), up to 20x20 (tactics)
- Border cells should be WALL (#) for puzzle/tactics/roguelike
- SPAWN(S) marks player starting position (exactly one per level)
- GOAL(G) cells must be reachable from SPAWN
- Every puzzle MUST be solvable
- HAZARD(!) cells should be clearly marked (visual + sound feedback on interaction)
- SPECIAL(*) cells have game-specific meaning defined in entity/level docs

**Use dual-layer ASCII maps** (terrain + entities) to avoid symbol conflicts:

**Layer 1 -- Terrain** (cell types only, defines \`getBoardConfig().cells\`):
\`\`\`
# # # # # # # #
# S _ _ _ _ _ #
# _ # _ # _ _ #
# _ _ _ _ _ _ #
# _ # _ # _ _ #
# _ _ _ _ _ G #
# _ _ _ _ _ G #
# # # # # # # #
\`\`\`

**Layer 2 -- Entities** (\`.\` = empty, drives \`createEntities()\`):
\`\`\`
. . . . . . . .
. . . . . . . .
. . . . . R . .
. . . C . C . .
. . . . . . . .
. . . K . . . .
. . . . . . . .
. . . . . . . .
\`\`\`

Entity markers: \`P\` = player, \`C\` = crate/box, \`K\` = key/item, \`R\` = chaser enemy, \`H\` = horizontal patroller, \`V\` = vertical patroller, \`^\` \`v\` \`<\` \`>\` = turret (with direction).

This separates terrain from entity placement. A crate on a FLOOR cell is represented as \`_\` in terrain + \`C\` in entities at the same position.

### Win/Lose Conditions
- **Win**: exact boolean condition (e.g., "All boxes on GOAL cells", "Score >= 1000", "All enemies defeated", "Reach GOAL cell")
- **Lose**: exact boolean condition (e.g., "Moves exceed maxMoves", "Player HP reaches 0", "Timer expires")

### Advanced Mechanics Setup (if using sliding/portals/elemental/turrets)
- ICE cells: mark with \`~\` in ASCII map. Entity slides in movement direction until hitting wall/entity/non-ICE cell.
- PORTAL cells: mark with \`O\` in ASCII map. List portal pairs with shared IDs (e.g., Portal A at (2,3) paired with Portal A at (7,5)).
- Elemental interactions: describe what happens when ability hits each cell type (e.g., "Electric + Water = AOE damage radius 1").
- Turrets: list each turret with position, firing direction, fire interval (turns), initial delay (turns before first fire, for staggered timing), and damage.
- Elemental AOE (advanced): for connected water bodies, use flood-fill to find all connected HAZARD cells and damage entities on/adjacent to any of them.

### Undo System (if puzzle sub-type)
- Specify whether undo is available (recommended for puzzle games)
- List ALL custom state that changes per move and must be restored on undo: HP, cooldowns, inventory flags, patrol directions, turret counters
- The board grid and entity positions are auto-saved; only list game-specific state above

### Combat Setup (if roguelike/tactics sub-type)
- Player HP and attack damage
- Each enemy type: HP, damage, AI behavior, drop (if any)
- Cooldown values (in turns) for special abilities
- Healing item values

### Match-3 Content (if match sub-type)
- Piece types: number and visual description of each
- Board dimensions (typically 7x9 with gravity)
- Scoring rules: points per match, chain bonuses
- Level objectives: score target, clear N pieces of type X, etc.

### Tactics Content (if tactics sub-type)
- Unit roster: type, HP, moveRange, attackRange, attackDamage
- Enemy AI behavior: patrol, chase, defend
- Victory/defeat conditions per level`,
      tower_defense: `**Tower Defense maps are code-defined grids. Do NOT use generate_tilemap.** The visual background is a single generated image; the grid logic is defined in \`getGridConfig()\`.

### Grid Map Definition
For EACH level, provide the COMPLETE grid as an ASCII diagram using these symbols:

| Symbol | CellType | Meaning |
|--------|----------|---------|
| \`B\` | BUILDABLE (0) | Player can place towers |
| \`P\` | PATH (1) | Enemy walking route |
| \`X\` | BLOCKED (2) | Impassable (walls, water) |
| \`S\` | SPAWN (3) | Enemy entry point |
| \`E\` | EXIT (4) | Enemy exit (player base) |

**Grid Rules:**
- Typical size: 12-18 columns x 8-12 rows
- Border cells should be BLOCKED (X) or SPAWN/EXIT
- Path must be connected from S to E with no breaks
- Minimum 5 BUILDABLE cells adjacent to path for strategic placement
- Path turns create premium tower positions (corners)
- Longer paths = easier levels

**Example Grid (12x10):**
\`\`\`
X X X X X X X X X X X X
S P P P B B B B B B B X
X B B P B B B B B B B X
X B B P P P P B B B B X
X B B B B B P B B B B X
X B B B B B P P P B B X
X B B B B B B B P B B X
X B B B B B B B P P P E
X B B B B B B B B B B X
X X X X X X X X X X X X
\`\`\`

### Path Waypoints
List the ordered waypoints in grid coordinates. Only include TURN points (enemies move in straight lines between them):
\`\`\`
Waypoint 0: (0, 1)   <- SPAWN
Waypoint 1: (3, 1)   <- first turn
Waypoint 2: (3, 3)   <- second turn
...
Waypoint N: (11, 7)  <- EXIT
\`\`\`
**CRITICAL**: First waypoint = SPAWN cell. Last waypoint = EXIT cell. All intermediate = PATH cells at turns.

### Wave Definitions
For EACH level, provide a COMPLETE wave table:

| Wave | Enemy Groups | Interval | Pre-Delay | Reward |
|------|-------------|----------|-----------|--------|
| 1 | 5x basic | 1200ms | 2000ms | 10g |
| 2 | 8x basic | 1000ms | - | 15g |
| 3 | 6x basic + 3x fast | 800ms | - | 20g |

**Wave Rules:**
- Wave 1: basic enemies only, slow interval (1000ms+)
- Introduce new enemy types every 2-3 waves
- Mixed waves start by wave 4-5
- Boss waves every 5 waves or as final wave
- Increase count and decrease interval for difficulty

### Tower Availability
List which tower types are available in each level. Early levels may restrict to 2-3 types; later levels unlock all.

### Economy Setup
- Starting gold: 80-200 (higher = easier)
- Kill rewards: 5-50g per enemy type
- Wave clear bonuses: 10-100g per wave`,
      threed_basic: `**Do not use generate_tilemap.** Provide one declarative level for \`initSceneMap()\` that executes the Section 3 Core Gameplay Contract:
- 8-14 overlapping floor patches with x/z/radius values
- only the objective, hazard, switch, gate, patrol, or trigger arrays actually consumed by the chosen loop; collectibles are optional
- 8-16 low-poly obstacle decorations outside the main walking line
- camera start, track bounds, exact gameplay radii/timings, and reachable win/lose positions
- at least three authored beats showing how pressure or decisions escalate without changing the core verbs
- for a branched route, intended neighbor pairs and forbidden cross-lane transitions after player-radius shrink
- manual play paths proving every branch, any claimed blocked switch, failure/recovery (or declared no-fail pressure response), and the win condition through keyboard/mouse input

End Section 4 with: \`3D scope: primitives + generated image textures; no model generation\`.`,
    };
    return guidance[archetype] || '';
  }

  private async callModel(
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    const payload = {
      model: this.modelConfig.modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      // GDD responses must leave the model's output budget for the document.
      // kimi-k3 can otherwise spend all 32K tokens on hidden reasoning and
      // return no content, which makes the six-stage pipeline retry forever.
      thinking: { type: 'disabled' },
      temperature: this.modelConfig.temperature ?? 0.6,
      max_tokens: 32000,
      stream: false,
    };

    const response = await fetch(
      `${this.modelConfig.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.modelConfig.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal,
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API Request Failed: ${response.status} - ${errorBody}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;

    if (data.error) {
      throw new Error(`Model API Error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content returned from the model');
    }
    return content;
  }

  private formatResult(result: string): string {
    return result;
  }

  private formatDisplayOutput(result: string): string {
    return `**Game Design Document Generated**\n\n${result}\n\n---\n\nArchetype: ${this.params.archetype}`;
  }
}

export class GenerateGDDTool extends BaseDeclarativeTool<
  GenerateGDDParams,
  ToolResult
> {
  static readonly Name: string = ToolNames.GENERATE_GDD;

  /**
   * Resolve the GDD reasoning-model config from env / settings. Throws
   * `MissingProviderConfigError` (with an actionable message) when no
   * key is configured. Called lazily by the invocation to avoid crashing
   * tool registration.
   */
  static resolveModelConfig(config?: Config): GDDModelConfig {
    const providers = config?.getOpenGameProviders();
    const resolved = resolveProviderConfig('reasoning', providers);
    return {
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      modelName: resolved.model,
      temperature: 0.6,
      timeout: 60000,
    };
  }

  constructor(
    private config: Config,
    private modelConfig?: GDDModelConfig,
  ) {
    super(
      GenerateGDDTool.Name,
      ToolDisplayNames.GENERATE_GDD,
      `Generates a Game Design Document (GDD) tailored to a specific game archetype. Call this AFTER classify-game-type and scaffold. The tool dynamically loads archetype-specific design rules.`,
      Kind.Think,
      {
        type: 'object',
        properties: {
          raw_user_requirement: {
            type: 'string',
            description: "The user's game idea or description.",
          },
          archetype: {
            type: 'string',
            description: 'Game archetype from classify-game-type tool.',
            enum: [
              'platformer',
              'top_down',
              'grid_logic',
              'tower_defense',
              'ui_heavy',
              'threed_basic',
            ],
          },
          config_summary: {
            type: 'string',
            description:
              'Optional: Summary of gameConfig.json if already read.',
          },
        },
        required: ['raw_user_requirement', 'archetype'],
      },
      false,
      true,
    );
  }

  protected override validateToolParamValues(
    params: GenerateGDDParams,
  ): string | null {
    if (
      !params.raw_user_requirement ||
      params.raw_user_requirement.trim() === ''
    ) {
      return 'raw_user_requirement must be a non-empty string';
    }

    if (!params.archetype) {
      return 'archetype is required. Run classify-game-type first.';
    }

    const validArchetypes: GameArchetype[] = [
      'platformer',
      'top_down',
      'grid_logic',
      'tower_defense',
      'ui_heavy',
      'threed_basic',
    ];
    if (!validArchetypes.includes(params.archetype)) {
      return `Invalid archetype: ${params.archetype}. Must be one of: ${validArchetypes.join(', ')}`;
    }

    return null;
  }

  protected createInvocation(
    params: GenerateGDDParams,
  ): ToolInvocation<GenerateGDDParams, ToolResult> {
    return new GenerateGDDInvocation(this.config, params, this.modelConfig);
  }
}
