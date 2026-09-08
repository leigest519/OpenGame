import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config/config.js';
import { GameTypeClassifierTool } from './game-type-classifier.js';

const modelConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://classifier.test/v1',
  modelName: 'test-model',
};

afterEach(() => vi.unstubAllGlobals());

describe('GameTypeClassifierTool archetype routing', () => {
  it.each([
    [
      '做一个 three.js 迷宫漫游游戏',
      'threed_basic',
      'three_dimensional',
      'core3d',
    ],
    ['做一个 2D Phaser 横版跳跃游戏', 'platformer', 'side', 'core'],
    ['做一个 2D Phaser 俯视角自由移动游戏', 'top_down', 'top_down', 'core'],
  ])(
    'routes %s to %s without changing the 2D core',
    async (gameDescription, archetype, perspective, coreTemplate) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    archetype,
                    reasoning: 'test fixture',
                    physicsProfile: {
                      hasGravity: archetype === 'platformer',
                      perspective,
                      movementType: 'continuous',
                    },
                  }),
                },
              },
            ],
          }),
        }),
      );

      const tool = new GameTypeClassifierTool({} as Config, modelConfig);
      const result = await tool
        .build({ game_description: gameDescription })
        .execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain(`Archetype: ${archetype}`);
      expect(result.llmContent).toContain(`/templates/${coreTemplate}/*`);
    },
  );
});
