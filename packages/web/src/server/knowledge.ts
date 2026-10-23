import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { webRoot, accessMode } from './config';
import { migrate, pool } from './db';
import { publicKnowledge } from './public-knowledge';
import type {
  GameLesson,
  KnowledgeEntry,
  KnowledgeSnapshot,
} from '../shared/knowledge';

export const lessonSchema = z
  .object({
    title: z.string().trim().min(2).max(80),
    tags: z.array(z.string().trim().min(2).max(30)).min(1).max(8),
    appliesTo: z.string().trim().min(3).max(240),
    advice: z.string().trim().min(5).max(900),
    pitfalls: z.string().trim().min(3).max(300),
  })
  .strict();
const learningSchema = z
  .object({ lessons: z.array(lessonSchema).max(3) })
  .strict();

export function parseLearning(value: unknown): {
  lessons: GameLesson[];
  note?: string;
} {
  const result = learningSchema.safeParse(value);
  return result.success
    ? result.data
    : { lessons: [], note: '经验文件格式不符合约定，未加入知识库。' };
}

export async function readLearning(
  dir: string,
): Promise<{ lessons: GameLesson[]; note?: string }> {
  try {
    const file = path.join(dir, 'learning.json');
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16000)
      return { lessons: [], note: '经验文件超出可读取范围，未加入知识库。' };
    return parseLearning(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    return {
      lessons: [],
      note:
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? '本轮没有提供可归档的经验。'
          : '经验文件无法读取，未加入知识库。',
    };
  }
}

export async function seedKnowledge(): Promise<KnowledgeEntry[]> {
  return JSON.parse(
    await readFile(path.join(webRoot, 'resources/knowledge/seed.json'), 'utf8'),
  );
}

export async function loadKnowledge(
  ownerId?: string,
): Promise<KnowledgeEntry[]> {
  await migrate();
  const result = await pool().query(
    `
    SELECT e.id,e.project_id,e.evidence,p.title,v.id AS version_id,v.number
    FROM studio_experiences e
    JOIN studio_projects p ON p.id=e.project_id
    JOIN studio_jobs j ON j.id=e.job_id AND j.status='succeeded'
    JOIN studio_versions v ON v.id::text=e.evidence->>'versionId' AND v.project_id=e.project_id
    WHERE e.outcome='passed' AND jsonb_typeof(e.evidence->'lessons')='array'
      AND e.evidence->'lessons' <> '[]'::jsonb
      AND ($1::boolean OR p.owner_id=$2)
    ORDER BY e.created_at DESC,e.id DESC LIMIT 200
  `,
    [accessMode === 'local', ownerId || null],
  );
  const published = await publicKnowledge();
  const entries = [...(await seedKnowledge()), ...published];
  const lessonHash = (lesson: GameLesson) =>
    createHash('sha256')
      .update(
        JSON.stringify({
          title: lesson.title,
          tags: lesson.tags,
          appliesTo: lesson.appliesTo,
          advice: lesson.advice,
          pitfalls: lesson.pitfalls,
        }),
      )
      .digest('hex');
  const seen = new Set(published.map(lessonHash));
  for (const row of result.rows) {
    const validation = row.evidence.validation;
    if (
      !validation?.build ||
      !validation.browser ||
      !validation.start ||
      !validation.restart
    )
      continue;
    const { lessons } = parseLearning({ lessons: row.evidence.lessons });
    lessons.forEach((lesson, index) => {
      const fingerprint = lessonHash(lesson);
      if (seen.has(fingerprint)) return;
      seen.add(fingerprint);
      entries.push({
        ...lesson,
        id: `${row.id}:${index}`,
        origin: 'experience',
        source: {
          label: `${row.title} · 版本 ${row.number}`,
          projectId: row.project_id,
          versionId: row.version_id,
          reference: '已保存版本的 learning.json',
        },
        verification:
          '来源版本通过构建、启动和重开检查。此条为模型归纳的待复验经验，不代表完整玩法或跨游戏验证。',
      });
    });
  }
  return entries;
}

export function selectKnowledge(
  query: string,
  entries: KnowledgeEntry[],
  excludeProjectId?: string,
): KnowledgeEntry[] {
  const input = query.toLocaleLowerCase();
  const ranked = entries
    .filter(
      (entry) =>
        !excludeProjectId || entry.source.projectId !== excludeProjectId,
    )
    .map((entry, index) => ({
      entry,
      index,
      score: entry.tags.reduce(
        (n, tag) => n + (input.includes(tag.toLocaleLowerCase()) ? 1 : 0),
        0,
      ),
    }))
    .filter((item) => item.entry.always || item.score > 0)
    .sort(
      (a, b) =>
        Number(!!b.entry.always) - Number(!!a.entry.always) ||
        b.score - a.score ||
        Number(b.entry.origin === 'public') -
          Number(a.entry.origin === 'public') ||
        a.index - b.index,
    );
  const selected: KnowledgeEntry[] = [];
  let length = 0;
  for (const { entry } of ranked) {
    const size = JSON.stringify(entry).length;
    if (length + size > 6000) continue;
    selected.push(entry);
    length += size;
    if (selected.length === 5) break;
  }
  return selected;
}

export function snapshotKnowledge(
  entries: KnowledgeEntry[],
): KnowledgeSnapshot {
  // The worker owns this snapshot; generated code cannot alter its provenance.
  const copy = structuredClone(entries);
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sha256: createHash('sha256').update(JSON.stringify(copy)).digest('hex'),
    entries: copy,
  };
}
