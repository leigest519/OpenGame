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

export interface GameTypeClassifierParams {
  /**
   * User's game description or idea
   */
  game_description: string;
}

export interface ClassifierModelConfig {
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

/**
 * Game archetype based on physics and perspective
 */
export type GameArchetype =
  | 'platformer'
  | 'top_down'
  | 'grid_logic'
  | 'tower_defense'
  | 'ui_heavy'
  | 'threed_basic';

export interface ClassificationResult {
  archetype: GameArchetype;
  reasoning: string;
  physicsProfile: {
    hasGravity: boolean;
    perspective: 'side' | 'top_down' | 'three_dimensional' | 'none';
    movementType: 'continuous' | 'grid' | 'path' | 'ui_only';
  };
}

class GameTypeClassifierInvocation extends BaseToolInvocation<
  GameTypeClassifierParams,
  ToolResult
> {
  /**
   * Lazily resolved on first access so a missing API key surfaces as a
   * tool-execution error (with an actionable message) instead of crashing
   * tool registration at CLI startup.
   */
  private resolvedModelConfig?: ClassifierModelConfig;

  constructor(
    private config: Config,
    params: GameTypeClassifierParams,
    /** Optional override; takes precedence over env / settings. */
    private overrideModelConfig?: ClassifierModelConfig,
  ) {
    super(params);
  }

  private get modelConfig(): ClassifierModelConfig {
    if (this.overrideModelConfig) return this.overrideModelConfig;
    if (!this.resolvedModelConfig) {
      this.resolvedModelConfig = GameTypeClassifierTool.resolveModelConfig(
        this.config,
      );
    }
    return this.resolvedModelConfig;
  }

  getDescription(): string {
    return `Classify game type using physics-first logic.`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    try {
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt();

      const result = await this.callClassifierModel(
        systemPrompt,
        userPrompt,
        signal,
      );

      // Parse the JSON result
      const classification = this.parseClassification(result);

      const llmContent = this.formatLLMContent(classification);
      const displayContent = this.formatDisplayContent(classification);

      return {
        llmContent,
        returnDisplay: displayContent,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        llmContent: `Error classifying game type: ${errorMessage}`,
        returnDisplay: `**Classification Failed**\n\nError: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }

  private buildSystemPrompt(): string {
    return `# Game Type Classifier (Physics-First Logic)

You are a game physics analyzer. Your job is to classify games based on their PHYSICS and PERSPECTIVE, not their genre name.

## Classification Rules

### 1. platformer (Side View + Gravity)
**Physics**: Y-axis gravity enabled, characters fall down
**Perspective**: Side view (camera looks from the side)
**Movement**: Left/right + jump
**Examples**: Mario, Angry Birds, Street Fighter, Terraria, Hill Climb Racing, Metal Slug, Flappy Bird

**Key Question**: Does the character FALL if there's no ground beneath them?

### 2. top_down (Top-Down + Free Movement)
**Physics**: No gravity (or negligible), free 8-direction movement
**Perspective**: Top-down or isometric (camera looks from above)
**Movement**: WASD in any direction
**Examples**: Zelda, Binding of Isaac, Vampire Survivors, Asteroids, GTA 2D, Hotline Miami

**Key Question**: Can the character move UP without jumping?

### 3. grid_logic (Grid + Turn/Static Logic)
**Physics**: Minimal physics, snap-to-grid movement
**Perspective**: Usually top-down, but grid-locked
**Movement**: Discrete steps (one tile at a time)
**Examples**: Sokoban, Fire Emblem, Chess, Tetris, Match-3, Minesweeper, Snake

**Key Question**: Does movement happen in discrete grid steps?

### 4. tower_defense (Path + Waves)
**Physics**: Enemies follow predefined paths
**Perspective**: Usually top-down
**Movement**: Path-following for enemies, point-and-click for towers
**Examples**: Kingdom Rush, Bloons TD, Plants vs Zombies

**Key Question**: Do enemies follow a fixed path while player places defenses?

### 5. ui_heavy (UI Driven / No Physics)
**Physics**: Almost no arcade physics
**Perspective**: N/A (UI panels)
**Movement**: Click/tap interactions
**Examples**: Card games (Slay the Spire), Visual Novels, Idle/Clicker games, Rhythm games (note highways)

**Key Question**: Is the game primarily UI panels and state changes?

### 6. threed_basic (Explicit 3D World)
**Physics**: No physics engine; simple geometry and manual collision bounds
**Perspective**: First-person, third-person, or freely moving camera in a three-dimensional world
**Movement**: Keyboard movement plus mouse look/steering
**Examples**: three.js maze roaming, low-poly floating-island treasure hunt, neon 3D collection runner

**Key Question**: Does the request explicitly require 3D, three.js, a 3D camera, or movement through a three-dimensional world?
**Priority Rule**: Explicit 3D intent wins over genre words such as maze, platformer, runner, or racing. Do not classify ordinary 2D Phaser games as threed_basic.

## Output Format

Respond with ONLY a JSON object (no markdown, no explanation outside JSON):

{
  "archetype": "platformer" | "top_down" | "grid_logic" | "tower_defense" | "ui_heavy" | "threed_basic",
  "reasoning": "Brief explanation of why this archetype was chosen based on physics",
  "physicsProfile": {
    "hasGravity": true | false,
    "perspective": "side" | "top_down" | "none",
    "movementType": "continuous" | "grid" | "path" | "ui_only"
  }
}

## Common Mistakes to Avoid

- Terraria is NOT top_down (it has gravity, it's platformer)
- Angry Birds is NOT puzzle (it has gravity physics, it's platformer)
- Hill Climb Racing is NOT top_down (it has gravity, it's platformer)
- SimCity/Factorio are grid_logic (grid-based building), not top_down
- Racing games: If side-view with gravity = platformer, if top-down = top_down
- A "three.js maze roaming" request is threed_basic, not grid_logic or top_down
- A normal 2D side-view Phaser platformer remains platformer
`;
  }

  private buildUserPrompt(): string {
    return `Classify this game based on its PHYSICS and PERSPECTIVE:

"${this.params.game_description}"

Remember: Explicit 3D/three.js intent takes priority; otherwise use GRAVITY, PERSPECTIVE, and MOVEMENT TYPE. Output JSON only.`;
  }

  private async callClassifierModel(
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
      temperature: this.modelConfig.temperature ?? 0.3, // Lower temp for classification
      max_tokens: 500,
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
      throw new Error(
        `API Request Failed: ${response.status} ${response.statusText} - ${errorBody}`,
      );
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

  private parseClassification(result: string): ClassificationResult {
    // Try to extract JSON from the result
    let jsonStr = result.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr
        .replace(/```json?\n?/g, '')
        .replace(/```/g, '')
        .trim();
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        archetype: parsed.archetype || 'platformer',
        reasoning: parsed.reasoning || 'No reasoning provided',
        physicsProfile: parsed.physicsProfile || {
          hasGravity: true,
          perspective: 'side',
          movementType: 'continuous',
        },
      };
    } catch {
      // Fallback: try to extract archetype from text
      const archetypes: GameArchetype[] = [
        'threed_basic',
        'platformer',
        'top_down',
        'grid_logic',
        'tower_defense',
        'ui_heavy',
      ];
      for (const arch of archetypes) {
        if (result.toLowerCase().includes(arch)) {
          return {
            archetype: arch,
            reasoning: result,
            physicsProfile: {
              hasGravity: arch === 'platformer',
              perspective:
                arch === 'threed_basic'
                  ? 'three_dimensional'
                  : arch === 'platformer'
                    ? 'side'
                    : 'top_down',
              movementType: arch === 'grid_logic' ? 'grid' : 'continuous',
            },
          };
        }
      }
      // Default fallback
      return {
        archetype: 'platformer',
        reasoning: 'Failed to parse, defaulting to platformer',
        physicsProfile: {
          hasGravity: true,
          perspective: 'side',
          movementType: 'continuous',
        },
      };
    }
  }

  private formatLLMContent(result: ClassificationResult): string {
    // Use environment variables if available, fallback to relative paths
    const templatesDir = process.env.GAME_TEMPLATES_DIR || '../../templates';
    const docsDir = process.env.GAME_DOCS_DIR || '../../docs';

    const coreTemplate =
      result.archetype === 'threed_basic' ? 'core3d' : 'core';

    return `<classification>
Archetype: ${result.archetype}
Reasoning: ${result.reasoning}

Physics Profile:
- Has Gravity: ${result.physicsProfile.hasGravity}
- Perspective: ${result.physicsProfile.perspective}
- Movement Type: ${result.physicsProfile.movementType}
</classification>

<system-reminder>
GAME TYPE CLASSIFIED: **${result.archetype}**

## Next Step: Scaffold Templates

Run these commands NOW:

\`\`\`bash
# Step 1: Copy core template (creates src/, public/, config files)
cp -r ${templatesDir}/${coreTemplate}/* ./

# Step 2: Copy module-specific code INTO src/ (ADDITIVE merge)
cp -r ${templatesDir}/modules/${result.archetype}/src/* ./src/

# Step 3: Copy core documentation
mkdir -p docs/gdd
cp ${docsDir}/gdd/core.md docs/gdd/
cp ${docsDir}/asset_protocol.md ${docsDir}/debug_protocol.md docs/

# Step 4: Copy module-specific documentation
mkdir -p docs/modules/${result.archetype}
cp -r ${docsDir}/modules/${result.archetype}/* docs/modules/${result.archetype}/

# three.js is pinned in core3d/package-lock.json; install only inside this game workspace.
if [ "${result.archetype}" = "threed_basic" ]; then npm ci; fi
\`\`\`

## After Scaffolding: Proceed to Phase 2 (GDD Generation)

**Do NOT read template source files yet** — template code is only read in Phase 5 (Implementation).
Reading now wastes context window.

Next: Call \`generate-gdd\` tool with:
- \`raw_user_requirement\`: User's game idea
- \`archetype\`: "${result.archetype}"
</system-reminder>`;
  }

  private formatDisplayContent(result: ClassificationResult): string {
    const moduleDescriptions: Record<GameArchetype, string> = {
      platformer: 'Side View + Gravity (Mario, Angry Birds, Street Fighter)',
      top_down: 'Top-Down + Free Movement (Zelda, Isaac, Vampire Survivors)',
      grid_logic: 'Grid + Static Logic (Sokoban, Fire Emblem, Match-3)',
      tower_defense: 'Path + Waves (Kingdom Rush, Bloons TD)',
      ui_heavy: 'UI Driven (Card Games, Visual Novels, Idle Clickers)',
      threed_basic: '3D World + Manual Movement (three.js primitives)',
    };

    return `**Game Type Classification**

**Archetype**: \`${result.archetype}\`
**Description**: ${moduleDescriptions[result.archetype]}

**Physics Analysis**:
| Property | Value |
|----------|-------|
| Has Gravity | ${result.physicsProfile.hasGravity ? 'Yes' : 'No'} |
| Perspective | ${result.physicsProfile.perspective} |
| Movement | ${result.physicsProfile.movementType} |

**Reasoning**: ${result.reasoning}

---
Next: Scaffold templates and audit code.`;
  }
}

export class GameTypeClassifierTool extends BaseDeclarativeTool<
  GameTypeClassifierParams,
  ToolResult
> {
  static readonly Name: string = ToolNames.GAME_TYPE_CLASSIFIER;

  /**
   * Resolve the classifier's reasoning-model config from
   * env / ~/.qwen settings.  Throws `MissingProviderConfigError` (with an
   * actionable message) when nothing is configured. Called lazily by the
   * invocation so tool registration doesn't crash on a fresh install.
   */
  static resolveModelConfig(config?: Config): ClassifierModelConfig {
    const providers = config?.getOpenGameProviders();
    const resolved = resolveProviderConfig('reasoning', providers);
    return {
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      modelName: resolved.model,
      temperature: 0.3,
      timeout: 15000,
    };
  }

  constructor(
    private config: Config,
    /** Optional override; if omitted the invocation resolves at execute time. */
    private modelConfig?: ClassifierModelConfig,
  ) {
    super(
      GameTypeClassifierTool.Name,
      ToolDisplayNames.GAME_TYPE_CLASSIFIER,
      `Classifies a game idea into an archetype based on DIMENSION, PHYSICS, and PERSPECTIVE (not genre name). Returns: platformer (side+gravity), top_down (free movement), grid_logic (discrete tiles), tower_defense (path+waves), ui_heavy (no physics), or threed_basic (explicit three.js/3D world). Call this FIRST before scaffolding templates.`,
      Kind.Think,
      {
        type: 'object',
        properties: {
          game_description: {
            type: 'string',
            description:
              'The user\'s game idea or description. Can include genre, mechanics, or example games. Example: "I want a game like Terraria" or "A puzzle game where you push boxes"',
          },
        },
        required: ['game_description'],
      },
      false,
      true,
    );
  }

  protected override validateToolParamValues(
    params: GameTypeClassifierParams,
  ): string | null {
    if (!params.game_description || params.game_description.trim() === '') {
      return 'game_description must be a non-empty string';
    }

    if (params.game_description.trim().length < 3) {
      return 'Game description is too short (minimum 3 characters)';
    }

    return null;
  }

  protected createInvocation(
    params: GameTypeClassifierParams,
  ): ToolInvocation<GameTypeClassifierParams, ToolResult> {
    return new GameTypeClassifierInvocation(
      this.config,
      params,
      this.modelConfig,
    );
  }
}
