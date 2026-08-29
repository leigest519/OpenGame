/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContentGeneratorConfig } from '../../contentGenerator.js';
import { DefaultOpenAICompatibleProvider } from './default.js';

export class EvoLinkOpenAICompatibleProvider extends DefaultOpenAICompatibleProvider {
  static isEvoLinkProvider(
    contentGeneratorConfig: ContentGeneratorConfig,
  ): boolean {
    const baseUrl = contentGeneratorConfig.baseUrl ?? '';

    return baseUrl.toLowerCase().includes('direct.evolink.ai');
  }
}
