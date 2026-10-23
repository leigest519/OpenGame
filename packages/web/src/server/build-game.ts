import { build } from 'esbuild';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { temporaryArtifactServer } from './static-files';
import { assertProjectFiles } from './project-files';
import type { ValidationReport } from '../shared/types';
import {
  acceptanceScreenshots,
  qualityScreenshots,
  type PlaytestPlan,
} from '../shared/game-quality';
import type {
  AcceptanceCase,
  AcceptanceResult,
} from '../shared/game-production';
import { performPlaytest, preparePlaytestPage } from './game-playtest';

const require = createRequire(import.meta.url);
export { artifactHash } from './artifact-hash';
export async function buildGame(
  workspace: string,
  output: string,
): Promise<void> {
  await assertProjectFiles(workspace);
  await mkdir(output, { recursive: true });
  const root = await realpath(workspace);
  const phaser = require.resolve('phaser/dist/phaser.js');
  // Exact trusted files only: do not grant project imports access to node_modules.
  const libraries = new Map([
    ['phaser', phaser],
    [
      'three',
      path.join(path.dirname(require.resolve('three')), 'three.module.js'),
    ],
    [
      'three/addons/controls/OrbitControls.js',
      require.resolve('three/examples/jsm/controls/OrbitControls.js'),
    ],
  ]);
  const trustedFiles = new Set(
    await Promise.all([...libraries.values()].map((file) => realpath(file))),
  );
  await build({
    absWorkingDir: workspace,
    entryPoints: ['src/main.ts'],
    bundle: true,
    outfile: path.join(output, 'game.js'),
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    logLevel: 'silent',
    sourcemap: false,
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
    plugins: [
      {
        name: 'project-imports-only',
        setup(context) {
          context.onLoad({ filter: /.*/ }, async (args) => {
            const target = await realpath(args.path);
            if (trustedFiles.has(target)) return;
            if (!target.startsWith(`${root}${path.sep}`))
              return { errors: [{ text: '禁止读取项目外的文件。' }] };
            return;
          });
          context.onResolve({ filter: /.*/ }, async (args) => {
            const library = libraries.get(args.path);
            if (library) return { path: library };
            if (args.kind !== 'entry-point' && !args.path.startsWith('.'))
              return {
                errors: [
                  {
                    text: `不支持依赖 ${args.path}；仅提供 Phaser、Three.js、OrbitControls 与项目内模块。`,
                  },
                ],
              };
            const target = path.resolve(
              args.resolveDir || workspace,
              args.path,
            );
            if (!target.startsWith(`${root}${path.sep}`))
              return { errors: [{ text: '导入必须位于当前项目内。' }] };
            return;
          });
        },
      },
    ],
  });
  await writeFile(
    path.join(output, 'index.html'),
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenGame</title><link rel="stylesheet" href="./base.css">${existsSync(path.join(output, 'game.css')) ? '<link rel="stylesheet" href="./game.css">' : ''}</head><body><div id="game-root"></div><script src="./game.js"></script></body></html>`,
  );
  await writeFile(
    path.join(output, 'base.css'),
    'html,body{margin:0;min-height:100%;background:#111629;color:#f4f5ff;font:15px system-ui}*{box-sizing:border-box}#game-root{min-height:100vh;width:100%;overflow:hidden}canvas{display:block;max-width:100%;margin:auto}button{font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #b2a8ff;outline-offset:3px}',
  );
}
export function browserOptions() {
  const chrome =
    process.env.OPENGAME_CHROME_PATH ||
    (process.platform === 'darwin' &&
    existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined);
  // Full Chromium's headless mode models real tabs; headless-shell keeps every
  // page focused even after disabling Playwright's focus emulation.
  return {
    headless: true,
    executablePath: chrome || undefined,
    channel: chrome ? undefined : 'chromium',
  };
}
export async function validateGame(
  output: string,
  signal?: AbortSignal,
  playtest?: PlaytestPlan,
  acceptance: AcceptanceCase[] = [],
): Promise<ValidationReport> {
  signal?.throwIfAborted();
  const server = await temporaryArtifactServer(output);
  let browser: Browser | undefined;
  const report: ValidationReport = {
    build: true,
    browser: false,
    start: false,
    restart: false,
    errors: [],
    checkedAt: new Date().toISOString(),
  };
  const abort = () => {
    void browser?.close();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    browser = await chromium.launch(browserOptions());
    signal?.throwIfAborted();
    const context = await browser.newContext({
      viewport: { width: 960, height: 600 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', (error) =>
      report.errors.push(error.message.slice(0, 400)),
    );
    page.on('response', (response) => {
      if (response.status() >= 400)
        report.errors.push(`资源请求失败 ${response.status()}`);
    });
    await page.goto(server.url, { waitUntil: 'load', timeout: 15000 });
    await preparePlaytestPage(page, playtest);
    await page.locator('#start-game').click();
    await page.locator('canvas').first().waitFor({ state: 'visible' });
    report.start = true;
    const warnings: string[] = [];
    for (const [index, shot] of qualityScreenshots.entries()) {
      signal?.throwIfAborted();
      if (index === 1 && playtest)
        await performPlaytest(page, playtest, signal);
      await page.setViewportSize({ width: shot.width, height: shot.height });
      await page.waitForTimeout(300);
      const layout = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const rect = canvas?.getBoundingClientRect();
        const parent = canvas?.parentElement?.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 2,
          clipped: [...document.querySelectorAll('button')].filter((button) => {
            const r = button.getBoundingClientRect();
            const style = getComputedStyle(button);
            return (
              r.width > 0 &&
              r.height > 0 &&
              style.visibility !== 'hidden' &&
              (r.left < -2 ||
                r.right > innerWidth + 2 ||
                r.top < -2 ||
                r.bottom > innerHeight + 2)
            );
          }).length,
          canvasFraction:
            rect && parent && parent.width * parent.height > 0
              ? (rect.width * rect.height) / (parent.width * parent.height)
              : 1,
        };
      });
      const size = `${shot.width}×${shot.height}`;
      if (layout.overflow)
        warnings.push(`${size} 有横向溢出，请检查主要操作是否可达。`);
      if (layout.clipped)
        warnings.push(
          `${size} 有 ${layout.clipped} 个按钮超出视口，请核实是否属于当前界面。`,
        );
      if (layout.canvasFraction < 0.65)
        warnings.push(
          `${size} 画布仅占容器约 ${Math.round(layout.canvasFraction * 100)}% 的面积，请判断留白是否合理；不要拉伸游戏比例。`,
        );
      await page.screenshot({ path: path.join(output, shot.file) });
    }
    await page.setViewportSize({ width: 960, height: 600 });
    await page.locator('#restart-game').click();
    await page.locator('canvas').first().waitFor({ state: 'visible' });
    report.restart = true;
    await page.waitForTimeout(500);
    const results: AcceptanceResult[] = [];
    for (const [index, test] of acceptance.entries()) {
      signal?.throwIfAborted();
      // Each criterion starts from a fresh page; it cannot inherit an earlier test's state.
      const scenarioContext = await browser.newContext({
        viewport: { width: 960, height: 600 },
      });
      const scenario = await scenarioContext.newPage();
      scenario.setDefaultTimeout(3000);
      const errors: string[] = [];
      scenario.on('pageerror', (error) =>
        errors.push(error.message.slice(0, 300)),
      );
      scenario.on('response', (response) => {
        if (response.status() >= 400)
          errors.push(`资源请求失败 ${response.status()}`);
      });
      const result: AcceptanceResult = {
        criterionId: test.criterionId,
        ...(test.variant === undefined ? {} : { variant: test.variant }),
        ...(test.scenario === undefined ? {} : { scenario: test.scenario }),
        status: 'passed',
        steps: test.plan.steps.length,
        screenshot: acceptanceScreenshots[index],
      };
      try {
        await scenario.goto(server.url, { waitUntil: 'load', timeout: 5000 });
        await preparePlaytestPage(scenario, test.plan);
        if (test.scenario) {
          // A fixed bridge call in the sandboxed game, not an arbitrary evaluator supplied by the project.
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              scenario.evaluate(async (name) => {
                const bridge = (
                  window as unknown as {
                    __OPENGAME_TEST__?: {
                      prepareScenario?: (name: string) => unknown;
                    };
                  }
                ).__OPENGAME_TEST__;
                if (typeof bridge?.prepareScenario !== 'function')
                  throw new Error('缺少受控初始场景接口。');
                await bridge.prepareScenario(name);
              }, test.scenario),
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error('初始场景准备超时。')),
                  3000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
        await scenario.locator('#start-game').click();
        await scenario.locator('canvas').first().waitFor({ state: 'visible' });
        const caseSignal = AbortSignal.any([
          ...(signal ? [signal] : []),
          AbortSignal.timeout(10000),
        ]);
        await performPlaytest(scenario, test.plan, caseSignal);
        if (errors.length) throw new Error(errors.join('\n'));
      } catch (error) {
        signal?.throwIfAborted();
        result.status = 'failed';
        result.error = (
          error instanceof Error ? error.message : String(error)
        ).slice(0, 600);
      }
      try {
        await scenario.screenshot({
          path: path.join(output, result.screenshot),
          timeout: 3000,
        });
        if (errors.length && result.status === 'passed') {
          result.status = 'failed';
          result.error = errors.join('\n').slice(0, 600);
        }
        results.push(result);
      } finally {
        await scenarioContext.close();
      }
    }
    report.quality = {
      screenshots: qualityScreenshots.map((shot) => ({ ...shot })),
      playtest: {
        status: playtest ? 'passed' : 'missing',
        steps: playtest?.steps.length || 0,
      },
      warnings: [...new Set(warnings)],
      acceptance: results,
    };
    report.browser = report.errors.length === 0;
    if (!report.browser) throw new Error(report.errors.join('\n'));
    return report;
  } catch (error) {
    throw new Error(
      `浏览器检查未通过：${error instanceof Error ? error.message.slice(0, 900) : String(error)}`,
    );
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
}
