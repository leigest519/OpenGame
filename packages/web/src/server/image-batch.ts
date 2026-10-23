import { saveImageGallery } from './image-gallery';
import { randomUUID, createHash } from 'node:crypto';
import { pool, transaction } from './db';
import { StudioError, submitJob } from './store';
import { captureCanvas } from './canvas';
import { imageBatchSchema } from '../shared/image-batch';

export async function createImageBatch(
  projectId: string,
  ownerId: string | undefined,
  value: unknown,
) {
  const input = imageBatchSchema.parse(value);
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      input.requestKey,
    ]);
    const project = (
      await client.query(
        'SELECT * FROM studio_projects WHERE id=$1 FOR UPDATE',
        [projectId],
      )
    ).rows[0];
    if (!project || (ownerId && project.owner_id !== ownerId))
      throw new StudioError('找不到这个项目。', 404);
    const existing = (
      await client.query(
        'SELECT * FROM studio_image_batches WHERE request_key=$1',
        [input.requestKey],
      )
    ).rows[0];
    if (existing) {
      if (existing.project_id !== projectId || existing.request_hash !== hash)
        throw new StudioError('请求内容已改变，请重新提交。', 409);
      return { batchId: existing.id };
    }
    if (project.media_kind !== 'image')
      throw new StudioError('批量制作仅适用于图片作品。');
    if (project.latest_version_id !== input.baseVersionId)
      throw new StudioError('图片已有更新，请刷新后重试。', 409);
    if (ownerId) {
      const user = (
        await client.query(
          'SELECT id FROM studio_users WHERE id=$1 AND NOT disabled AND expires_at>now() FOR UPDATE',
          [ownerId],
        )
      ).rows[0];
      if (!user) throw new StudioError('内测访问已到期。', 401);
    }
    const active = await client.query(
      `SELECT 1 FROM studio_projects p WHERE (p.id=$1 OR ($2::uuid IS NOT NULL AND p.owner_id=$2)) AND (
      EXISTS(SELECT 1 FROM studio_jobs j WHERE j.project_id=p.id AND j.status IN ('queued','running')) OR
      EXISTS(SELECT 1 FROM studio_image_batches b WHERE b.project_id=p.id AND b.status='active'))`,
      [projectId, ownerId || null],
    );
    if (active.rowCount)
      throw new StudioError(
        '已有制作任务，请完成或停止后再开始批量制作。',
        409,
      );
    const id = randomUUID();
    const snapshot = await captureCanvas(client, projectId, input.canvas);
    await client.query(
      `INSERT INTO studio_image_batches(id,project_id,base_version_id,request_key,request_hash,prompt,styles,request_keys,model,canvas_snapshot,grouped)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
      [
        id,
        projectId,
        input.baseVersionId,
        input.requestKey,
        hash,
        input.prompt,
        JSON.stringify(input.styles),
        JSON.stringify(input.styles.map(() => randomUUID())),
        input.model,
        snapshot,
      ],
    );
    await client.query(
      "INSERT INTO studio_messages(id,project_id,role,content) VALUES($1,$2,'user',$3)",
      [
        randomUUID(),
        projectId,
        `批量制作 ${input.styles.length} 张：${input.styles.join('、')}。\n${input.prompt}`,
      ],
    );
    return { batchId: id };
  });
}

export async function cancelImageBatch(
  projectId: string,
  id: string,
  ownerId?: string,
) {
  await transaction(async (client) => {
    const project = (
      await client.query(
        'SELECT * FROM studio_projects WHERE id=$1 FOR UPDATE',
        [projectId],
      )
    ).rows[0];
    if (!project || (ownerId && project.owner_id !== ownerId))
      throw new StudioError('找不到这个项目。', 404);
    const result = await client.query(
      "UPDATE studio_image_batches SET status='cancelled' WHERE id=$1 AND project_id=$2 AND status='active' RETURNING id",
      [id, projectId],
    );
    if (!result.rowCount) return;
    await client.query(
      "UPDATE studio_jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE image_batch_id=$1 AND status IN ('queued','running')",
      [id],
    );
  });
}

// Called by the single worker: durable items survive closed tabs and worker restarts.
export async function scheduleImageBatches() {
  const pending = (
    await pool().query(
      "SELECT id FROM studio_image_batches WHERE grouped AND result_version_id IS NULL AND status<>'active'",
    )
  ).rows;
  for (const row of pending) await saveImageGallery(row.id);

  const batches = (
    await pool().query(
      "SELECT b.*,p.owner_id,p.latest_version_id FROM studio_image_batches b JOIN studio_projects p ON p.id=b.project_id WHERE b.status='active' ORDER BY b.created_at",
    )
  ).rows;
  for (const batch of batches) {
    const jobs = (
      await pool().query(
        'SELECT status,image_batch_index FROM studio_jobs WHERE image_batch_id=$1 ORDER BY image_batch_index',
        [batch.id],
      )
    ).rows;
    if (jobs.some((j) => ['queued', 'running'].includes(j.status))) continue;
    if (jobs.length === batch.styles.length) {
      await saveImageGallery(batch.id);
      await pool().query(
        "UPDATE studio_image_batches SET status='completed' WHERE id=$1 AND status='active'",
        [batch.id],
      );
      continue;
    }
    const index = jobs.length;
    try {
      await submitJob({
        projectId: batch.project_id,
        ownerId: batch.owner_id || undefined,
        baseVersionId: batch.latest_version_id,
        kind: 'build',
        model: batch.model,
        requestKey: batch.request_keys[index],
        imageBatch: { id: batch.id, index },
        prompt: `${batch.prompt}\n本张风格：${batch.styles[index]}。本批第 ${index + 1}/${batch.styles.length} 张。只生成一张独立图片，不拼图、不加风格标签文字。所有风格均基于本批最初的同一参考图，保留主体和构图；根据当前风格调整表现方式。`,
      });
    } catch (error) {
      await pool().query(
        "UPDATE studio_image_batches SET status='failed',error=$2 WHERE id=$1 AND status='active'",
        [
          batch.id,
          error instanceof Error ? error.message : '批量任务无法继续。',
        ],
      );
    }
  }
}
