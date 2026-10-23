import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';

// A local, independent rules comparison. This does not drive a browser or call a model.
// Read/audit each generated module before running; Node vm is not a security boundary.
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes('--generated')) {
  throw new Error(
    'Usage: node check.mjs --generated /absolute/project/src/rules.ts [--output /absolute/report.json]',
  );
}
const generatedPath = path.resolve(option('--generated'));
const referencePath = args.includes('--reference')
  ? path.resolve(option('--reference'))
  : '/Users/cj/ai/game/yanglegeyang/src/experiment/engine.ts';
const apiNames = ['initial', 'active', 'clickable', 'step'];

async function loadRules(entry) {
  const sourceDir = path.dirname(entry);
  // A pure rules module may read its own static project configuration.
  const root = await realpath(
    path.basename(sourceDir) === 'src' ? path.dirname(sourceDir) : sourceDir,
  );
  const compiled = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'RuleModule',
    target: 'es2022',
    metafile: true,
    plugins: [
      {
        name: 'local-rules-only',
        setup(context) {
          context.onResolve({ filter: /.*/ }, (value) => {
            if (value.kind !== 'entry-point' && !value.path.startsWith('.')) {
              return {
                errors: [{ text: 'Rules must not import external packages.' }],
              };
            }
          });
          context.onLoad({ filter: /.*/ }, async (value) => {
            const location = await realpath(value.path);
            if (!location.startsWith(`${root}${path.sep}`)) {
              return {
                errors: [
                  { text: 'Rules must stay within their project directory.' },
                ],
              };
            }
          });
        },
      },
    ],
  });
  const context = vm.createContext(
    { structuredClone },
    { codeGeneration: { strings: false, wasm: false } },
  );
  vm.runInContext(compiled.outputFiles[0].text, context, { timeout: 1000 });
  const exports = vm.runInContext('Object.keys(RuleModule)', context);
  for (const name of apiNames)
    assert.ok(exports.includes(name), `Missing export ${name}`);
  const inputHashes = {};
  for (const input of Object.keys(compiled.metafile.inputs).sort()) {
    inputHashes[input] = createHash('sha256')
      .update(await readFile(input))
      .digest('hex');
  }
  return {
    inputHashes,
    call(name, ...values) {
      assert.ok(apiNames.includes(name));
      context.payload = JSON.stringify(values);
      // Results cross only as JSON, and each invocation has a finite CPU timeout.
      const result = vm.runInContext(
        `JSON.stringify((() => {
        const input = JSON.parse(payload);
        const before = JSON.stringify(input);
        let output; let error;
        try { output = RuleModule.${name}(...input); }
        catch (e) { error = String(e.message || e); }
        if (JSON.stringify(input) !== before) throw Error('Input state mutated');
        return error === undefined ? { output } : { error };
      })())`,
        context,
        { timeout: 1000 },
      );
      return JSON.parse(result);
    },
  };
}

const reference = await loadRules(referencePath);
const generated = await loadRules(generatedPath);
const outcomes = [];
let comparedActions = 0;
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      // The brief specifies removed membership, not ordering. Tray/stash order remains exact.
      key === 'removed' && Array.isArray(item)
        ? [...item].sort((a, b) => a - b)
        : comparable(item),
    ]),
  );
}
function same(name, ...values) {
  const expected = reference.call(name, ...values);
  const actual = generated.call(name, ...values);
  if (expected.error)
    assert.ok(actual.error, `${name} accepted an invalid operation`);
  else {
    assert.equal(actual.error, undefined, actual.error);
    assert.deepEqual(
      comparable(actual.output),
      comparable(expected.output),
      `${name} differs from frozen rules`,
    );
  }
  return actual.output;
}
function fixture(types, overrides = {}) {
  return {
    tiles: types.map((type, id) => ({ id, type, x: id * 2, y: 0, z: 0 })),
    tray: [],
    stash: [],
    removed: [],
    rng: 1,
    used: 0,
    status: 'playing',
    seq: 0,
    history: null,
    ...overrides,
  };
}
function act(state, kind, id = 0) {
  comparedActions++;
  return same('step', state, { seq: state.seq + 1, kind, id });
}
function pick(state, ...ids) {
  for (const id of ids) state = act(state, 'pick', id);
  return state;
}
async function check(name, fn) {
  try {
    await fn();
    outcomes.push({ name, passed: true });
  } catch (error) {
    outcomes.push({
      name,
      passed: false,
      error: String(error.message).slice(0, 2200),
    });
  }
}

await check('多个种子的标准关和教学关与原规则完全一致', () => {
  for (const seed of [1, 2, 3, 42, 77, 12345, 65535, 0x7fffffff, 0xffffffff]) {
    for (const mode of ['full', 'small']) same('initial', seed, mode);
  }
  assert.equal(same('initial', 1, 'full').tiles.length, 177);
  assert.deepEqual(
    same('initial', 1, 'small').tiles.map((t) => t.type),
    [9, 9, 9, 5, 1, 9, 1, 5, 5, 9, 1, 9],
  );
});
await check('拒绝无效种子和不存在的关卡', () => {
  for (const seed of [0, -1, 1.5, 0x100000000]) same('initial', seed, 'full');
  same('initial', 1, 'missing');
});
await check('高层遮挡禁止选牌，移走上层后解锁', () => {
  let s = fixture([0, 1, 2]);
  s.tiles[1] = { ...s.tiles[1], x: 1, y: 1, z: 1 };
  assert.equal(same('clickable', s, 0), false);
  same('step', s, { seq: 1, kind: 'pick', id: 0 });
  s = act(s, 'pick', 1);
  assert.equal(same('clickable', s, 0), true);
});
await check('三消、排序及同一张牌不能重复选取', () => {
  let s = fixture([2, 0, 2, 2, 0, 0, 1, 1, 1]);
  s = pick(s, 0, 1, 2, 3);
  assert.deepEqual(s.removed, [0, 2, 3]);
  assert.deepEqual(s.tray, [1]);
  same('step', s, { seq: s.seq + 1, kind: 'pick', id: 0 });
});
await check('第七张形成三消时先消除而不是判负', () => {
  const s = pick(fixture([0, 0, 1, 1, 2, 2, 0, 1, 2]), 0, 1, 2, 3, 4, 5, 6);
  assert.equal(s.status, 'playing');
  assert.equal(s.tray.length, 4);
});
await check('七格未消除即失败且终局不能操作', () => {
  const s = pick(
    fixture(Array.from({ length: 21 }, (_, i) => i % 7)),
    0,
    1,
    2,
    3,
    4,
    5,
    6,
  );
  assert.equal(s.status, 'lost');
  for (const kind of ['pick', 'retrieve', 'undo', 'shuffle', 'stash'])
    same('step', s, { seq: s.seq + 1, kind, id: 0 });
});
await check('暂存前三张并消耗一次，取回走同一三消规则', () => {
  let s = pick(fixture([0, 1, 2, 0, 1, 2, 0, 1, 2]), 0, 1, 2);
  s = act(s, 'stash');
  assert.equal(s.used & 1, 1);
  assert.deepEqual(s.stash, [0, 1, 2]);
  assert.equal(s.history, null);
  assert.equal(s.tray.length, 0);
  s = pick(s, 3, 4, 5);
  same('step', s, { seq: s.seq + 1, kind: 'stash', id: 0 });
  s = act(s, 'retrieve', 0);
  assert.equal(s.stash.length, 2);
  s = act(s, 'pick', 6);
  assert.deepEqual(s.removed, [0, 3, 6]);
});
await check('撤销完整恢复三消前状态且不能再次撤销', () => {
  const before = pick(fixture([0, 0, 0, 1, 1, 1]), 0, 1);
  let s = act(before, 'pick', 2);
  s = act(s, 'undo');
  assert.deepEqual(s.tray, before.tray);
  assert.deepEqual(s.removed, []);
  assert.equal(s.used & 4, 4);
  assert.equal(s.history, null);
  same('step', s, { seq: s.seq + 1, kind: 'undo', id: 0 });
});
await check('撤销取回能恢复暂存牌和已用道具', () => {
  let s = act(pick(fixture([0, 1, 2, 0, 1, 2, 0, 1, 2]), 0, 1, 2), 'stash');
  const before = structuredClone(s);
  s = act(s, 'retrieve', 0);
  s = act(s, 'undo');
  assert.deepEqual(s.stash, before.stash);
  assert.deepEqual(s.tray, []);
  assert.equal(s.used, 5);
});
await check('洗牌仅改棋盘类型、保留牌总数并阻止重复使用', () => {
  const before = pick(same('initial', 1, 'small'), 0, 3);
  const s = act(before, 'shuffle');
  assert.deepEqual(s.tray, before.tray);
  assert.equal(s.tiles.length, before.tiles.length);
  assert.equal(s.tiles[0].type, before.tiles[0].type);
  assert.equal(s.tiles[3].type, before.tiles[3].type);
  assert.equal(s.history, null);
  assert.equal(s.used & 2, 2);
  same('step', s, { seq: s.seq + 1, kind: 'shuffle', id: 0 });
  same('step', s, { seq: s.seq + 1, kind: 'undo', id: 0 });
});
await check('棋盘清空但有暂存牌时不胜利，全部消除才胜利', () => {
  let s = act(pick(fixture([0, 1, 2, 0, 1, 2, 0, 1, 2]), 0, 1, 2), 'stash');
  s = pick(s, 3, 6, 4, 7, 5, 8);
  assert.equal(same('active', s).length, 0);
  assert.equal(s.status, 'playing');
  s = act(s, 'retrieve', 0);
  s = act(s, 'retrieve', 1);
  s = act(s, 'retrieve', 2);
  assert.equal(s.status, 'won');
  assert.equal(s.tray.length + s.stash.length, 0);
  same('step', s, { seq: s.seq + 1, kind: 'undo', id: 0 });
});
await check('动作序号、牌来源和道具前置条件拒绝无效操作', () => {
  const s = same('initial', 1, 'small');
  for (const action of [
    { seq: 0, kind: 'pick', id: 0 },
    { seq: 2, kind: 'pick', id: 0 },
    { seq: 1, kind: 'pick', id: 9999 },
    { seq: 1, kind: 'retrieve', id: 0 },
    { seq: 1, kind: 'stash', id: 0 },
    { seq: 1, kind: 'undo', id: 0 },
    { seq: 1, kind: 'shuffle', id: 1 },
    { seq: 1, kind: 'unknown', id: 0 },
  ])
    same('step', s, action);
});
await check('教学关真实规则完整通关与重新初始化', () => {
  let s = same('initial', 1, 'small');
  s = pick(s, 0, 1, 2, 3, 7, 8, 4, 6, 10, 5, 9, 11);
  assert.equal(s.status, 'won');
  assert.equal(s.removed.length, 12);
  const fresh = same('initial', 1, 'small');
  assert.equal(fresh.used, 0);
  assert.equal(fresh.seq, 0);
  assert.equal(fresh.status, 'playing');
});
await check('跨种子完整动作序列持续与原项目对照且保持牌守恒', () => {
  for (let seed = 1; seed <= 24; seed++) {
    let s = same('initial', seed, seed % 2 ? 'full' : 'small');
    for (let turn = 0; turn < 240 && s.status === 'playing'; turn++) {
      const board = same('active', s);
      const available = board.filter((t) => same('clickable', s, t.id));
      if (turn === 4 && s.history && !(s.used & 4)) s = act(s, 'undo');
      else if (turn === 9 && !(s.used & 2) && board.length)
        s = act(s, 'shuffle');
      else if (s.tray.length >= 5 && !(s.used & 1)) s = act(s, 'stash');
      else {
        const candidates = [
          ...available.map((t) => ({ kind: 'pick', id: t.id })),
          ...s.stash.map((id) => ({ kind: 'retrieve', id })),
        ];
        if (!candidates.length) break;
        candidates.sort((a, b) => {
          const count = (id) =>
            s.tray.filter((x) => s.tiles[x].type === s.tiles[id].type).length;
          return (
            count(b.id) - count(a.id) ||
            ((a.id + seed) % 17) - ((b.id + seed) % 17) ||
            a.id - b.id
          );
        });
        s = act(s, candidates[0].kind, candidates[0].id);
      }
      const ids = [
        ...same('active', s).map((t) => t.id),
        ...s.tray,
        ...s.stash,
        ...s.removed,
      ];
      assert.equal(ids.length, s.tiles.length);
      assert.equal(new Set(ids).size, s.tiles.length);
    }
  }
});

const report = {
  checkedAt: new Date().toISOString(),
  referencePath,
  generatedPath,
  referenceHashes: reference.inputHashes,
  generatedHashes: generated.inputHashes,
  comparedActions,
  passed: outcomes.filter((r) => r.passed).length,
  total: outcomes.length,
  outcomes,
};
if (args.includes('--output')) {
  const output = path.resolve(option('--output'));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
if (report.passed !== report.total) process.exitCode = 1;
