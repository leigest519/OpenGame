/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultOpenAICompatibleProvider } from './default.js';
import { EvoLinkOpenAICompatibleProvider } from './evolink.js';
import type { Config } from '../../../config/config.js';
import type { ContentGeneratorConfig } from '../../contentGenerator.js';

describe('EvoLinkOpenAICompatibleProvider', () => {
  let provider: EvoLinkOpenAICompatibleProvider;
  let mockContentGeneratorConfig: ContentGeneratorConfig;
  let mockCliConfig: Config;

  beforeEach(() => {
    mockContentGeneratorConfig = {
      apiKey: 'test-api-key',
      baseUrl: 'https://direct.evolink.ai/v1',
      model: 'gpt-5.2',
    } as ContentGeneratorConfig;

    mockCliConfig = {
      getCliVersion: vi.fn().mockReturnValue('1.0.0'),
    } as unknown as Config;

    provider = new EvoLinkOpenAICompatibleProvider(
      mockContentGeneratorConfig,
      mockCliConfig,
    );
  });

  describe('constructor', () => {
    it('extends the default OpenAI-compatible provider', () => {
      expect(provider).toBeInstanceOf(DefaultOpenAICompatibleProvider);
      expect(provider).toBeInstanceOf(EvoLinkOpenAICompatibleProvider);
    });
  });

  describe('isEvoLinkProvider', () => {
    it('returns true for EvoLink direct API URLs', () => {
      const configs = [
        { baseUrl: 'https://direct.evolink.ai/v1' },
        { baseUrl: 'https://direct.evolink.ai' },
        { baseUrl: 'HTTPS://DIRECT.EVOLINK.AI/V1' },
      ];

      configs.forEach((config) => {
        expect(
          EvoLinkOpenAICompatibleProvider.isEvoLinkProvider(
            config as ContentGeneratorConfig,
          ),
        ).toBe(true);
      });
    });

    it('returns false for non-EvoLink URLs', () => {
      const configs = [
        { baseUrl: 'https://api.openai.com/v1' },
        { baseUrl: 'https://openrouter.ai/api/v1' },
        { baseUrl: 'https://api.evolink.ai' },
        { baseUrl: '' },
        { baseUrl: undefined },
      ];

      configs.forEach((config) => {
        expect(
          EvoLinkOpenAICompatibleProvider.isEvoLinkProvider(
            config as ContentGeneratorConfig,
          ),
        ).toBe(false);
      });
    });
  });
});
