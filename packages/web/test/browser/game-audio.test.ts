import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { browserOptions, buildGame } from '../../src/server/build-game';
import { temporaryArtifactServer } from '../../src/server/static-files';
import { qualityFixture } from '../helpers/quality-game';

type AudioWindow = Window & {
  fixtureAudio: { context: AudioContext; master: GainNode };
  audioPeak: number;
  probe: number;
};

test(
  'real Web Audio produces samples under the preview CSP and obeys mute, pause, restart and disposal',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'quality-audio-'));
    let server: Awaited<ReturnType<typeof temporaryArtifactServer>> | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await buildGame(
        await qualityFixture(path.join(directory, 'project')),
        path.join(directory, 'artifact'),
      );
      server = await temporaryArtifactServer(path.join(directory, 'artifact'));
      browser = await chromium.launch(browserOptions());
      const page = await browser.newPage();
      await page.goto(server.url);
      await page.locator('#start-game').click();
      await page.locator('canvas').waitFor({ state: 'visible' });
      await page.evaluate(() => {
        const scope = window as unknown as AudioWindow;
        const audio = scope.fixtureAudio;
        const analyser = audio.context.createAnalyser();
        analyser.fftSize = 256;
        audio.master.connect(analyser);
        scope.audioPeak = 0;
        const samples = new Float32Array(256);
        scope.probe = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          scope.audioPeak = Math.max(
            scope.audioPeak,
            Math.sqrt(
              samples.reduce((sum, n) => sum + n * n, 0) / samples.length,
            ),
          );
        }, 5);
      });
      const peak = () =>
        page.evaluate(
          () => (window as unknown as AudioWindow).audioPeak as number,
        );
      const resetPeak = () =>
        page.evaluate(() => {
          (window as unknown as AudioWindow).audioPeak = 0;
        });
      await page.locator('canvas').click();
      await page.waitForTimeout(180);
      assert.ok(
        (await peak()) > 0.001,
        'a build should produce real nonzero audio samples',
      );
      await page.locator('#mute').click();
      await resetPeak();
      await page.locator('canvas').click();
      await page.waitForTimeout(150);
      assert.equal(await peak(), 0);
      assert.match(await page.locator('#state').innerText(), /建造 2/);
      await page.locator('#restart-game').click();
      assert.equal(await page.locator('#mute').innerText(), '音效关');
      assert.match(
        await page.locator('#state').innerText(),
        /建造 0 · 金币 300/,
      );
      await page.locator('#mute').click();
      await page.locator('#celebrate').click();
      await page.locator('#pause').click();
      await page.waitForTimeout(100);
      await resetPeak();
      await page.locator('#celebrate').click();
      await page.waitForTimeout(450);
      assert.equal(
        await peak(),
        0,
        'pause stops already scheduled tones and rejects new ones',
      );
      await page.locator('#pause').click();
      await page.locator('canvas').click();
      await page.waitForTimeout(180);
      assert.ok((await peak()) > 0.001);
      await page.locator('#exit').click();
      await page.waitForFunction(
        () =>
          (window as unknown as AudioWindow).fixtureAudio.context.state ===
          'closed',
      );
      await page.evaluate(() =>
        clearInterval((window as unknown as AudioWindow).probe),
      );
    } finally {
      await browser?.close();
      await server?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
