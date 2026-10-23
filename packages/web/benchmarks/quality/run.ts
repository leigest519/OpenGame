// Manual, metered model smoke test. Uses a fresh local data directory, no studio DB.
import { createHash, randomUUID } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Job } from '../../src/shared/types';

const web = fileURLToPath(new URL('../..', import.meta.url));
const outputRoot = path.resolve(web, '../../output');
await mkdir(outputRoot, { recursive: true });
const output = await mkdtemp(path.join(outputRoot, 'game-quality-'));
process.env.OPENGAME_WEB_ROOT = web;
process.env.OPENGAME_DATA_DIR = path.join(output, 'data');
await mkdir(process.env.OPENGAME_DATA_DIR);
const { prepareWorkspace, makePrompt, standardsVersion } =
  await import('../../src/server/workspace');
const { seedKnowledge, selectKnowledge, snapshotKnowledge } =
  await import('../../src/server/knowledge');
const { generateReviewedGame } =
  await import('../../src/server/game-generation');
const { runCodex } = await import('../../src/server/codex');
const { requireRuntimeImage, checkInProjectContainer } =
  await import('../../src/server/project-runtime');
const { generationTimeout } = await import('../../src/server/model-runtime');
const { qualityScreenshots } = await import('../../src/shared/game-quality');
const { projectFiles } = await import('../../src/server/project-files');
const { productionPlanSchema } =
  await import('../../src/shared/game-production');
const args = process.argv.slice(2);
const continueAt = args.indexOf('--continue');
const sourceRun = continueAt >= 0 ? args.splice(continueAt, 2)[1] : undefined;
if (
  continueAt >= 0 &&
  (!sourceRun || !/^game-quality-[a-zA-Z0-9]+$/.test(sourceRun))
)
  throw new Error(
    '--continue requires an existing game-quality-* directory name.',
  );
const now = new Date().toISOString();
const job: Job = {
  id: randomUUID(),
  project_id: randomUUID(),
  base_version_id: null,
  model: 'gpt-6-astra',
  kind: 'build',
  prompt:
    args.join(' ') ||
    '我想做一款2d的塔防游戏，类似保卫萝卜，但是主题变成乐高风格',
  status: 'running',
  phase: 'generating',
  cancel_requested: false,
  attempt: 1,
  lease_token: null,
  prepared: null,
  error: null,
  created_at: now,
  finished_at: null,
};
const controller = new AbortController();
const timeBudget = sourceRun
  ? Math.min(600000, generationTimeout(job.model))
  : generationTimeout(job.model);
const timer = setTimeout(() => controller.abort(), timeBudget);
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
let calls = 0,
  checks = 0;
const invocations: { readOnly: boolean; elapsedMs: number }[] = [];
const usage: unknown[] = [];
const events: { at: string; message: string }[] = [];
const started = Date.now();
console.log(`Evidence: ${output}`);
try {
  const image = await requireRuntimeImage();
  const inputs = await Promise.all(
    [
      'src/server/game-generation.ts',
      'src/shared/game-production.ts',
      'src/server/workspace.ts',
      'src/server/generator-policy.ts',
      'src/server/codex.ts',
      'src/server/build-game.ts',
      'src/server/game-playtest.ts',
      'src/server/project-runtime.ts',
      'runtime/check.ts',
      `resources/standards/${standardsVersion}.md`,
    ].map(async (file) => ({
      file,
      sha256: createHash('sha256')
        .update(await readFile(path.join(web, file)))
        .digest('hex'),
    })),
  );
  await writeFile(
    path.join(output, 'platform-inputs.json'),
    JSON.stringify({ image, inputs }, null, 2),
  );
  const knowledge = snapshotKnowledge(
    selectKnowledge(job.prompt, await seedKnowledge(), job.project_id),
  );
  const workspace = await prepareWorkspace(job, undefined, knowledge);
  let continuedPlan;
  if (sourceRun) {
    const sources = path.join(outputRoot, sourceRun, 'data/workspaces');
    const entries = await readdir(sources);
    if (entries.length !== 1)
      throw new Error('续跑来源必须只有一个游戏工作目录。');
    const source = path.join(sources, entries[0]);
    continuedPlan = productionPlanSchema.parse(
      JSON.parse(
        await readFile(
          path.join(
            source,
            '.opengame-context/quality-review/production-plan.json',
          ),
          'utf8',
        ),
      ).plan,
    );
    const copied = [];
    for (const file of await projectFiles(source)) {
      const target = path.join(workspace, file);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(source, file), target);
      copied.push({
        file,
        sha256: createHash('sha256')
          .update(await readFile(target))
          .digest('hex'),
      });
    }
    await writeFile(
      path.join(output, 'continuation-inputs.json'),
      JSON.stringify(
        {
          sourceRun,
          kind: 'unfinished-source-continuation',
          plan: continuedPlan,
          files: copied,
          limitation:
            'A new bounded diagnostic run from saved source, not a fresh generation or a successful previous run. Source may be incomplete; all criteria are rechecked.',
        },
        null,
        2,
      ),
    );
    console.log(
      `Continuation from ${sourceRun}; not a fresh generation sample.`,
    );
  }
  const prompt = await makePrompt(job, workspace, '', knowledge);
  const result = await generateReviewedGame(
    {
      workspace,
      output: path.join(output, 'artifact'),
      prompt,
      referenceImages: [],
      signal: controller.signal,
      mode: sourceRun ? 'modify' : 'create',
      plan: continuedPlan,
      deadline: started + timeBudget,
    },
    {
      async generate(input) {
        calls++;
        await writeFile(path.join(output, `prompt-${calls}.txt`), input.prompt);
        const callStarted = Date.now();
        try {
          const reply = await runCodex({
            cwd: workspace,
            model: job.model,
            ...input,
            onMessage() {},
            onUsage(value) {
              usage.push(value);
            },
          });
          await writeFile(path.join(output, `reply-${calls}.txt`), reply);
          return reply;
        } finally {
          invocations.push({
            readOnly: input.readOnly,
            elapsedMs: Date.now() - callStarted,
          });
        }
      },
      async check(artifact, acceptance, signal) {
        checks++;
        const report = await checkInProjectContainer({
          projectId: job.project_id,
          jobId: job.id,
          workspace,
          output: artifact,
          image,
          signal,
          acceptance,
        });
        const evidence = path.join(output, `check-${checks}`);
        await mkdir(evidence);
        for (const shot of qualityScreenshots)
          await cp(
            path.join(artifact, shot.file),
            path.join(evidence, shot.file),
          );
        for (const test of report.quality?.acceptance || [])
          await cp(
            path.join(artifact, test.screenshot),
            path.join(evidence, test.screenshot),
          );
        await writeFile(
          path.join(evidence, 'acceptance.json'),
          JSON.stringify(acceptance, null, 2),
        );
        await writeFile(
          path.join(evidence, 'validation.json'),
          JSON.stringify(report, null, 2),
        );
        return report;
      },
      async progress(_phase, message) {
        events.push({ at: new Date().toISOString(), message });
        console.log(message);
      },
    },
  );
  await writeFile(
    path.join(output, 'result.json'),
    JSON.stringify(
      {
        prompt: job.prompt,
        requestedModel: job.model,
        sampleKind: sourceRun
          ? 'unfinished-source-continuation'
          : 'fresh-generation',
        sourceRun,
        timeBudget,
        standardsVersion,
        workspace,
        elapsedMs: Date.now() - started,
        calls,
        checks,
        usage,
        invocations,
        events,
        reasoningEffort: 'provider default; not explicitly configured',
        ...result,
      },
      null,
      2,
    ),
  );
  console.log(`Completed: ${output}/result.json`);
} catch (error) {
  await writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify(
      {
        prompt: job.prompt,
        requestedModel: job.model,
        sampleKind: sourceRun
          ? 'unfinished-source-continuation'
          : 'fresh-generation',
        sourceRun,
        timeBudget,
        reasoningEffort: 'provider default; not explicitly configured',
        elapsedMs: Date.now() - started,
        calls,
        checks,
        usage,
        invocations,
        events,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  clearTimeout(timer);
}
