import { engagementColumns } from './engagement';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, migrate, transaction } from './db';
import { previewOrigin } from './config';
import { StudioError } from './errors';
export { StudioError } from './errors';
import { parseLearning } from './knowledge';
import { captureCanvas, restoreCanvas } from './canvas';
import type { CanvasSelection } from '../shared/canvas';
import {
  conversationResultSchema,
  type ConversationResult,
} from '../shared/development';
import type {
  GameVersion,
  Job,
  Phase,
  PreparedVersion,
  Project,
  ProjectDetail,
} from '../shared/types';

function assertOwner(project: Project, ownerId?: string): void {
  if (ownerId && project.owner_id !== ownerId)
    throw new StudioError('找不到这个项目。', 404);
}
async function lockedProject(client: PoolClient, id: string): Promise<Project> {
  const result = await client.query(
    'SELECT * FROM studio_projects WHERE id=$1 FOR UPDATE',
    [id],
  );
  if (!result.rows[0]) throw new StudioError('找不到这个项目。', 404);
  return result.rows[0];
}
async function checkProjectLimit(
  client: PoolClient,
  ownerId: string,
  limit: number,
) {
  const count = (
    await client.query(
      'SELECT count(*)::int AS count FROM studio_projects WHERE owner_id=$1',
      [ownerId],
    )
  ).rows[0].count;
  if (count >= limit)
    throw new StudioError(
      '已达到内测项目数量上限，可以继续修改已有作品。',
      429,
    );
}
async function jobUsage(
  client: PoolClient,
  ownerId: string,
  kind: 'chat' | 'build',
) {
  return (
    await client.query(
      `SELECT count(*) FILTER (WHERE j.kind=$2 AND j.image_asset_id IS NULL AND NOT j.uses_bonus AND NOT j.uses_paid)::int AS total,
    count(*) FILTER (WHERE j.kind=$2 AND j.image_asset_id IS NULL AND NOT j.uses_bonus AND NOT j.uses_paid AND j.created_at>now()-interval '24 hours')::int AS daily,
    count(*) FILTER (WHERE j.uses_bonus)::int AS bonus_used,
    count(*) FILTER (WHERE j.uses_paid)::int AS paid_used,
    count(*) FILTER (WHERE j.status IN ('queued','running'))::int AS active
    FROM studio_jobs j JOIN studio_projects p ON p.id=j.project_id WHERE p.owner_id=$1`,
      [ownerId, kind],
    )
  ).rows[0];
}
function quotaExceeded(
  user: {
    daily_job_limit: number;
    total_job_limit: number;
    bonus_job_credits?: number;
    paid_job_credits?: number;
  },
  counts: {
    daily: number;
    total: number;
    bonus_used?: number;
    paid_used?: number;
  },
  kind: 'chat' | 'build',
) {
  const daily =
    kind === 'chat'
      ? Math.min(user.daily_job_limit * 5, 100)
      : user.daily_job_limit;
  const total =
    kind === 'chat'
      ? Math.min(user.total_job_limit * 5, 10000)
      : user.total_job_limit;
  return (
    (counts.daily >= daily || counts.total >= total) &&
    (kind === 'chat' ||
      ((user.bonus_job_credits || 0) <= (counts.bonus_used || 0) &&
        (user.paid_job_credits || 0) <= (counts.paid_used || 0)))
  );
}
/** A design-only project does not enqueue generation or consume a creation job. */
export async function createDraftProject(
  requestKey: string,
  ownerId?: string,
  mediaKind: 'game' | 'image' = 'game',
): Promise<{ projectId: string }> {
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      requestKey,
    ]);
    const existing = (
      await client.query(
        'SELECT * FROM studio_projects WHERE draft_key=$1 FOR UPDATE',
        [requestKey],
      )
    ).rows[0];
    if (existing) {
      assertOwner(existing, ownerId);
      if (existing.media_kind !== mediaKind)
        throw new StudioError('项目类型发生变化，请重新提交。', 409);
      return { projectId: existing.id };
    }
    if (ownerId) {
      const user = (
        await client.query(
          'SELECT * FROM studio_users WHERE id=$1 AND NOT disabled AND expires_at>now() FOR UPDATE',
          [ownerId],
        )
      ).rows[0];
      if (!user) throw new StudioError('内测访问已到期，请联系邀请人。', 401);
      await checkProjectLimit(client, ownerId, user.project_limit);
    }
    const projectId = randomUUID();
    await client.query(
      'INSERT INTO studio_projects(id,title,description,owner_id,draft_key,media_kind) VALUES($1,$2,$3,$4,$5,$6)',
      [
        projectId,
        mediaKind === 'image' ? '新的图片作品' : '新的游戏设计',
        '',
        ownerId || null,
        requestKey,
        mediaKind,
      ],
    );
    return { projectId };
  });
}
export async function listProjects(ownerId?: string): Promise<Project[]> {
  await migrate();
  return (
    await pool().query(
      `SELECT p.*, ${engagementColumns}
       FROM studio_projects p
       WHERE ($1::uuid IS NULL OR p.owner_id=$1)
       ORDER BY p.updated_at DESC`,
      [ownerId || null],
    )
  ).rows;
}
export async function listMarketplaceProjects(): Promise<Project[]> {
  await migrate();
  return (
    await pool().query(
      `SELECT p.id,p.title,p.description,p.source,p.released_version_id,
              p.released_version_id AS latest_version_id,p.created_at,p.updated_at,
              ${engagementColumns}
       FROM studio_projects p
       WHERE released_version_id IS NOT NULL
       ORDER BY updated_at DESC,id`,
    )
  ).rows;
}
export async function getProject(
  id: string,
  ownerId?: string,
): Promise<ProjectDetail> {
  await migrate();
  const p = await pool().query('SELECT * FROM studio_projects WHERE id=$1', [
    id,
  ]);
  if (!p.rows[0]) throw new StudioError('找不到这个项目。', 404);
  assertOwner(p.rows[0], ownerId);
  const [versions, jobs, messages, events] = await Promise.all([
    pool().query(
      'SELECT * FROM studio_versions WHERE project_id=$1 ORDER BY number DESC',
      [id],
    ),
    pool().query(
      'SELECT * FROM studio_jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 60',
      [id],
    ),
    pool().query(
      'SELECT id,job_id,role,content,created_at FROM studio_messages WHERE project_id=$1 ORDER BY created_at,id',
      [id],
    ),
    pool().query(
      'SELECT e.* FROM studio_events e WHERE job_id=(SELECT id FROM studio_jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1) ORDER BY id',
      [id],
    ),
  ]);
  return {
    project: p.rows[0],
    versions: versions.rows,
    jobs: jobs.rows,
    messages: messages.rows,
    events: events.rows,
    previewOrigin,
    imageBatches: (
      await pool().query(
        'SELECT id,project_id,base_version_id,prompt,styles,status,error,created_at,grouped,result_version_id FROM studio_image_batches WHERE project_id=$1 ORDER BY created_at DESC LIMIT 10',
        [id],
      )
    ).rows,
  };
}
export async function submitJob(input: {
  imageBatch?: { id: string; index: number };
  imageAssetId?: string;
  model?: import('../shared/models').GenerationModel;
  kind?: 'chat' | 'build';
  sourcePlanId?: string;
  canvas?: CanvasSelection;
  prompt: string;
  requestKey: string;
  projectId?: string;
  baseVersionId?: string | null;
  ownerId?: string;
}): Promise<{ projectId: string; jobId: string }> {
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        input.projectId || null,
        input.baseVersionId || null,
        input.prompt,
        ...(input.imageBatch ? [input.imageBatch] : []),
        ...(input.imageAssetId ? [input.imageAssetId] : []),
        ...(input.model ? [input.model] : []),
        ...(input.canvas ? [input.canvas] : []),
        ...(input.kind || input.sourcePlanId
          ? [input.kind || 'build', input.sourcePlanId || null]
          : []),
      ]),
    )
    .digest('hex');
  return transaction(async (client) => {
    // Serialize retries even before a newly created project has an ID.
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [input.requestKey],
    );
    const existing = await client.query(
      'SELECT * FROM studio_jobs WHERE request_key=$1',
      [input.requestKey],
    );
    if (existing.rows[0]) {
      assertOwner(
        await lockedProject(client, existing.rows[0].project_id),
        input.ownerId,
      );
      if (existing.rows[0].request_hash !== hash)
        throw new StudioError('这次请求的内容发生了变化，请重新提交。', 409);
      return {
        projectId: existing.rows[0].project_id,
        jobId: existing.rows[0].id,
      };
    }
    if (input.projectId)
      assertOwner(await lockedProject(client, input.projectId), input.ownerId);
    let usesBonus = false;
    let usesPaid = false;
    if (input.ownerId) {
      const users = await client.query(
        'SELECT * FROM studio_users WHERE id=$1 AND NOT disabled AND expires_at>now() FOR UPDATE',
        [input.ownerId],
      );
      const user = users.rows[0];
      if (!user) throw new StudioError('内测访问已到期，请联系邀请人。', 401);
      const kind = input.kind || 'build';
      const counts = await jobUsage(client, input.ownerId, kind);
      if (counts.active)
        throw new StudioError(
          '你已有一个处理中任务，请完成或停止后再提交。',
          429,
        );
      if (!input.imageAssetId && quotaExceeded(user, counts, kind))
        throw new StudioError(
          kind === 'chat'
            ? '已达到内测对话次数上限，请稍后再试或联系邀请人。'
            : '已达到内测制作次数上限，可在“额度与邀请”中邀请好友获得额外制作次数。',
          429,
        );
      usesBonus =
        !input.imageAssetId &&
        kind === 'build' &&
        (counts.daily >= user.daily_job_limit ||
          counts.total >= user.total_job_limit);
      usesPaid = usesBonus && user.bonus_job_credits <= counts.bonus_used;
      if (usesPaid) usesBonus = false;
      if (!input.projectId) {
        await checkProjectLimit(client, input.ownerId, user.project_limit);
      }
    }
    const projectId = input.projectId || randomUUID();
    if (!input.projectId) {
      await client.query(
        'INSERT INTO studio_projects(id,title,description,owner_id) VALUES($1,$2,$3,$4)',
        [
          projectId,
          input.prompt.slice(0, 26),
          input.prompt,
          input.ownerId || null,
        ],
      );
    }
    const project = await lockedProject(client, projectId);
    const batch = input.imageBatch
      ? (
          await client.query(
            "SELECT * FROM studio_image_batches WHERE id=$1 AND project_id=$2 AND status='active' FOR UPDATE",
            [input.imageBatch.id, projectId],
          )
        ).rows[0]
      : undefined;
    if (
      input.imageBatch &&
      (!batch ||
        batch.request_keys[input.imageBatch.index] !== input.requestKey)
    )
      throw new StudioError('批量任务已停止。', 409);
    if (
      !input.imageBatch &&
      (
        await client.query(
          "SELECT 1 FROM studio_image_batches b JOIN studio_projects p ON p.id=b.project_id WHERE b.status='active' AND (p.id=$1 OR ($2::uuid IS NOT NULL AND p.owner_id=$2))",
          [projectId, input.ownerId || null],
        )
      ).rowCount
    )
      throw new StudioError('请先完成或停止批量制作。', 409);
    if (input.imageAssetId) {
      if (
        project.media_kind !== 'image' ||
        input.kind === 'chat' ||
        input.sourcePlanId
      )
        throw new StudioError('图片版本只能导入图片作品。');
      const asset = await client.query(
        'SELECT id FROM studio_image_assets WHERE id=$1 AND project_id=$2',
        [input.imageAssetId, projectId],
      );
      if (!asset.rowCount) throw new StudioError('找不到本项目的图片。', 404);
    }
    if (project.latest_version_id !== (input.baseVersionId || null))
      throw new StudioError(
        '项目已有更新，请刷新后基于最新版本继续修改。',
        409,
      );
    const active = await client.query(
      "SELECT id FROM studio_jobs WHERE project_id=$1 AND status IN ('queued','running')",
      [projectId],
    );
    if (active.rowCount)
      throw new StudioError(
        '这个项目正在制作中。你的文字可以先保留为草稿。',
        409,
      );
    let source: Job | undefined;
    if (input.sourcePlanId) {
      source = (
        await client.query(
          'SELECT * FROM studio_jobs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1',
          [projectId],
        )
      ).rows[0];
      if (
        input.kind === 'chat' ||
        !source ||
        source.id !== input.sourcePlanId ||
        source.kind !== 'chat' ||
        source.status !== 'succeeded' ||
        !source.plan ||
        source.base_version_id !== project.latest_version_id
      )
        throw new StudioError(
          '方案已有新的讨论或版本变化，请基于最新对话重新整理。',
          409,
        );
      if (input.canvas)
        throw new StudioError('开始已整理的方案时，请使用方案保存的素材。');
    }
    const jobId = randomUUID();
    const canvas = batch
      ? batch.canvas_snapshot
      : source
        ? source.canvas_snapshot
        : await captureCanvas(client, projectId, input.canvas);
    await client.query(
      'INSERT INTO studio_jobs(id,project_id,base_version_id,request_key,request_hash,prompt,canvas_snapshot,kind,plan,uses_bonus,model,uses_paid,image_asset_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [
        jobId,
        projectId,
        input.baseVersionId || null,
        input.requestKey,
        hash,
        input.prompt,
        canvas,
        input.kind || 'build',
        source?.plan || null,
        usesBonus,
        input.model ?? source?.model ?? 'default',
        usesPaid,
        input.imageAssetId || null,
      ],
    );
    if (batch)
      await client.query(
        'UPDATE studio_jobs SET image_batch_id=$2,image_batch_index=$3,image_reference_version_id=$4 WHERE id=$1',
        [jobId, batch.id, input.imageBatch!.index, batch.base_version_id],
      );
    await client.query(
      "INSERT INTO studio_messages(id,project_id,job_id,role,content) VALUES($1,$2,$3,'user',$4)",
      [randomUUID(), projectId, jobId, input.prompt],
    );
    await client.query(
      "INSERT INTO studio_events(job_id,phase,message) VALUES($1,'queued',$2)",
      [
        jobId,
        input.kind === 'chat'
          ? '消息已保存，准备回复。'
          : '需求已保存，等待制作。',
      ],
    );
    return { projectId, jobId };
  });
}
export async function cancelJob(id: string, ownerId?: string): Promise<void> {
  await transaction(async (client) => {
    const result = await client.query(
      'SELECT * FROM studio_jobs WHERE id=$1 FOR UPDATE',
      [id],
    );
    const job = result.rows[0] as Job | undefined;
    if (!job) throw new StudioError('找不到这个任务。', 404);
    if (ownerId) {
      const project = (
        await client.query('SELECT * FROM studio_projects WHERE id=$1', [
          job.project_id,
        ])
      ).rows[0];
      assertOwner(project, ownerId);
    }
    if (job.status === 'queued') {
      await client.query(
        "UPDATE studio_jobs SET cancel_requested=true,status='cancelled',finished_at=now() WHERE id=$1",
        [id],
      );
    } else if (job.status === 'running') {
      await client.query(
        'UPDATE studio_jobs SET cancel_requested=true WHERE id=$1',
        [id],
      );
    }
  });
}
export async function claimJob(): Promise<Job | null> {
  return transaction(async (client) => {
    const result = await client.query(
      "SELECT id FROM studio_jobs WHERE status='queued' AND NOT cancel_requested ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!result.rows[0]) return null;
    return (
      await client.query(
        "UPDATE studio_jobs SET status='running',phase=CASE WHEN prepared IS NOT NULL THEN 'saving' WHEN kind='chat' THEN 'planning' ELSE 'preparing' END,attempt=attempt+1,lease_token=$2,heartbeat_at=now() WHERE id=$1 RETURNING *",
        [result.rows[0].id, randomUUID()],
      )
    ).rows[0];
  });
}
export async function jobEvent(
  job: Job,
  phase: Phase,
  message: string,
): Promise<void> {
  await transaction(async (client) => {
    const updated = await client.query(
      "UPDATE studio_jobs SET phase=$3,heartbeat_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id",
      [job.id, job.lease_token, phase],
    );
    if (!updated.rowCount) throw new StudioError('任务执行权已失效。', 409);
    await client.query(
      'INSERT INTO studio_events(job_id,phase,message) VALUES($1,$2,$3)',
      [job.id, phase, message.slice(0, 1200)],
    );
  });
  job.phase = phase;
}

/** A conversation produces no game version. Implementation begins only after a valid, saved plan. */
export async function finishPlanning(
  job: Job,
  value: ConversationResult,
): Promise<Job> {
  const result = conversationResultSchema.parse(value);
  return transaction(async (client) => {
    const project = await lockedProject(client, job.project_id);
    if (project.latest_version_id !== job.base_version_id)
      throw new StudioError('基础版本已变更，请重新梳理本轮需求。', 409);
    let build = result.action === 'implement';
    let usesBonus = false;
    let usesPaid = false;
    if (build && project.owner_id) {
      const user = (
        await client.query(
          'SELECT daily_job_limit,total_job_limit,bonus_job_credits,paid_job_credits FROM studio_users WHERE id=$1 AND NOT disabled AND expires_at>now() FOR UPDATE',
          [project.owner_id],
        )
      ).rows[0];
      if (!user) throw new StudioError('内测访问已到期，请联系邀请人。', 401);
      const counts = await jobUsage(client, project.owner_id, 'build');
      usesBonus =
        counts.daily >= user.daily_job_limit ||
        counts.total >= user.total_job_limit;
      usesPaid = usesBonus && user.bonus_job_credits <= counts.bonus_used;
      if (usesPaid) usesBonus = false;
      if (quotaExceeded(user, counts, 'build')) {
        build = false;
        result.reply =
          '本轮方案已整理，但内测制作次数已达上限，暂未开始实施。方案和讨论会保留，可在“额度与邀请”中邀请好友获得额外次数后继续。';
      }
    }
    const updated = await client.query(
      `UPDATE studio_jobs SET plan=$3,planning_reply=$4,kind=$5,status=$6,phase=$7,
       uses_bonus=$8,uses_paid=$9,finished_at=CASE WHEN $5='chat' THEN now() ELSE NULL END
       WHERE id=$1 AND lease_token=$2 AND status='running' AND kind='chat' AND planning_reply IS NULL AND NOT cancel_requested RETURNING *`,
      [
        job.id,
        job.lease_token,
        result.plan,
        result.reply,
        build ? 'build' : 'chat',
        build ? 'running' : 'succeeded',
        build ? 'preparing' : 'done',
        build && usesBonus,
        build && usesPaid,
      ],
    );
    if (!updated.rows[0])
      throw new StudioError('对话已停止或执行权失效。', 409);
    await client.query(
      "INSERT INTO studio_messages(id,project_id,job_id,role,content) VALUES($1,$2,$3,'assistant',$4)",
      [randomUUID(), job.project_id, job.id, result.reply],
    );
    await client.query(
      'INSERT INTO studio_events(job_id,phase,message) VALUES($1,$2,$3)',
      [
        job.id,
        build ? 'preparing' : 'done',
        build
          ? '本轮任务已整理，开始实施。'
          : result.plan
            ? '方案已整理，等待开始制作。'
            : '讨论已保存。',
      ],
    );
    await client.query(
      'UPDATE studio_projects SET updated_at=now() WHERE id=$1',
      [job.project_id],
    );
    return updated.rows[0];
  });
}
export async function stageVersion(
  job: Job,
  prepared: PreparedVersion,
): Promise<void> {
  const result = await pool().query(
    "UPDATE studio_jobs SET prepared=$3,phase='saving' WHERE id=$1 AND lease_token=$2 AND status='running' AND NOT cancel_requested",
    [job.id, job.lease_token, prepared],
  );
  if (!result.rowCount) throw new StudioError('任务已取消或执行权失效。', 409);
}
export async function finishVersion(
  job: Job,
  prepared: PreparedVersion,
): Promise<void> {
  await transaction(async (client) => {
    const project = await lockedProject(client, job.project_id);
    const result = await client.query(
      'SELECT * FROM studio_jobs WHERE id=$1 FOR UPDATE',
      [job.id],
    );
    const current = result.rows[0] as Job;
    if (current.status === 'succeeded') return;
    if (
      current.lease_token !== job.lease_token ||
      current.status !== 'running' ||
      current.kind === 'chat' ||
      current.cancel_requested
    )
      throw new StudioError('任务已停止，保留上一可玩版本。', 409);
    if (project.latest_version_id !== job.base_version_id)
      throw new StudioError('基础版本已变更，结果未覆盖当前版本。', 409);
    if (
      current.image_batch_id &&
      (
        await client.query(
          'SELECT grouped FROM studio_image_batches WHERE id=$1',
          [current.image_batch_id],
        )
      ).rows[0]?.grouped
    ) {
      await client.query(
        "UPDATE studio_jobs SET status='succeeded',phase='done',prepared=$2,finished_at=now() WHERE id=$1",
        [job.id, prepared],
      );
      await client.query(
        "INSERT INTO studio_events(job_id,phase,message) VALUES($1,'done',$2)",
        [job.id, '本张图片已完成，整批结束后统一保存为一个版本。'],
      );
      return;
    }
    const count = await client.query(
      'SELECT coalesce(max(number),0)+1 AS next FROM studio_versions WHERE project_id=$1',
      [job.project_id],
    );
    await client.query(
      "INSERT INTO studio_versions(id,project_id,number,commit_sha,artifact_key,artifact_hash,summary,kind,standards_version,validation,canvas_snapshot,development_plan) VALUES($1,$2,$3,$4,$5,$6,$7,'generated',$8,$9,$10,$11)",
      [
        prepared.id,
        job.project_id,
        count.rows[0].next,
        prepared.commitSha,
        prepared.artifactKey,
        prepared.artifactHash,
        prepared.summary,
        prepared.standardsVersion,
        prepared.validation,
        current.canvas_snapshot || null,
        current.plan || null,
      ],
    );
    await client.query(
      'UPDATE studio_projects SET latest_version_id=$2,title=coalesce($3,title),updated_at=now() WHERE id=$1',
      [job.project_id, prepared.id, prepared.title || null],
    );
    await client.query(
      "UPDATE studio_jobs SET status='succeeded',phase='done',result_version_id=$2,finished_at=now() WHERE id=$1",
      [job.id, prepared.id],
    );
    await client.query(
      "INSERT INTO studio_messages(id,project_id,job_id,role,content) VALUES($1,$2,$3,'assistant',$4)",
      [randomUUID(), job.project_id, job.id, prepared.summary],
    );
    await client.query(
      "INSERT INTO studio_events(job_id,phase,message) VALUES($1,'done',$2)",
      [
        job.id,
        project.media_kind === 'image'
          ? '图片新版本已保存，可以查看和下载。'
          : '新版本已保存，可以开始试玩。',
      ],
    );
    await client.query(
      "INSERT INTO studio_experiences(id,job_id,project_id,standards_version,outcome,evidence) VALUES($1,$2,$3,$4,'passed',$5) ON CONFLICT(job_id) DO NOTHING",
      [
        randomUUID(),
        job.id,
        job.project_id,
        prepared.standardsVersion,
        {
          validation: prepared.validation,
          versionId: prepared.id,
          lessons: parseLearning({ lessons: prepared.lessons || [] }).lessons,
          learningNote: prepared.learningNote,
        },
      ],
    );
  });
}
export async function failJob(
  job: Job,
  error: string,
  cancelled = false,
): Promise<void> {
  await transaction(async (client) => {
    const updated = await client.query(
      "UPDATE studio_jobs SET status=CASE WHEN cancel_requested OR $4 THEN 'cancelled' ELSE 'failed' END,error=$3,finished_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING status",
      [job.id, job.lease_token, error.slice(0, 1600), cancelled],
    );
    if (updated.rowCount) {
      await client.query(
        'INSERT INTO studio_events(job_id,phase,message) VALUES($1,$2,$3)',
        [job.id, job.phase, error.slice(0, 1200)],
      );
      if (job.kind !== 'chat')
        await client.query(
          "INSERT INTO studio_experiences(id,job_id,project_id,standards_version,outcome,evidence) VALUES($1,$2,$3,'0.1.0',$4,$5) ON CONFLICT(job_id) DO NOTHING",
          [
            randomUUID(),
            job.id,
            job.project_id,
            updated.rows[0].status,
            { error: error.slice(0, 1600) },
          ],
        );
    }
  });
}
export async function restoreVersion(
  projectId: string,
  versionId: string,
  expected: string | null,
  ownerId?: string,
  expectedCanvasRevision?: number,
): Promise<string> {
  return transaction(async (client) => {
    const project = await lockedProject(client, projectId);
    assertOwner(project, ownerId);
    if (
      (
        await client.query(
          "SELECT 1 FROM studio_image_batches WHERE project_id=$1 AND status='active'",
          [projectId],
        )
      ).rowCount
    )
      throw new StudioError('请先完成或停止批量制作。', 409);
    if (project.latest_version_id !== expected)
      throw new StudioError('项目已有更新，请刷新后再恢复。', 409);
    if (
      (
        await client.query(
          "SELECT id FROM studio_jobs WHERE project_id=$1 AND status IN ('queued','running')",
          [projectId],
        )
      ).rowCount
    )
      throw new StudioError('请先停止当前制作任务。', 409);
    const result = await client.query(
      'SELECT * FROM studio_versions WHERE id=$1 AND project_id=$2',
      [versionId, projectId],
    );
    const version = result.rows[0] as GameVersion | undefined;
    if (!version) throw new StudioError('找不到这个版本。', 404);
    if (project.latest_version_id === version.id) return version.id;
    await restoreCanvas(
      client,
      projectId,
      version.canvas_snapshot || null,
      expectedCanvasRevision,
    );
    if (project.media_kind === 'image') {
      await client.query(
        'UPDATE studio_projects SET latest_version_id=$2,updated_at=now() WHERE id=$1',
        [projectId, version.id],
      );
      return version.id;
    }
    const id = randomUUID();
    await client.query(
      "INSERT INTO studio_versions(id,project_id,number,commit_sha,artifact_key,artifact_hash,summary,kind,source_version_id,standards_version,validation,canvas_snapshot,development_plan) SELECT $1,project_id,(SELECT coalesce(max(number),0)+1 FROM studio_versions WHERE project_id=$2),commit_sha,artifact_key,artifact_hash,$4,'restore',id,standards_version,validation,canvas_snapshot,development_plan FROM studio_versions WHERE id=$3",
      [id, projectId, versionId, `恢复到版本 ${version.number}`],
    );
    await client.query(
      'UPDATE studio_projects SET latest_version_id=$2,updated_at=now() WHERE id=$1',
      [projectId, id],
    );
    return id;
  });
}
export async function publishVersion(
  projectId: string,
  versionId: string,
  expected: string | null,
  ownerId?: string,
): Promise<void> {
  await transaction(async (client) => {
    const project = await lockedProject(client, projectId);
    assertOwner(project, ownerId);
    if (project.released_version_id === versionId) return;
    if (project.released_version_id !== expected)
      throw new StudioError('发布版本已改变，请刷新后再试。', 409);
    const result = await client.query(
      "SELECT id FROM studio_versions WHERE id=$1 AND project_id=$2 AND (validation->>'browser'='true' OR (validation->'image' IS NOT NULL AND EXISTS (SELECT 1 FROM studio_projects p WHERE p.id=$2 AND p.media_kind='image')))",
      [versionId, projectId],
    );
    if (!result.rowCount)
      throw new StudioError('只能发布已通过检查的本项目版本。');
    await client.query(
      'UPDATE studio_projects SET released_version_id=$2,updated_at=now() WHERE id=$1',
      [projectId, versionId],
    );
  });
}
