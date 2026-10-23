import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseAcceptanceCases,
  parsePlaytestPlan,
  performPlaytest,
  readPlaytestPlan,
} from '../src/server/game-playtest';
import type { Page } from 'playwright';
import {
  generateReviewedGame,
  parseProductionReview,
  stageReviewImages,
} from '../src/server/game-generation';
import { RuntimeUnavailableError } from '../src/server/project-runtime';
import {
  acceptanceScreenshots,
  qualityScreenshots,
} from '../src/shared/game-quality';
import {
  productionPlanSchema,
  type AcceptanceCase,
  type ProductionPlan,
} from '../src/shared/game-production';

const inputPlan = parsePlaytestPlan({
  version: 1,
  steps: [
    { action: 'click', selector: 'canvas', x: 0.2, y: 0.3 },
    { action: 'expect', selector: '#coins', text: '170', exact: true },
  ],
});
const production: ProductionPlan = {
  coreLoop: '有限资源建造，守住一波后调整选择',
  firstPlayable: '一波包含建造和反馈',
  completion: '补齐重开流程',
  visualDirection: '对象清楚可辨',
  feedback: '建造有反馈',
  assumptions: ['一波为默认设计'],
  criteria: [
    {
      id: 'build',
      stage: 'slice',
      kind: 'behavior',
      expectation: '建造扣款，剩余170',
    },
    {
      id: 'readability',
      stage: 'slice',
      kind: 'presentation',
      expectation: '塔和塔位可区分',
    },
    {
      id: 'restart',
      stage: 'delivery',
      kind: 'behavior',
      expectation: '重开恢复300',
    },
  ],
};
const buildCase: AcceptanceCase = { criterionId: 'build', plan: inputPlan };
const resetCase: AcceptanceCase = {
  criterionId: 'restart',
  plan: parsePlaytestPlan({
    version: 1,
    steps: [
      inputPlan.steps[0],
      { action: 'click', selector: '#restart-game' },
      { action: 'expect', selector: '#coins', text: '300', exact: true },
    ],
  }),
};
const simple = {
  ...production,
  completion: production.firstPlayable,
  criteria: production.criteria.slice(0, 2),
};

function review(stage: 'slice' | 'delivery', frozen: AcceptanceCase[]) {
  return {
    criteria: production.criteria
      .filter((c) => stage === 'delivery' || c.stage === 'slice')
      .map((c) => ({
        criterionId: c.id,
        status: 'met',
        evidence: '实际画面及规则符合约定；行为仍需执行',
        fix: '',
      })),
    tests: [buildCase, ...(stage === 'delivery' ? [resetCase] : [])].filter(
      (c) => !frozen.some((f) => f.criterionId === c.criterionId),
    ),
  };
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'production-pipeline-'));
  const workspace = path.join(directory, 'project');
  await mkdir(path.join(workspace, 'src'), { recursive: true });
  const options = {
    workspace,
    output: path.join(directory, 'artifact'),
    prompt: '制作守卫游戏',
    referenceImages: ['user.png'],
    signal: new AbortController().signal,
    mode: 'create' as 'create' | 'modify',
    plan: production as ProductionPlan | undefined,
    deadline: Date.now() + 600000,
  };
  const calls: { readOnly: boolean; prompt: string; images: string[] }[] = [];
  const suites: AcceptanceCase[][] = [];
  let writes = 0;
  const services: Parameters<typeof generateReviewedGame>[1] = {
    async generate(input) {
      calls.push(input);
      if (input.readOnly && input.prompt.includes('本轮仅制定制作约定'))
        return JSON.stringify(production);
      if (input.readOnly) {
        assert.equal(
          await readFile(input.images[0], 'utf8'),
          `image-${writes}`,
        );
        return JSON.stringify(
          review(
            input.prompt.includes('当前阶段 delivery') ? 'delivery' : 'slice',
            suites.at(-1) || [],
          ),
        );
      }
      writes++;
      await writeFile(path.join(workspace, 'src/main.ts'), `version ${writes}`);
      return `summary-${writes}`;
    },
    async check(output, acceptance) {
      suites.push(structuredClone(acceptance));
      await mkdir(output);
      for (const file of ['index.html', 'game.js', 'base.css'])
        await writeFile(path.join(output, file), `version-${writes}`);
      for (const shot of [
        ...qualityScreenshots.map((s) => s.file),
        ...acceptance.map((_, i) => acceptanceScreenshots[i]),
      ])
        await writeFile(path.join(output, shot), `image-${writes}`);
      return {
        build: true,
        browser: true,
        start: true,
        restart: true,
        errors: [],
        checkedAt: new Date().toISOString(),
        quality: {
          screenshots: qualityScreenshots.map((s) => ({ ...s })),
          playtest: { status: 'passed', steps: 2 },
          warnings: [],
          acceptance: acceptance.map((c, i) => ({
            criterionId: c.criterionId,
            status: 'passed',
            steps: c.plan.steps.length,
            screenshot: acceptanceScreenshots[i],
          })),
        },
      };
    },
    async progress() {},
  };
  return {
    directory,
    options,
    services,
    calls,
    suites,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test('input plans bound actions and time; independent checks require an outcome after input', () => {
  assert.deepEqual(parsePlaytestPlan(inputPlan), inputPlan);
  for (const steps of [
    [{ action: 'evaluate', script: 'process.exit()' }],
    [{ action: 'expect', selector: 'canvas' }],
    [
      { action: 'click', selector: 'canvas', x: 1.01, y: 0 },
      inputPlan.steps[1],
    ],
    [{ action: 'key', key: 'Meta+Q', holdMs: 1 }, inputPlan.steps[1]],
    [
      inputPlan.steps[0],
      { action: 'focus', target: 'https://example.com' },
      inputPlan.steps[1],
    ],
    [
      inputPlan.steps[0],
      { action: 'focus', target: 'game' },
      inputPlan.steps[1],
    ],
    [
      inputPlan.steps[0],
      { action: 'focus', target: 'away' },
      inputPlan.steps[1],
    ],
    [
      inputPlan.steps[0],
      ...Array(3).fill({ action: 'wait', ms: 2000 }),
      inputPlan.steps[1],
    ],
    Array(13).fill(inputPlan.steps[0]),
  ])
    assert.throws(
      () => parsePlaytestPlan({ version: 1, steps }),
      /playtest.json/,
    );
  assert.equal(
    parsePlaytestPlan({
      version: 1,
      steps: [
        inputPlan.steps[0],
        { action: 'focus', target: 'away' },
        { action: 'focus', target: 'game' },
        inputPlan.steps[1],
      ],
    }).steps.length,
    4,
  );
  assert.throws(() =>
    parseAcceptanceCases([{ criterionId: '../outside', plan: inputPlan }]),
  );
  assert.throws(() => parseAcceptanceCases([buildCase, buildCase]), /重复/);
  assert.throws(
    () => parseAcceptanceCases([{ ...buildCase, scenario: '() => true' }]),
    /初始场景/,
  );
  assert.equal(
    parseAcceptanceCases([
      buildCase,
      { ...buildCase, variant: 'late', scenario: 'near-end' },
    ]).length,
    2,
  );
  assert.throws(
    () =>
      parseAcceptanceCases([
        {
          criterionId: 'build',
          plan: { version: 1, steps: [...inputPlan.steps].reverse() },
        },
      ]),
    /操作之后/,
  );
});

test('plans and reviews cannot lose requirements, claim behavior without execution, or weaken frozen cases', () => {
  assert.throws(() =>
    productionPlanSchema.parse({
      ...production,
      criteria: [production.criteria[0], production.criteria[0]],
    }),
  );
  assert.throws(() =>
    productionPlanSchema.parse({
      ...production,
      criteria: production.criteria.filter((c) => c.kind === 'presentation'),
    }),
  );
  const value = review('slice', []);
  assert.throws(
    () =>
      parseProductionReview(
        JSON.stringify({ ...value, criteria: value.criteria.slice(1) }),
        production,
        'slice',
        [],
      ),
    /不能删减/,
  );
  assert.throws(
    () =>
      parseProductionReview(
        JSON.stringify({ ...value, tests: [] }),
        production,
        'slice',
        [],
      ),
    /真实输入/,
  );
  const changed = {
    ...buildCase,
    plan: {
      ...inputPlan,
      steps: [
        inputPlan.steps[0],
        { action: 'expect', selector: '#coins', text: '999' },
      ],
    },
  };
  assert.throws(
    () =>
      parseProductionReview(
        JSON.stringify({ ...value, tests: [changed] }),
        production,
        'slice',
        [buildCase],
      ),
    /不能修改/,
  );
  assert.equal(
    parseProductionReview(
      JSON.stringify({ ...value, tests: [] }),
      production,
      'slice',
      [buildCase],
    ).criteria.length,
    2,
  );
  const pending = structuredClone(value);
  pending.criteria[0].status = 'pending-test';
  assert.throws(
    () =>
      parseProductionReview(
        JSON.stringify({ ...pending, tests: [] }),
        production,
        'slice',
        [],
      ),
    /新场景/,
  );
  pending.criteria[1].status = 'pending-test';
  assert.throws(
    () =>
      parseProductionReview(JSON.stringify(pending), production, 'slice', []),
    /行为项/,
  );
});

test('simple games finish after evidence passes, without a mandatory polish write', async () => {
  const f = await fixture();
  f.options.plan = simple;
  try {
    const result = await generateReviewedGame(f.options, f.services);
    assert.deepEqual(
      f.calls.map((c) => c.readOnly),
      [false, true],
    );
    assert.equal(result.summary, 'summary-1');
    assert.equal(result.validation.quality?.reviewed, undefined);
    assert.deepEqual(
      f.suites.map((s) => s.length),
      [0, 1],
    );
    assert.equal(
      result.validation.quality?.production?.criteria[0].method,
      'browser-and-review',
    );
    assert.equal(
      result.validation.quality?.production?.criteria[1].method,
      'presentation-review',
    );
    const saved = JSON.parse(
      await readFile(
        path.join(f.options.workspace, 'production-report.json'),
        'utf8',
      ),
    );
    assert.equal(
      saved.planHash,
      result.validation.quality?.production?.planHash,
    );
    assert.equal(saved.generations, 1);
  } finally {
    await f.cleanup();
  }
});

test('new passing evidence resolves an unverified review without another code-writing call', async () => {
  const f = await fixture();
  f.options.plan = simple;
  const generate = f.services.generate;
  let reviews = 0;
  f.services.generate = async (input) => {
    const response = await generate(input);
    if (input.readOnly && ++reviews === 1) {
      const value = JSON.parse(response);
      value.criteria[0].status = 'unverified';
      value.criteria[0].fix = '只缺独立场景执行结果，不需要修改实现。';
      return JSON.stringify(value);
    }
    return response;
  };
  try {
    const result = await generateReviewedGame(f.options, f.services);
    assert.deepEqual(
      f.calls.map((c) => c.readOnly),
      [false, true, true],
    );
    assert.equal(result.validation.quality?.production?.generations, 1);
    assert.equal(result.validation.quality?.production?.reviews, 2);
    assert.equal(
      result.validation.quality?.production?.checkpoints[0].buildHash,
      result.validation.quality?.production?.checkpoints[1].buildHash,
    );
  } finally {
    await f.cleanup();
  }
});

test('a pending test is confirmed only by execution; it needs neither a rewrite nor another model verdict', async () => {
  for (const pass of [true, false]) {
    const f = await fixture();
    f.options.plan = simple;
    const generate = f.services.generate;
    f.services.generate = async (input) => {
      const reply = await generate(input);
      if (!input.readOnly) return reply;
      const value = JSON.parse(reply);
      value.criteria[0].status = 'pending-test';
      return JSON.stringify(value);
    };
    const check = f.services.check;
    f.services.check = async (...args) => {
      const report = await check(...args);
      if (!pass && report.quality!.acceptance!.length) {
        report.quality!.acceptance![0].status = 'failed';
        report.quality!.acceptance![0].error = '实际扣款与预期不符';
      }
      return report;
    };
    try {
      if (pass) {
        const result = await generateReviewedGame(f.options, f.services);
        assert.deepEqual(
          f.calls.map((c) => c.readOnly),
          [false, true],
        );
        assert.match(
          result.validation.quality!.production!.criteria[0].evidence,
          /平台.*场景通过/,
        );
      } else {
        await assert.rejects(
          generateReviewedGame(f.options, f.services),
          /四次制作机会/,
        );
        await assert.rejects(
          readFile(path.join(f.options.workspace, 'production-report.json')),
          /ENOENT/,
        );
      }
    } finally {
      await f.cleanup();
    }
  }
});

test('repair diagnostics retain the final obstruction instead of only the click preamble', async () => {
  const page = {
    locator: () => ({
      click: async () => {
        throw new Error(
          'locator.click: Timeout\n' +
            'waiting for target\n'.repeat(50) +
            '<div id="overlay"> intercepts pointer events',
        );
      },
    }),
  } as unknown as Page;
  await assert.rejects(
    performPlaytest(page, {
      version: 1,
      steps: [{ action: 'click', selector: '#build' }],
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /intercepts pointer events/);
      assert.ok(error.message.length < 600);
      return true;
    },
  );
});

test('an unsupported observation stops without spending calls rewriting a game that has no known defect', async () => {
  const f = await fixture();
  f.options.plan = simple;
  const generate = f.services.generate;
  f.services.generate = async (input) => {
    const reply = await generate(input);
    if (!input.readOnly) return reply;
    const value = JSON.parse(reply);
    value.criteria[0].status = 'unverified';
    value.criteria[0].fix =
      '当前平台无法观察此结果，需要补充观测能力；没有源码缺陷证据。';
    value.tests = [];
    return JSON.stringify(value);
  };
  try {
    await assert.rejects(
      generateReviewedGame(f.options, f.services),
      /证据缺口.*继续改写/,
    );
    assert.deepEqual(
      f.calls.map((c) => c.readOnly),
      [false, true],
    );
  } finally {
    await f.cleanup();
  }
});

test('a failed slice is repaired using frozen expectations before expansion; final checks retain earlier cases', async () => {
  const f = await fixture();
  const check = f.services.check;
  let failed = false;
  f.services.check = async (...args) => {
    const report = await check(...args);
    if (!failed && args[1].length) {
      failed = true;
      report.quality!.acceptance![0].status = 'failed';
      report.quality!.acceptance![0].error = '扣款后金币错误';
    }
    return report;
  };
  try {
    const result = await generateReviewedGame(f.options, f.services);
    const writing = f.calls.filter((c) => !c.readOnly);
    assert.equal(writing.length, 3);
    assert.match(writing[1].prompt, /制作阶段：slice/);
    assert.match(writing[1].prompt, /扣款后金币错误/);
    assert.match(writing[2].prompt, /制作阶段：delivery/);
    for (const suite of f.suites.filter((s) => s.length))
      assert.deepEqual(suite[0], buildCase);
    assert.deepEqual(f.suites.at(-1), [buildCase, resetCase]);
    assert.equal(result.validation.quality?.production?.criteria.length, 3);
    const checkpoint = path.join(
      f.options.workspace,
      '.opengame-context/quality-review/check-1',
    );
    assert.equal(
      await readFile(path.join(checkpoint, 'game.js'), 'utf8'),
      'version-1',
    );
    assert.equal(
      await readFile(path.join(checkpoint, 'project/src/main.ts'), 'utf8'),
      'version 1',
    );
    assert.equal(
      await readFile(path.join(f.options.output, 'game.js'), 'utf8'),
      'version-3',
    );
  } finally {
    await f.cleanup();
  }
});

test('legacy plans are completed read-only before writing; modifications skip the slice stage', async () => {
  const f = await fixture();
  f.options.plan = undefined;
  f.options.mode = 'modify';
  try {
    await generateReviewedGame(f.options, f.services);
    assert.deepEqual(
      f.calls.map((c) => c.readOnly),
      [true, false, true],
    );
    assert.match(f.calls[1].prompt, /制作阶段：delivery/);
  } finally {
    await f.cleanup();
  }
});

test('repeated behavioral failure exhausts a bounded budget and never publishes a partial version', async () => {
  const f = await fixture();
  f.options.plan = simple;
  const check = f.services.check;
  f.services.check = async (...args) => {
    const result = await check(...args);
    for (const item of result.quality!.acceptance!) {
      item.status = 'failed';
      item.error = 'incorrect balance';
    }
    return result;
  };
  try {
    await assert.rejects(
      generateReviewedGame(f.options, f.services),
      /四次制作/,
    );
    assert.equal(f.calls.filter((c) => !c.readOnly).length, 4);
    assert.equal(f.calls.filter((c) => c.readOnly).length, 1);
    await assert.rejects(
      readFile(path.join(f.options.workspace, 'production-report.json')),
      /ENOENT/,
    );
  } finally {
    await f.cleanup();
  }
});

test('incomplete or malformed reviews cannot trigger a game rewrite or approval', async () => {
  const f = await fixture();
  const generate = f.services.generate;
  f.services.generate = (input) =>
    input.readOnly
      ? Promise.resolve('{"criteria":[],"tests":[]}')
      : generate(input);
  try {
    await assert.rejects(generateReviewedGame(f.options, f.services));
    assert.equal(f.calls.filter((c) => !c.readOnly).length, 1);
  } finally {
    await f.cleanup();
  }
});

test('runtime outages, cancellation, and insufficient remaining time do not spend repair calls', async () => {
  for (const scenario of ['outage', 'cancel', 'budget']) {
    const f = await fixture();
    const controller = new AbortController();
    f.options.signal = controller.signal;
    if (scenario === 'budget') f.options.deadline = Date.now() + 1000;
    f.services.check = async () => {
      if (scenario === 'cancel') controller.abort();
      throw new RuntimeUnavailableError('unavailable');
    };
    try {
      await assert.rejects(generateReviewedGame(f.options, f.services));
      assert.equal(f.calls.length, scenario === 'budget' ? 0 : 1);
    } finally {
      await f.cleanup();
    }
  }
});

test('missing smoke plan gets one technical repair and cannot reach review', async () => {
  const f = await fixture();
  const check = f.services.check;
  f.services.check = async (...args) => {
    const value = await check(...args);
    value.quality!.playtest = { status: 'missing', steps: 0 };
    return value;
  };
  try {
    await assert.rejects(
      generateReviewedGame(f.options, f.services),
      /缺少有效/,
    );
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every((c) => !c.readOnly));
  } finally {
    await f.cleanup();
  }
});

test('missing legacy smoke plans and symlinked evidence remain distinguishable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'game-plan-'));
  try {
    assert.equal(await readPlaytestPlan(dir), undefined);
    await writeFile(path.join(dir, 'saved.json'), JSON.stringify(inputPlan));
    await symlink(
      path.join(dir, 'saved.json'),
      path.join(dir, 'playtest.json'),
    );
    await assert.rejects(readPlaytestPlan(dir), /普通文件/);
    await rm(path.join(dir, 'playtest.json'));
    await writeFile(path.join(dir, 'playtest.json'), JSON.stringify(inputPlan));
    assert.deepEqual(await readPlaytestPlan(dir), inputPlan);
    const workspace = path.join(dir, 'project'),
      outside = path.join(dir, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    await symlink(outside, path.join(workspace, '.opengame-context'));
    await assert.rejects(stageReviewImages(workspace, dir), /普通目录/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
