import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { dataRoot, webRoot } from './config';
import { contentHash } from './public-knowledge';
import { ProjectContainer, requireRuntimeImage } from './project-runtime';
import type {
  RegressionCaseResult,
  RegressionReport,
} from '../shared/evolution';

const root = path.join(webRoot, 'benchmarks/popular');
const digest = (value: Buffer | string) =>
  createHash('sha256').update(value).digest('hex');
const caseSchema = z
  .object({
    id: z.enum(['block', 'merge', 'crossing']),
    title: z.string().max(80),
    projectId: z.string().uuid(),
    versionId: z.string().uuid(),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    files: z.record(
      z.string().regex(/^(gameConfig\.json|src\/(?:modules\/)?[a-z]+\.ts)$/),
      z.string().regex(/^[a-f0-9]{64}$/),
    ),
    checkerHash: z.string().regex(/^[a-f0-9]{64}$/),
    tests: z.array(z.string().max(100)).min(1).max(40),
  })
  .strict();

async function checkedFile(file: string, expected?: string): Promise<Buffer> {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1000000)
    throw new Error('回归样例文件不符合约定。');
  const bytes = await readFile(file);
  if (expected && digest(bytes) !== expected)
    throw new Error('回归样例或检查器已变化，需要重新登记测试版本。');
  return bytes;
}

export async function regressionSuite() {
  const manifest = z
    .object({
      version: z.literal(1),
      scope: z.literal('reference-rules'),
      cases: z.array(caseSchema).length(3),
    })
    .strict()
    .parse(
      JSON.parse(
        (await checkedFile(path.join(root, 'manifest.json'))).toString(),
      ),
    );
  if (new Set(manifest.cases.map((c) => c.id)).size !== 3)
    throw new Error('回归样例不完整。');
  for (const item of manifest.cases) {
    await checkedFile(
      path.join(root, `check-${item.id}.mjs`),
      item.checkerHash,
    );
    for (const [file, hash] of Object.entries(item.files))
      await checkedFile(path.join(root, 'fixtures', item.id, file), hash);
  }
  return { ...manifest, hash: contentHash(manifest) };
}

export async function runEvolutionRegression(options: {
  releaseId: string;
  suiteHash: string;
  contentHash: string;
  signal: AbortSignal;
}): Promise<RegressionReport> {
  const suite = await regressionSuite();
  if (suite.hash !== options.suiteHash)
    throw new Error('测试集已更新，请基于新测试集重新创建候选版本。');
  const image = await requireRuntimeImage();
  const results: RegressionCaseResult[] = [];
  const parent = path.join(dataRoot, 'evolution-checks');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  for (const item of suite.cases) {
    options.signal.throwIfAborted();
    const started = Date.now();
    const workspace = await mkdtemp(path.join(parent, `${item.id}-`));
    let container: ProjectContainer | undefined;
    try {
      // Only the checked rule/config snapshots enter this container. No live
      // project, account, model credentials, or proposed text is executed.
      await mkdir(path.join(workspace, 'src'), { recursive: true });
      for (const [file, hash] of Object.entries(item.files)) {
        const bytes = await checkedFile(
          path.join(root, 'fixtures', item.id, file),
          hash,
        );
        await mkdir(path.dirname(path.join(workspace, file)), {
          recursive: true,
        });
        await writeFile(path.join(workspace, file), bytes);
      }
      for (const file of [
        'game.project.json',
        'modules.lock.json',
        'assets.manifest.json',
      ])
        await writeFile(path.join(workspace, file), '{}\n');
      for (const file of ['design.md', 'memory.md', 'src/main.ts'])
        await writeFile(
          path.join(workspace, file),
          '// Fixed rule regression fixture, not a playable game.\n',
        );
      const checker = (
        await checkedFile(
          path.join(root, `check-${item.id}.mjs`),
          item.checkerHash,
        )
      )
        .toString()
        .replace(
          /from\s+(['"])esbuild\1/,
          "from '/opt/opengame/node_modules/esbuild/lib/main.js'",
        );
      await writeFile(path.join(workspace, 'regression.mjs'), checker);
      container = await ProjectContainer.start({
        projectId: item.projectId,
        jobId: options.releaseId,
        workspace,
        image,
        signal: options.signal,
        owner: 'worker',
      });
      let output: string;
      try {
        output = await container.exec(
          [
            'node',
            '/input/project/regression.mjs',
            '/input/project',
            '/output/regression.json',
          ],
          options.signal,
          45000,
        );
      } catch {
        options.signal.throwIfAborted();
        // A failed assertion writes its structured report before exiting 1.
        output = await container.exec(
          [
            'node',
            '-e',
            "const f=require('fs');const p='/output/regression.json';const s=f.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>14000)process.exit(2);process.stdout.write(f.readFileSync(p));",
          ],
          options.signal,
          5000,
        );
      }
      const report = z
        .object({
          passed: z.boolean(),
          tests: z
            .array(z.object({ name: z.string().max(100), passed: z.boolean() }))
            .max(40),
        })
        .parse(JSON.parse(output));
      if (
        JSON.stringify(report.tests.map((t) => t.name)) !==
        JSON.stringify(item.tests)
      )
        throw new Error('回归检查缺少预期用例。');
      results.push({
        id: item.id,
        title: item.title,
        passed: report.passed && report.tests.every((t) => t.passed),
        tests: report.tests,
        durationMs: Date.now() - started,
      });
    } catch {
      options.signal.throwIfAborted();
      results.push({
        id: item.id,
        title: item.title,
        passed: false,
        tests: item.tests.map((name) => ({ name, passed: false })),
        durationMs: Date.now() - started,
      });
    } finally {
      await container?.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  }
  return {
    suiteHash: suite.hash,
    contentHash: options.contentHash,
    checkedAt: new Date().toISOString(),
    passed: results.every((r) => r.passed),
    scope: 'reference-rules',
    environment: { kind: 'docker', image },
    cases: results,
  };
}
