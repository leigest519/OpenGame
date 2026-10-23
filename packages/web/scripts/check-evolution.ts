import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from '../src/server/config';
import {
  regressionSuite,
  runEvolutionRegression,
} from '../src/server/evolution-regression';
import { contentHash } from '../src/server/public-knowledge';

const suite = await regressionSuite();
const report = await runEvolutionRegression({
  releaseId: randomUUID(),
  suiteHash: suite.hash,
  contentHash: contentHash([]),
  signal: AbortSignal.timeout(180000),
});
await mkdir(dataRoot, { recursive: true, mode: 0o700 });
await writeFile(
  path.join(dataRoot, 'evolution-verification.json'),
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      scope: report.scope,
      cases: report.cases.map((c) => ({
        title: c.title,
        passed: c.passed,
        tests: c.tests.length,
        durationMs: c.durationMs,
      })),
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
