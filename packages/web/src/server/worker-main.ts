import { performStudy } from './study';
import { scheduleImageBatches } from './image-batch';
import { buildImageVersion } from './image-project';
import { generationTimeout } from './model-runtime';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { artifactDir, dataRoot, projectRepo } from './config';
import { migrate, pool } from './db';
import {
  claimJob,
  failJob,
  finishVersion,
  finishPlanning,
  getProject,
  jobEvent,
  stageVersion,
} from './store';
import {
  commitWorkspace,
  makePrompt,
  prepareWorkspace,
  standardsVersion,
} from './workspace';
import { artifactHash } from './build-game';
import {
  checkInProjectContainer,
  recoverProjectContainers,
  requireRuntimeImage,
} from './project-runtime';
import { runCodex } from './codex';
import { generateReviewedGame } from './game-generation';
import { checkGeneratorSandbox } from './generator-check';
import { canvasImages } from './canvas';
import { planConversation } from './conversation';
import { run } from './process';
import { performNextEvolutionCheck, recoverEvolutionChecks } from './evolution';
import type { Job, PreparedVersion } from '../shared/types';
import { planInstructions } from '../shared/development';
import {
  loadKnowledge,
  readLearning,
  selectKnowledge,
  snapshotKnowledge,
} from './knowledge';

let stopping = false;
let active: AbortController | undefined;
const stop = () => {
  stopping = true;
  active?.abort();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await migrate();
await checkGeneratorSandbox();
const leader = await pool().connect();
if (
  !(await leader.query('SELECT pg_try_advisory_lock(71941302) AS acquired'))
    .rows[0].acquired
) {
  console.error('已有制作进程在运行。');
  leader.release();
  await pool().end();
  process.exit(1);
}
leader.on('error', stop);
await recoverProjectContainers().catch(() => {
  console.warn('独立环境暂不可用；已有游戏仍可试玩，制作前会再次检查。');
});
// Acquiring the exclusive connection lock proves that the previous worker lost ownership.
await pool().query(
  "UPDATE studio_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' WHEN prepared IS NOT NULL THEN 'queued' ELSE 'failed' END,error=CASE WHEN prepared IS NULL THEN '制作进程已中断，上一可玩版本保留。可以重新提交需求。' ELSE error END,lease_token=NULL WHERE status='running'",
);
await recoverEvolutionChecks();
await pool().query(
  "UPDATE studio_study_courses SET status='failed',source=NULL,error='处理进程已中断，请重新上传。' WHERE status='running'",
);
async function verifyPrepared(job: Job, version: PreparedVersion) {
  if (
    (await artifactHash(artifactDir(version.artifactKey))) !==
    version.artifactHash
  )
    throw new Error('保存产物校验失败，未替换上一版本。');
  await run(
    'git',
    [
      '--git-dir',
      projectRepo(job.project_id),
      'cat-file',
      '-e',
      `${version.commitSha}^{commit}`,
    ],
    dataRoot,
  );
}
async function perform(job: Job, signal: AbortSignal, deadline: number) {
  if (job.kind === 'chat') {
    await jobEvent(
      job,
      'planning',
      '正在结合项目记忆和对话梳理想法，尚未修改游戏。',
    );
    const result = await planConversation(
      job,
      await getProject(job.project_id),
      signal,
    );
    signal.throwIfAborted();
    Object.assign(job, await finishPlanning(job, result));
    if (job.kind === 'chat') return;
  }
  if (job.prepared) {
    await verifyPrepared(job, job.prepared);
    signal.throwIfAborted();
    await finishVersion(job, job.prepared);
    return;
  }
  const imageDetail = await getProject(job.project_id);
  if (imageDetail.project.media_kind === 'image') {
    await jobEvent(job, 'preparing', '正在准备图片版本。');
    const imageJob = job.image_batch_id
      ? { ...job, base_version_id: job.image_reference_version_id || null }
      : job;
    const base = imageDetail.versions.find(
      (v) => v.id === imageJob.base_version_id,
    );
    const workspace = await prepareWorkspace(imageJob, base);
    const id = randomUUID();
    const temporary = path.join(dataRoot, 'pending-artifacts', id);
    const validation = await buildImageVersion(
      imageJob,
      imageDetail,
      workspace,
      temporary,
      signal,
    );
    signal.throwIfAborted();
    await jobEvent(
      job,
      'saving',
      '图片解码检查通过，正在保存原尺寸图片和版本说明。',
    );
    const manifest = JSON.parse(
      await readFile(path.join(workspace, 'game.project.json'), 'utf8'),
    );
    const prepared: PreparedVersion = {
      id,
      title: manifest.title,
      artifactKey: id,
      commitSha: await commitWorkspace(job, workspace),
      artifactHash: await artifactHash(temporary),
      summary: job.image_batch_id
        ? `批量图片 ${(job.image_batch_index || 0) + 1} 已保存。${job.prompt.split('本张风格：')[1]?.split('。')[0] || ''}`
        : job.image_asset_id
          ? '已保存导入的图片版本，可以查看、下载或恢复历史版本。'
          : 'Codex 已生成并保存图片新版本，可以下载或继续描述修改要求。',
      standardsVersion,
      validation,
    };
    await mkdir(path.dirname(artifactDir(id)), { recursive: true });
    await rename(temporary, artifactDir(id));
    await stageVersion(job, prepared);
    await verifyPrepared(job, prepared);
    signal.throwIfAborted();
    await finishVersion(job, prepared);
    return;
  }
  const runtimeImage = await requireRuntimeImage();
  signal.throwIfAborted();
  await jobEvent(job, 'preparing', '正在恢复项目记忆，并选取相关游戏经验。');
  const detail = await getProject(job.project_id);
  const base = detail.versions.find((v) => v.id === job.base_version_id);
  const knowledge = snapshotKnowledge(
    selectKnowledge(
      `${job.plan ? planInstructions(job.plan) : job.prompt}\n${base ? detail.project.title : ''}`,
      await loadKnowledge(detail.project.owner_id || undefined),
      job.project_id,
    ),
  );
  const workspace = await prepareWorkspace(job, base, knowledge);
  await jobEvent(
    job,
    'preparing',
    `已选取 ${knowledge.entries.length} 条参考经验，本次使用的内容将随版本保存。`,
  );
  if (job.canvas_snapshot?.selectedIds.length) {
    const images = canvasImages(workspace, job.canvas_snapshot);
    await jobEvent(
      job,
      'preparing',
      `已固定 ${job.canvas_snapshot.selectedIds.length} 项设计引用，包含 ${images.length} 张参考图。后续画布修改留待下一次制作。`,
    );
  }
  const history = detail.messages
    .slice(-8)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
  const prompt = await makePrompt(job, workspace, history, knowledge);
  const id = randomUUID();
  const temporary = path.join(dataRoot, 'pending-artifacts', id);
  const { summary, validation } = await generateReviewedGame(
    {
      workspace,
      output: temporary,
      prompt,
      referenceImages: canvasImages(workspace, job.canvas_snapshot),
      signal,
      mode: base ? 'modify' : 'create',
      plan: job.plan?.production,
      deadline,
    },
    {
      generate: (input) =>
        runCodex({
          cwd: workspace,
          model: job.model,
          ...input,
          onMessage: () => {},
          onUsage: (usage) => {
            void pool()
              .query(
                "UPDATE studio_jobs SET usage=coalesce(usage,'[]'::jsonb) || $3::jsonb WHERE id=$1 AND lease_token=$2",
                [job.id, job.lease_token, JSON.stringify([usage])],
              )
              .catch(() => {});
          },
        }),
      check: (output, acceptance, checkSignal) =>
        checkInProjectContainer({
          owner: 'worker',
          projectId: job.project_id,
          jobId: job.id,
          workspace,
          output,
          image: runtimeImage,
          signal: checkSignal,
          acceptance,
        }),
      progress: (phase, message) => jobEvent(job, phase, message),
    },
  );
  signal.throwIfAborted();
  await jobEvent(job, 'saving', '检查通过，正在保存源码、项目记忆和可玩版本。');
  const manifest = JSON.parse(
    await readFile(path.join(workspace, 'game.project.json'), 'utf8'),
  );
  const title =
    typeof manifest.title === 'string'
      ? manifest.title.trim().slice(0, 80)
      : undefined;
  const memoryPath = path.join(workspace, 'memory.md');
  const memory = await readFile(memoryPath, 'utf8');
  await writeFile(
    memoryPath,
    `${memory}\n\n## 平台验证记录 ${validation.checkedAt}\n\n本次构建、启动、项目冒烟操作与独立验收场景通过；固定制作目标、评审依据与各场景结果保存在 production-report.json。行为结论来自实际输入和只读评审，表现结论是模型观察判断。未覆盖的长局、音频听感、真实触屏和用户体验不视为通过。\n`,
  );
  const learning = await readLearning(workspace);
  const commitSha = await commitWorkspace(job, workspace, knowledge);
  signal.throwIfAborted();
  const prepared: PreparedVersion = {
    id,
    title,
    commitSha,
    artifactKey: id,
    artifactHash: await artifactHash(temporary),
    summary,
    standardsVersion,
    validation,
    lessons: learning.lessons,
    learningNote: learning.note,
  };
  await mkdir(path.dirname(artifactDir(id)), { recursive: true });
  await rename(temporary, artifactDir(id));
  await stageVersion(job, prepared);
  await verifyPrepared(job, prepared);
  signal.throwIfAborted();
  await finishVersion(job, prepared);
}
console.log('OpenGame 制作进程已就绪。');
const health = setInterval(() => {
  void pool()
    .query(
      'INSERT INTO studio_worker_health(id,heartbeat_at) VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()',
    )
    .catch(stop);
}, 2000);
try {
  while (!stopping) {
    await scheduleImageBatches();
    const job = await claimJob();
    if (!job) {
      const controller = new AbortController();
      active = controller;
      // Document lessons need time for extraction, source checking and a full question bank.
      let timeout = setTimeout(() => controller.abort(), 600000);
      let worked = false;
      try {
        worked = await performStudy(controller.signal);
        if (!worked) {
          clearTimeout(timeout);
          timeout = setTimeout(() => controller.abort(), 180000);
          worked = await performNextEvolutionCheck(controller.signal);
        }
      } finally {
        clearTimeout(timeout);
        active = undefined;
      }
      if (!worked) await pause(600);
      continue;
    }
    const controller = new AbortController();
    active = controller;
    let timedOut = false;
    const deadline = Date.now() + generationTimeout(job.model);
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, generationTimeout(job.model));
    const cancelPoll = setInterval(() => {
      void pool()
        .query(
          "UPDATE studio_jobs SET heartbeat_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING cancel_requested",
          [job.id, job.lease_token],
        )
        .then((r) => {
          if (!r.rows[0] || r.rows[0].cancel_requested) controller.abort();
        })
        .catch(() => controller.abort());
    }, 600);
    try {
      await perform(job, controller.signal, deadline);
    } catch (error) {
      await failJob(
        job,
        timedOut
          ? '制作超过本次时限，上一可玩版本保持不变。可以缩小修改范围后重试。'
          : error instanceof Error
            ? error.message
            : '制作失败，请重试。',
        controller.signal.aborted && !timedOut,
      );
    } finally {
      clearInterval(cancelPoll);
      clearTimeout(timeout);
      active = undefined;
    }
  }
} finally {
  clearInterval(health);
  leader.release();
  await pool().end();
}
