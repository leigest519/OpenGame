/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('repository text encoding', () => {
  it('contains valid UTF-8 without mojibake or invisible spacing', async () => {
    const files = execFileSync('git', ['ls-files', '-z'])
      .toString()
      .split('\0')
      .filter(Boolean);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const suspicious =
      /[\u00A0\u200B\u202A-\u202E\u2060\u2066-\u2069\uFEFF\uFFFD]|\u951F\u65A4\u62F7|\u70EB{3}|\u5C6F{3}|\u00EF\u00BF\u00BD|\u00C3[\u0080-\u00FF]|\u00C2[\u0080-\u00FF]|\u00E2[\u0080-\u00FF]/u;
    const errors = [];

    for (const file of files) {
      const bytes = await readFile(file);
      if (bytes.includes(0)) continue;

      let content;
      try {
        content = decoder.decode(bytes);
      } catch {
        errors.push(`${file}: invalid UTF-8`);
        continue;
      }

      content.split('\n').forEach((line, index) => {
        if (suspicious.test(line)) errors.push(`${file}:${index + 1}`);
      });
    }

    expect(errors).toEqual([]);
  });
});
