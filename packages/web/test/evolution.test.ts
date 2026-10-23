import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash } from '../src/server/public-knowledge';
import { regressionSuite } from '../src/server/evolution-regression';
import { assertRegressionReport } from '../src/server/evolution';
import type { RegressionReport } from '../src/shared/evolution';

test('content hashes survive JSONB key order but detect changed advice and array order', () => {
  assert.equal(
    contentHash({ a: 1, nested: { c: 3, b: 2 } }),
    contentHash({ nested: { b: 2, c: 3 }, a: 1 }),
  );
  assert.notEqual(
    contentHash({ advice: 'old' }),
    contentHash({ advice: 'new' }),
  );
  assert.notEqual(contentHash(['one', 'two']), contentHash(['two', 'one']));
});

test('release evidence cannot omit, duplicate, or silently fail fixed regression cases', async () => {
  const suite = await regressionSuite();
  assert.equal(
    suite.cases.reduce((n, c) => n + c.tests.length, 0),
    27,
  );
  const report: RegressionReport = {
    contentHash: 'b'.repeat(64),
    suiteHash: suite.hash,
    scope: 'reference-rules',
    checkedAt: new Date().toISOString(),
    passed: true,
    environment: { kind: 'docker', image: `sha256:${'a'.repeat(64)}` },
    cases: suite.cases.map((c) => ({
      id: c.id,
      title: c.title,
      passed: true,
      durationMs: 1,
      tests: c.tests.map((name) => ({ name, passed: true })),
    })),
  };
  assert.doesNotThrow(() => assertRegressionReport(report, suite));
  for (const change of [
    (r: RegressionReport) => {
      r.cases.pop();
    },
    (r: RegressionReport) => {
      r.cases[1] = r.cases[0];
    },
    (r: RegressionReport) => {
      r.cases[0].tests.pop();
    },
    (r: RegressionReport) => {
      r.cases[0].tests[0].passed = false;
    },
    (r: RegressionReport) => {
      r.suiteHash = 'c'.repeat(64);
    },
  ]) {
    const broken = structuredClone(report);
    change(broken);
    assert.throws(() => assertRegressionReport(broken, suite));
  }
});
