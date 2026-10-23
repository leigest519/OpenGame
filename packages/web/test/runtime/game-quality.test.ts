import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  checkInProjectContainer,
  requireRuntimeImage,
} from '../../src/server/project-runtime';
import { qualityScreenshots } from '../../src/shared/game-quality';
import { qualityFixture, qualityPlan } from '../helpers/quality-game';
import type { AcceptanceCase } from '../../src/shared/game-production';

test(
  'production container executes real clicks/keys, exports all viewports and rejects a false gameplay assertion',
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'quality-runtime-'));
    try {
      const workspace = await qualityFixture(path.join(directory, 'project'));
      const output = path.join(directory, 'artifact');
      const options = {
        projectId: randomUUID(),
        jobId: randomUUID(),
        workspace,
        output,
        image: await requireRuntimeImage(),
        signal: AbortSignal.timeout(110000),
      };
      const report = await checkInProjectContainer(options);
      assert.equal(report.restart, true);
      assert.deepEqual(report.quality?.playtest, {
        status: 'passed',
        steps: qualityPlan.steps.length,
      });
      assert.deepEqual(report.quality?.screenshots, qualityScreenshots);
      assert.equal(report.quality?.reviewed, undefined);
      for (const shot of qualityScreenshots) {
        const png = await readFile(path.join(output, shot.file));
        assert.equal(png.subarray(1, 4).toString(), 'PNG');
        assert.equal(png.readUInt32BE(16), shot.width);
        assert.equal(png.readUInt32BE(20), shot.height);
      }
      assert.notDeepEqual(
        await readFile(path.join(output, 'preview-start.png')),
        await readFile(path.join(output, 'preview.png')),
      );
      await writeFile(
        path.join(workspace, 'playtest.json'),
        JSON.stringify({
          version: 1,
          steps: [
            qualityPlan.steps[0],
            { action: 'expect', selector: '#state', text: '金币 999' },
          ],
        }),
      );
      await assert.rejects(
        checkInProjectContainer({
          ...options,
          jobId: randomUUID(),
          output: path.join(directory, 'invalid'),
        }),
        /试玩第 2 步/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'host-owned scenarios start fresh, survive project spoofing, and report false exact outcomes as failures',
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'acceptance-runtime-'));
    try {
      const workspace = await qualityFixture(path.join(directory, 'project'));
      // A game cannot replace the host's suite by writing a similarly named file.
      await writeFile(
        path.join(workspace, 'acceptance.json'),
        JSON.stringify([{ criterionId: 'fake', passed: true }]),
      );
      const source = path.join(workspace, 'src/main.ts');
      await writeFile(
        source,
        (await readFile(source, 'utf8')) +
          `
Object.assign(window, { __OPENGAME_TEST__: { prepareScenario(name: string) {
  if (name !== 'two-built') throw new Error('unknown scenario');
  count = 2; paint();
} } });
window.addEventListener('blur', () => {
  paused = true;
  document.querySelector('#pause')!.textContent = '继续';
});
`,
      );
      const acceptance: AcceptanceCase[] = [
        {
          criterionId: 'build',
          plan: {
            version: 1,
            steps: [
              qualityPlan.steps[0],
              {
                action: 'expect',
                selector: '#state',
                text: '建造 1 · 金币 220 · 移动 0',
                exact: true,
              },
            ],
          },
        },
        {
          criterionId: 'reset',
          plan: {
            version: 1,
            steps: [
              qualityPlan.steps[0],
              { action: 'click', selector: '#restart-game' },
              {
                action: 'expect',
                selector: '#state',
                text: '建造 0 · 金币 300 · 移动 0',
                exact: true,
              },
            ],
          },
        },
        {
          criterionId: 'false-balance',
          plan: {
            version: 1,
            steps: [
              qualityPlan.steps[0],
              {
                action: 'expect',
                selector: '#state',
                text: '建造 1 · 金币 22 · 移动 0',
                exact: true,
              },
            ],
          },
        },
        {
          criterionId: 'build',
          variant: 'late-build',
          scenario: 'two-built',
          plan: {
            version: 1,
            steps: [
              qualityPlan.steps[0],
              {
                action: 'expect',
                selector: '#state',
                text: '建造 3 · 金币 60 · 移动 0',
                exact: true,
              },
            ],
          },
        },
        {
          criterionId: 'build',
          variant: 'unknown',
          scenario: 'missing',
          plan: {
            version: 1,
            steps: [
              qualityPlan.steps[0],
              {
                action: 'expect',
                selector: '#state',
                text: '建造 1 · 金币 220 · 移动 0',
                exact: true,
              },
            ],
          },
        },
        {
          criterionId: 'focus-pause',
          plan: {
            version: 1,
            steps: [
              qualityPlan.steps[0],
              { action: 'focus', target: 'away' },
              { action: 'wait', ms: 50 },
              { action: 'focus', target: 'game' },
              {
                action: 'expect',
                selector: '#pause',
                text: '继续',
                exact: true,
              },
              { action: 'key', key: 'ArrowRight', holdMs: 0 },
              {
                action: 'expect',
                selector: '#state',
                text: '建造 1 · 金币 220 · 移动 0',
                exact: true,
              },
              { action: 'click', selector: '#pause' },
              { action: 'key', key: 'ArrowRight', holdMs: 0 },
              {
                action: 'expect',
                selector: '#state',
                text: '建造 1 · 金币 220 · 移动 1',
                exact: true,
              },
            ],
          },
        },
      ];
      const output = path.join(directory, 'artifact');
      const report = await checkInProjectContainer({
        projectId: randomUUID(),
        jobId: randomUUID(),
        workspace,
        output,
        image: await requireRuntimeImage(),
        signal: AbortSignal.timeout(110000),
        acceptance,
      });
      assert.deepEqual(
        report.quality!.acceptance!.map((r) => [r.criterionId, r.status]),
        [
          ['build', 'passed'],
          ['reset', 'passed'],
          ['false-balance', 'failed'],
          ['build', 'passed'],
          ['build', 'failed'],
          ['focus-pause', 'passed'],
        ],
        JSON.stringify(report.quality!.acceptance),
      );
      assert.equal(report.quality!.acceptance![3].scenario, 'two-built');
      assert.equal(report.quality!.acceptance![3].variant, 'late-build');
      assert.match(report.quality!.acceptance![4].error!, /unknown scenario/);
      assert.match(report.quality!.acceptance![2].error!, /试玩第 2 步/);
      for (const result of report.quality!.acceptance!) {
        const png = await readFile(path.join(output, result.screenshot));
        assert.equal(png.subarray(1, 4).toString(), 'PNG');
        assert.equal(png.readUInt32BE(16), 960);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
