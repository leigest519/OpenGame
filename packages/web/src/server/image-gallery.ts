import { mkdir, cp, writeFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { artifactDir, dataRoot } from './config';
import { artifactHash } from './artifact-hash';
import { pool, transaction } from './db';
import type { PreparedVersion } from '../shared/types';

export async function saveImageGallery(batchId: string) {
  const batch = (
    await pool().query('SELECT * FROM studio_image_batches WHERE id=$1', [
      batchId,
    ])
  ).rows[0];
  if (!batch?.grouped || batch.result_version_id) return;
  const jobs = (
    await pool().query(
      'SELECT * FROM studio_jobs WHERE image_batch_id=$1 ORDER BY image_batch_index',
      [batchId],
    )
  ).rows;
  if (jobs.some((j) => ['queued', 'running'].includes(j.status))) return;
  if (batch.status === 'active' && jobs.length < batch.styles.length) return;
  const successes = jobs.filter((j) => j.status === 'succeeded' && j.prepared);
  if (!successes.length) return;
  const first = successes[0].prepared as PreparedVersion;
  const images = successes.map((j, index) => ({
    file: index === 0 ? 'artwork.png' : `artwork-${index + 1}.png`,
    label: batch.styles[j.image_batch_index] as string,
    batchIndex: j.image_batch_index as number,
    ...j.prepared.validation.image,
  }));
  const temporary = path.join(
    dataRoot,
    'pending-artifacts',
    `gallery-${randomUUID()}`,
  );
  await mkdir(temporary, { recursive: true });
  try {
    for (let i = 0; i < successes.length; i++)
      await cp(
        path.join(
          artifactDir(successes[i].prepared.artifactKey),
          'artwork.png',
        ),
        path.join(temporary, images[i].file),
      );
    await cp(
      path.join(artifactDir(first.artifactKey), 'preview.png'),
      path.join(temporary, 'preview.png'),
    );
    const escape = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[c]!,
      );
    await writeFile(
      path.join(temporary, 'index.html'),
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>图片组</title><style>body{margin:0;padding:20px;background:#111629;color:white;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px}figure{margin:0}img{width:100%;height:75vh;object-fit:contain}figcaption{text-align:center;padding:10px}</style><main>${images.map((i) => `<figure><img src="./${i.file}" alt="${escape(i.label)}"><figcaption>${escape(i.label)}</figcaption></figure>`).join('')}</main></html>`,
    );
    await writeFile(
      path.join(temporary, 'image-gallery.json'),
      JSON.stringify({ images }, null, 2),
    );
    const hash = await artifactHash(temporary);
    await mkdir(path.dirname(artifactDir(batch.id)), { recursive: true });
    const exists = await stat(artifactDir(batch.id)).then(
      () => true,
      () => false,
    );
    if (exists) {
      if ((await artifactHash(artifactDir(batch.id))) !== hash)
        throw Error('图片组产物校验失败。');
    } else await rename(temporary, artifactDir(batch.id));
    await transaction(async (client) => {
      const project = (
        await client.query(
          'SELECT * FROM studio_projects WHERE id=$1 FOR UPDATE',
          [batch.project_id],
        )
      ).rows[0];
      const current = (
        await client.query(
          'SELECT * FROM studio_image_batches WHERE id=$1 FOR UPDATE',
          [batch.id],
        )
      ).rows[0];
      if (current.result_version_id) return;
      const count = (
        await client.query(
          'SELECT coalesce(max(number),0)+1 AS n FROM studio_versions WHERE project_id=$1',
          [batch.project_id],
        )
      ).rows[0].n;
      await client.query(
        "INSERT INTO studio_versions(id,project_id,number,commit_sha,artifact_key,artifact_hash,summary,kind,standards_version,validation,canvas_snapshot) VALUES($1,$2,$3,$4,$10,$5,$6,'generated',$7,$8,$9)",
        [
          batch.id,
          batch.project_id,
          count,
          first.commitSha,
          hash,
          `图片组 · ${images.length} 张：${images.map((i) => i.label).join('、')}`,
          first.standardsVersion,
          { ...first.validation, images },
          batch.canvas_snapshot,
          batch.id,
        ],
      );
      await client.query(
        'UPDATE studio_image_batches SET result_version_id=$1 WHERE id=$1',
        [batch.id],
      );
      await client.query(
        "UPDATE studio_jobs SET result_version_id=$2 WHERE image_batch_id=$1 AND status='succeeded'",
        [batch.id, batch.id],
      );
      if (project.latest_version_id === batch.base_version_id)
        await client.query(
          "UPDATE studio_projects SET latest_version_id=$2,updated_at=now() WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM studio_image_batches WHERE project_id=$1 AND id<>$2 AND status='active')",
          [batch.project_id, batch.id],
        );
      await client.query(
        "INSERT INTO studio_messages(id,project_id,role,content) VALUES($1,$2,'assistant',$3)",
        [
          randomUUID(),
          batch.project_id,
          `已保存版本 ${count}，包含 ${images.length} 张图片。可以并排查看、放大和逐张下载。`,
        ],
      );
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
