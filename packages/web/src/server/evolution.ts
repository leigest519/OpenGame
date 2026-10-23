import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { accessMode } from './config';
import { migrate, pool, transaction } from './db';
import type { Viewer } from './access';
import {
  canReviewEvolution,
  requireEvolutionReviewer,
} from './evolution-access';
import { contentHash } from './public-knowledge';
import { loadKnowledge, lessonSchema, parseLearning } from './knowledge';
import {
  regressionSuite,
  runEvolutionRegression,
} from './evolution-regression';
import { StudioError } from './errors';
import type {
  EvolutionOverview,
  KnowledgeRelease,
  ReleaseEntry,
  RegressionReport,
} from '../shared/evolution';

const uuid = z.string().uuid();
export const candidateInput = z
  .object({
    sourceId: z.string().regex(/^[a-f0-9-]{36}:[0-2]$/),
    lesson: lessonSchema,
    consent: z.literal(true),
  })
  .strict();
export const reviewInput = z
  .object({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(['reviewed', 'rejected']),
    note: z.string().trim().min(5).max(800),
    generalOnly: z.literal(true),
  })
  .strict();
export const releaseInput = z
  .object({
    requestKey: uuid,
    candidateIds: z.array(uuid).min(1).max(20),
    label: z.string().trim().min(2).max(80),
    expectedReleaseId: uuid.nullable(),
  })
  .strict();
export const activateInput = z
  .object({
    targetReleaseId: uuid.nullable(),
    expectedReleaseId: uuid.nullable(),
  })
  .strict();

const releaseColumns = `id,number,label,base_release_id AS "baseReleaseId",status,entries,content_hash AS "contentHash",suite_hash AS "suiteHash",report,error,created_at AS "createdAt",published_at AS "publishedAt"`;

export async function evolutionOverview(
  viewer: Viewer | null,
): Promise<EvolutionOverview> {
  await migrate();
  const reviewer = canReviewEvolution(viewer);
  const [active, candidates, releases, entries, suite] = await Promise.all([
    pool().query('SELECT release_id FROM studio_public_knowledge WHERE id=1'),
    pool().query(
      `SELECT c.id,c.lesson,c.content_hash AS "contentHash",c.status,c.review_note AS "reviewNote",p.title || ' · 版本 ' || v.number AS "sourceLabel",c.created_at AS "createdAt"
      FROM studio_evolution_candidates c JOIN studio_experiences e ON e.id=c.experience_id
      JOIN studio_projects p ON p.id=e.project_id JOIN studio_versions v ON v.id::text=e.evidence->>'versionId'
      WHERE $1::boolean OR c.author_id=$2 ORDER BY c.created_at DESC LIMIT 100`,
      [reviewer, viewer?.id || null],
    ),
    pool().query(
      `SELECT ${releaseColumns} FROM studio_knowledge_releases WHERE $1::boolean OR published_at IS NOT NULL ORDER BY (id=(SELECT release_id FROM studio_public_knowledge WHERE id=1)) DESC NULLS LAST,number DESC LIMIT 50`,
      [reviewer],
    ),
    loadKnowledge(viewer?.id),
    regressionSuite(),
  ]);
  return {
    canReview: reviewer,
    activeReleaseId: active.rows[0].release_id,
    candidates: candidates.rows,
    releases: releases.rows,
    sources: entries.filter((e) => e.origin === 'experience'),
    benchmarks: suite.cases.map((c) => ({
      id: c.id,
      title: c.title,
      testCount: c.tests.length,
    })),
  };
}

export async function submitCandidate(viewer: Viewer | null, raw: unknown) {
  const input = candidateInput.parse(raw);
  const [experienceId, index] = input.sourceId.split(':');
  return transaction(async (client) => {
    if (viewer)
      await client.query('SELECT id FROM studio_users WHERE id=$1 FOR UPDATE', [
        viewer.id,
      ]);
    const result = await client.query(
      `SELECT e.*,v.validation FROM studio_experiences e
      JOIN studio_projects p ON p.id=e.project_id JOIN studio_jobs j ON j.id=e.job_id AND j.status='succeeded'
      JOIN studio_versions v ON v.id::text=e.evidence->>'versionId' AND v.project_id=e.project_id
      WHERE e.id=$1 AND e.outcome='passed' AND ($2::boolean OR p.owner_id=$3)`,
      [experienceId, accessMode === 'local', viewer?.id || null],
    );
    const source = result.rows[0];
    if (!source) throw new StudioError('找不到可贡献的项目经验。', 404);
    if (
      !parseLearning({ lessons: source.evidence.lessons }).lessons[
        Number(index)
      ] ||
      !['build', 'browser', 'start', 'restart'].every(
        (k) => source.validation?.[k] === true,
      )
    )
      throw new StudioError('来源版本尚未通过基础验收。');
    const id = randomUUID();
    const hash = contentHash(input.lesson);
    const prior = (
      await client.query(
        'SELECT id FROM studio_evolution_candidates WHERE experience_id=$1 AND lesson_index=$2 AND content_hash=$3',
        [experienceId, Number(index), hash],
      )
    ).rows[0];
    if (prior) return prior;
    const count = (
      await client.query(
        'SELECT count(*)::int AS n FROM studio_evolution_candidates WHERE author_id IS NOT DISTINCT FROM $1::uuid',
        [viewer?.id || null],
      )
    ).rows[0].n;
    if (count >= 100)
      throw new StudioError('本轮内测的经验贡献次数已达上限。', 429);
    const created = await client.query(
      `INSERT INTO studio_evolution_candidates(id,experience_id,lesson_index,author_id,lesson,content_hash)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(experience_id,lesson_index,content_hash) DO NOTHING RETURNING id`,
      [id, experienceId, Number(index), viewer?.id || null, input.lesson, hash],
    );
    if (!created.rowCount)
      return (
        await client.query(
          'SELECT id FROM studio_evolution_candidates WHERE experience_id=$1 AND lesson_index=$2 AND content_hash=$3',
          [experienceId, Number(index), hash],
        )
      ).rows[0];
    await client.query(
      "INSERT INTO studio_evolution_events(actor_id,action,candidate_id) VALUES($1,'submit',$2)",
      [viewer?.id || null, id],
    );
    return { id };
  });
}

export async function reviewCandidate(
  viewer: Viewer | null,
  id: string,
  raw: unknown,
) {
  requireEvolutionReviewer(viewer);
  uuid.parse(id);
  const input = reviewInput.parse(raw);
  return transaction(async (client) => {
    const row = (
      await client.query(
        'SELECT * FROM studio_evolution_candidates WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0];
    if (!row) throw new StudioError('经验候选不存在。', 404);
    if (
      row.content_hash !== input.contentHash ||
      contentHash(row.lesson) !== input.contentHash
    )
      throw new StudioError('经验内容已变化，请重新读取。', 409);
    if (row.status !== 'pending') {
      if (row.status === input.decision && row.review_note === input.note)
        return { id };
      throw new StudioError('这条经验已审核；修改内容需要重新提交候选。', 409);
    }
    await client.query(
      'UPDATE studio_evolution_candidates SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1',
      [id, input.decision, input.note, viewer?.id || null],
    );
    await client.query(
      'INSERT INTO studio_evolution_events(actor_id,action,candidate_id) VALUES($1,$2,$3)',
      [viewer?.id || null, input.decision, id],
    );
    return { id };
  });
}

export async function createKnowledgeRelease(
  viewer: Viewer | null,
  raw: unknown,
) {
  requireEvolutionReviewer(viewer);
  const input = releaseInput.parse(raw);
  const suite = await regressionSuite();
  return transaction(async (client) => {
    const active = (
      await client.query(
        'SELECT release_id FROM studio_public_knowledge WHERE id=1 FOR UPDATE',
      )
    ).rows[0].release_id;
    const existing = (
      await client.query(
        `SELECT ${releaseColumns},requested_candidate_ids FROM studio_knowledge_releases WHERE request_key=$1`,
        [input.requestKey],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.label !== input.label ||
        existing.baseReleaseId !== input.expectedReleaseId ||
        JSON.stringify(existing.requested_candidate_ids.slice().sort()) !==
          JSON.stringify([...new Set(input.candidateIds)].sort())
      )
        throw new StudioError('请求编号已用于其他候选版本。', 409);
      return { id: existing.id };
    }
    if (active !== input.expectedReleaseId)
      throw new StudioError('公共版本已改变，请刷新后重新创建。', 409);
    if (
      (
        await client.query(
          "SELECT id FROM studio_knowledge_releases WHERE status IN ('queued','running')",
        )
      ).rowCount
    )
      throw new StudioError('已有一个版本等待或正在复验，请等待完成。', 409);
    const selected = await client.query(
      "SELECT id,lesson,content_hash FROM studio_evolution_candidates WHERE id=ANY($1::uuid[]) AND status='reviewed' ORDER BY id",
      [[...new Set(input.candidateIds)]],
    );
    if (selected.rowCount !== new Set(input.candidateIds).size)
      throw new StudioError('只有经过内容审核的经验才能进入候选版本。');
    const prior: ReleaseEntry[] = active
      ? (
          await client.query(
            'SELECT entries FROM studio_knowledge_releases WHERE id=$1',
            [active],
          )
        ).rows[0].entries
      : [];
    const entries = new Map(prior.map((e) => [e.candidateId, e]));
    for (const row of selected.rows) {
      if (contentHash(row.lesson) !== row.content_hash)
        throw new StudioError('经验校验失败。');
      entries.set(row.id, {
        candidateId: row.id,
        ...lessonSchema.parse(row.lesson),
      });
    }
    const snapshot = [...entries.values()].sort((a, b) =>
      a.candidateId.localeCompare(b.candidateId),
    );
    if (snapshot.length > 50 || JSON.stringify(snapshot).length > 60000)
      throw new StudioError('当前公共经验数量已达首版上限。');
    const id = randomUUID();
    await client.query(
      `INSERT INTO studio_knowledge_releases(id,request_key,base_release_id,label,entries,content_hash,suite_hash,created_by,requested_candidate_ids)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        input.requestKey,
        active,
        input.label,
        JSON.stringify(snapshot),
        contentHash(snapshot),
        suite.hash,
        viewer?.id || null,
        [...new Set(input.candidateIds)].sort(),
      ],
    );
    await client.query(
      "INSERT INTO studio_evolution_events(actor_id,action,release_id) VALUES($1,'create_release',$2)",
      [viewer?.id || null, id],
    );
    return { id };
  });
}

export async function activateKnowledgeRelease(
  viewer: Viewer | null,
  raw: unknown,
) {
  requireEvolutionReviewer(viewer);
  const input = activateInput.parse(raw);
  const suite = await regressionSuite();
  return transaction(async (client) => {
    const active = (
      await client.query(
        'SELECT release_id FROM studio_public_knowledge WHERE id=1 FOR UPDATE',
      )
    ).rows[0].release_id;
    if (active === input.targetReleaseId) return { id: active };
    if (active !== input.expectedReleaseId)
      throw new StudioError('公共版本已改变，请刷新后重试。', 409);
    let rollback = input.targetReleaseId === null;
    if (input.targetReleaseId) {
      const row = (
        await client.query(
          `SELECT ${releaseColumns},checked_at FROM studio_knowledge_releases WHERE id=$1 FOR UPDATE`,
          [input.targetReleaseId],
        )
      ).rows[0] as KnowledgeRelease & { checked_at: Date };
      if (!row) throw new StudioError('公共版本不存在。', 404);
      if (
        row.status !== 'passed' ||
        !row.report?.passed ||
        row.report.contentHash !== row.contentHash ||
        contentHash(row.entries) !== row.contentHash
      )
        throw new StudioError('候选版本尚未通过完整复验，不能发布。', 409);
      rollback = !!row.publishedAt;
      if (!rollback) {
        if (row.baseReleaseId !== active)
          throw new StudioError('该候选基于旧公共版本，请重新创建候选。', 409);
        if (
          row.suiteHash !== suite.hash ||
          row.report.suiteHash !== suite.hash ||
          Date.now() - new Date(row.checked_at).getTime() > 86400000
        )
          throw new StudioError(
            '复验证据已过期或测试集改变，请重新创建候选版本。',
            409,
          );
        assertRegressionReport(row.report, suite);
      }
      await client.query(
        'UPDATE studio_knowledge_releases SET published_at=coalesce(published_at,now()) WHERE id=$1',
        [row.id],
      );
    }
    await client.query(
      'UPDATE studio_public_knowledge SET release_id=$1 WHERE id=1',
      [input.targetReleaseId],
    );
    await client.query(
      'INSERT INTO studio_evolution_events(actor_id,action,release_id,previous_release_id) VALUES($1,$2,$3,$4)',
      [
        viewer?.id || null,
        rollback ? 'rollback' : 'publish',
        input.targetReleaseId,
        active,
      ],
    );
    return { id: input.targetReleaseId };
  });
}

export function assertRegressionReport(
  report: RegressionReport,
  suite: Awaited<ReturnType<typeof regressionSuite>>,
) {
  if (
    !report.passed ||
    report.scope !== 'reference-rules' ||
    report.suiteHash !== suite.hash ||
    report.environment?.kind !== 'docker' ||
    !/^sha256:[a-f0-9]{64}$/.test(report.environment.image) ||
    report.cases.length !== suite.cases.length
  )
    throw new StudioError('复验证据不完整。', 409);
  for (const item of suite.cases) {
    const result = report.cases.find((c) => c.id === item.id);
    if (
      !result?.passed ||
      result.tests.some((t) => !t.passed) ||
      JSON.stringify(result.tests.map((t) => t.name)) !==
        JSON.stringify(item.tests)
    )
      throw new StudioError('复验证据缺少预期用例。', 409);
  }
}

// The worker's existing exclusive database lock owns this queue too.
export async function recoverEvolutionChecks() {
  await pool().query(
    "UPDATE studio_knowledge_releases SET status='failed',error='复验进程中断，请创建新的候选版本。' WHERE status='running'",
  );
}
export async function performNextEvolutionCheck(
  signal: AbortSignal,
): Promise<boolean> {
  const row = await transaction(async (client) => {
    const next = (
      await client.query(
        "SELECT id FROM studio_knowledge_releases WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
      )
    ).rows[0];
    if (!next) return null;
    return (
      await client.query(
        `UPDATE studio_knowledge_releases SET status='running' WHERE id=$1 RETURNING ${releaseColumns}`,
        [next.id],
      )
    ).rows[0] as KnowledgeRelease;
  });
  if (!row) return false;
  try {
    if (contentHash(row.entries) !== row.contentHash)
      throw new Error('候选版本内容校验失败。');
    const report = await runEvolutionRegression({
      releaseId: row.id,
      suiteHash: row.suiteHash,
      contentHash: row.contentHash,
      signal,
    });
    const suite = await regressionSuite();
    if (report.passed) assertRegressionReport(report, suite);
    await pool().query(
      "UPDATE studio_knowledge_releases SET status=$2,report=$3,error=$4,checked_at=now() WHERE id=$1 AND status='running'",
      [
        row.id,
        report.passed ? 'passed' : 'failed',
        report,
        report.passed ? null : '至少一个参照样例未通过，未改变当前公共版本。',
      ],
    );
  } catch {
    await pool().query(
      "UPDATE studio_knowledge_releases SET status='failed',error=$2,checked_at=now() WHERE id=$1 AND status='running'",
      [
        row.id,
        signal.aborted
          ? '复验被中断，请重新创建候选版本。'
          : '复验未完成，请检查独立环境及固定样例文件后重试。',
      ],
    );
  }
  return true;
}
