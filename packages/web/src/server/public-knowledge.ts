import { createHash } from 'node:crypto';
import { migrate, pool } from './db';
import type { KnowledgeEntry } from '../shared/knowledge';
import type { ReleaseEntry } from '../shared/evolution';

export function contentHash(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export async function publicKnowledge(): Promise<KnowledgeEntry[]> {
  await migrate();
  const result = await pool().query(`
    SELECT r.id,r.number,r.entries,r.content_hash FROM studio_public_knowledge s
    JOIN studio_knowledge_releases r ON r.id=s.release_id
    WHERE s.id=1 AND r.status='passed' AND r.published_at IS NOT NULL
  `);
  const release = result.rows[0];
  if (!release) return [];
  if (contentHash(release.entries) !== release.content_hash)
    throw new Error('公共知识版本校验失败。');
  return (release.entries as ReleaseEntry[]).map(
    ({ candidateId, ...lesson }) => ({
      ...lesson,
      id: `public:${release.id}:${candidateId}`,
      origin: 'public',
      publicReleaseId: release.id,
      publicReleaseNumber: release.number,
      // Public readers receive reviewed general advice, never private project metadata.
      source: {
        label: `公共知识 v${release.number}`,
        reference: '经过内容审核的经验；原始来源由平台保管',
      },
      verification:
        '已通过内容审核，并回放三个固定样例的规则检查。该回归不证明新需求的生成成功率已提高，也不覆盖画面与真机操作。',
    }),
  );
}
