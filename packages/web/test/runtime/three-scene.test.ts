import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkInProjectContainer,
  requireRuntimeImage,
} from '../../src/server/project-runtime';

test(
  '3D scene starts and resets in the offline production container',
  { timeout: 120000 },
  async () => {
    const output = await mkdtemp(path.join(tmpdir(), 'three-runtime-'));
    try {
      const validation = await checkInProjectContainer({
        projectId: randomUUID(),
        jobId: randomUUID(),
        workspace: fileURLToPath(
          new URL('../fixtures/three-scene', import.meta.url),
        ),
        output: path.join(output, 'artifact'),
        image: await requireRuntimeImage(),
        signal: AbortSignal.timeout(110000),
      });
      assert.equal(validation.browser, true);
      assert.equal(validation.start, true);
      assert.equal(validation.restart, true);
      assert.deepEqual(validation.errors, []);
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  },
);
