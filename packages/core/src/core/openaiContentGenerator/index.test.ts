/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { Config } from '../../config/config.js';
import type { ContentGeneratorConfig } from '../contentGenerator.js';
import { determineProvider } from './index.js';
import {
  DefaultOpenAICompatibleProvider,
  EvoLinkOpenAICompatibleProvider,
} from './provider/index.js';

describe('determineProvider', () => {
  const cliConfig = {
    getCliVersion: vi.fn().mockReturnValue('1.0.0'),
  } as unknown as Config;

  it('returns the EvoLink provider for EvoLink direct API URLs', () => {
    const config = {
      apiKey: 'test-api-key',
      baseUrl: 'https://direct.evolink.ai/v1',
      model: 'gpt-5.2',
    } as ContentGeneratorConfig;

    const provider = determineProvider(config, cliConfig);

    expect(provider).toBeInstanceOf(EvoLinkOpenAICompatibleProvider);
  });

  it('falls back to the default provider for generic OpenAI-compatible URLs', () => {
    const config = {
      apiKey: 'test-api-key',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o',
    } as ContentGeneratorConfig;

    const provider = determineProvider(config, cliConfig);

    expect(provider).toBeInstanceOf(DefaultOpenAICompatibleProvider);
  });
});
