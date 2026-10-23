import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import type { PlaytestPlan, PlaytestStep } from '../shared/game-quality';
import type { AcceptanceCase } from '../shared/game-production';

const keys = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Enter',
  'Escape',
  'w',
  'a',
  's',
  'd',
]);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const integer = (value: unknown, max: number): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= max;

export function parsePlaytestPlan(value: unknown): PlaytestPlan {
  const fail = () => {
    throw new Error(
      'playtest.json 格式无效：只支持限量的点击、按键、页面切换、等待和可见文本检查。',
    );
  };
  if (!value || typeof value !== 'object') return fail();
  const plan = value as Record<string, unknown>;
  if (
    plan.version !== 1 ||
    !Array.isArray(plan.steps) ||
    plan.steps.length < 1 ||
    plan.steps.length > 12
  )
    return fail();
  let duration = 0;
  let away = false;
  let focusChanges = 0;
  const steps: PlaytestStep[] = plan.steps.map((input: unknown) => {
    if (!input || typeof input !== 'object') return fail();
    const s = input as Record<string, unknown>;
    if (s.action === 'focus' && (s.target === 'away' || s.target === 'game')) {
      if (++focusChanges > 2 || (s.target === 'away') === away) return fail();
      away = s.target === 'away';
      return { action: 'focus', target: s.target };
    }
    if (s.action === 'wait' && integer(s.ms, 2000)) {
      duration += s.ms;
      return { action: 'wait', ms: s.ms };
    }
    if (
      s.action === 'key' &&
      typeof s.key === 'string' &&
      keys.has(s.key) &&
      integer(s.holdMs, 1000)
    ) {
      duration += s.holdMs;
      return { action: 'key', key: s.key, holdMs: s.holdMs };
    }
    if (
      s.action === 'expect' &&
      text(s.selector, 160) &&
      (s.text === undefined || text(s.text, 160)) &&
      (s.exact === undefined ||
        (typeof s.exact === 'boolean' && s.text !== undefined))
    )
      return {
        action: 'expect',
        selector: s.selector,
        ...(s.text === undefined ? {} : { text: s.text }),
        ...(s.exact === undefined ? {} : { exact: s.exact as boolean }),
      };
    if (s.action === 'click' && text(s.selector, 160)) {
      if (s.x === undefined && s.y === undefined)
        return { action: 'click', selector: s.selector };
      if (
        [s.x, s.y].every(
          (n) =>
            typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1,
        )
      )
        return {
          action: 'click',
          selector: s.selector,
          x: s.x as number,
          y: s.y as number,
        };
    }
    return fail();
  });
  if (
    away ||
    duration > 5000 ||
    !steps.some((s) => s.action === 'click' || s.action === 'key') ||
    !steps.some((s) => s.action === 'expect')
  )
    return fail();
  return { version: 1, steps };
}

/** Only the host supplies these cases, outside the generated project mount. */
export function parseAcceptanceCases(value: unknown): AcceptanceCase[] {
  if (!Array.isArray(value) || value.length > 8)
    throw new Error('独立验收最多支持八个场景。');
  const seen = new Set<string>();
  return value.map((input) => {
    const criterionId = input?.criterionId;
    if (
      typeof criterionId !== 'string' ||
      !/^[a-z][a-z0-9-]{0,39}$/.test(criterionId)
    )
      throw new Error('独立验收编号无效。');
    for (const field of ['variant', 'scenario']) {
      if (
        input[field] !== undefined &&
        (typeof input[field] !== 'string' ||
          !/^[a-z][a-z0-9-]{0,39}$/.test(input[field]))
      )
        throw new Error('独立验收的分支或初始场景名称无效。');
    }
    const key = `${criterionId}:${input.variant || ''}`;
    if (seen.has(key)) throw new Error('独立验收编号不能重复。');
    seen.add(key);
    const plan = parsePlaytestPlan(input?.plan);
    const firstInput = plan.steps.findIndex(
      (s) => s.action === 'click' || s.action === 'key',
    );
    if (
      !plan.steps.some(
        (s, i) =>
          i > firstInput && s.action === 'expect' && s.text !== undefined,
      )
    )
      throw new Error('独立验收必须在真实操作之后检查可见结果文本。');
    return {
      criterionId,
      ...(input.variant === undefined ? {} : { variant: input.variant }),
      ...(input.scenario === undefined ? {} : { scenario: input.scenario }),
      plan,
    };
  });
}
export function sameAcceptanceCase(
  a: Pick<AcceptanceCase, 'criterionId' | 'variant'>,
  b: Pick<AcceptanceCase, 'criterionId' | 'variant'>,
) {
  return a.criterionId === b.criterionId && a.variant === b.variant;
}

export async function readPlaytestPlan(
  workspace: string,
): Promise<PlaytestPlan | undefined> {
  const file = path.join(workspace, 'playtest.json');
  let info;
  try {
    info = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  if (!info.isFile() || info.size > 16000)
    throw new Error('playtest.json 必须是 16KB 以内的普通文件。');
  return parsePlaytestPlan(JSON.parse(await readFile(file, 'utf8')));
}

export async function preparePlaytestPage(
  page: Page,
  plan?: PlaytestPlan,
): Promise<void> {
  if (!plan?.steps.some((step) => step.action === 'focus')) return;
  // Playwright otherwise forces every tab to report focus. Disable that override
  // after navigation (a new renderer can reset it), before the start click.
  // Subsequent blur/focus events come from real tab switches.
  await (
    await page.context().newCDPSession(page)
  ).send('Emulation.setFocusEmulationEnabled', { enabled: false });
}

export async function performPlaytest(
  page: Page,
  plan: PlaytestPlan,
  signal?: AbortSignal,
): Promise<void> {
  let away: Page | undefined;
  try {
    for (const [index, step] of plan.steps.entries()) {
      signal?.throwIfAborted();
      try {
        if (step.action === 'focus') {
          if (step.target === 'away') {
            away = await page.context().newPage();
            await (
              await page.context().newCDPSession(away)
            ).send('Emulation.setFocusEmulationEnabled', { enabled: false });
            await away.goto('about:blank', { timeout: 3000 });
            await away.bringToFront();
          } else {
            await page.bringToFront();
            await away?.close();
            away = undefined;
          }
        } else if (step.action === 'wait') await page.waitForTimeout(step.ms);
        else if (step.action === 'key') {
          await page.keyboard.down(step.key);
          try {
            await page.waitForTimeout(step.holdMs);
          } finally {
            await page.keyboard.up(step.key);
          }
        } else {
          const target = page.locator(step.selector);
          if (step.action === 'expect') {
            const expected =
              step.exact && step.text !== undefined
                ? new RegExp(
                    `^\\s*${step.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
                  )
                : step.text;
            await (
              expected === undefined
                ? target
                : target.filter({ hasText: expected })
            ).waitFor({ state: 'visible', timeout: 3000 });
          } else if (step.x === undefined || step.y === undefined) {
            await target.click({ timeout: 3000 });
          } else {
            await target.waitFor({ state: 'visible', timeout: 3000 });
            const box = await target.boundingBox();
            if (!box || box.width <= 0 || box.height <= 0)
              throw new Error('目标不可见');
            // Locator click retains actionability checks; normalized coordinates scale with the canvas.
            await target.click({
              position: { x: box.width * step.x, y: box.height * step.y },
              timeout: 3000,
            });
          }
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        // Playwright often puts the obstructing element or final retry reason at the end.
        const detail =
          message.length > 450
            ? `${message.slice(0, 160)}\n…\n${message.slice(-285)}`
            : message;
        throw new Error(
          `试玩第 ${index + 1} 步（${step.action}）失败：${detail}`,
        );
      }
    }
  } finally {
    if (away) {
      await away.close().catch(() => {});
      await page.bringToFront().catch(() => {});
    }
  }
}
