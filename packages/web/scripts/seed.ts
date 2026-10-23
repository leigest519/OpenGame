import { randomUUID } from 'node:crypto';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { artifactDir, webRoot } from '../src/server/config';
import { migrate, pool, transaction } from '../src/server/db';
import {
  prepareWorkspace,
  commitWorkspace,
  standardsVersion,
} from '../src/server/workspace';
import {
  artifactHash,
  buildGame,
  validateGame,
} from '../src/server/build-game';
import type { Job } from '../src/shared/types';

export async function seed(): Promise<void> {
  await migrate();
  const projectId = '10000000-0000-4000-8000-000000000001';
  if (
    (
      await pool().query(
        'SELECT latest_version_id FROM studio_projects WHERE id=$1',
        [projectId],
      )
    ).rows[0]?.latest_version_id
  )
    return;
  await pool().query(
    "INSERT INTO studio_projects(id,title,description,source) VALUES($1,'星尘远航','驾驶飞船，躲避流星，收集宇宙里的微光。','sample') ON CONFLICT(id) DO NOTHING",
    [projectId],
  );
  const job: Job = {
    id: randomUUID(),
    project_id: projectId,
    base_version_id: null,
    prompt: '',
    status: 'running',
    phase: 'preparing',
    cancel_requested: false,
    attempt: 1,
    lease_token: null,
    prepared: null,
    error: null,
    created_at: new Date().toISOString(),
    finished_at: null,
  };
  const workspace = await prepareWorkspace(job);
  await cp(
    path.join(webRoot, 'resources/sample-main.ts'),
    path.join(workspace, 'src/main.ts'),
  );
  await writeFile(
    path.join(workspace, 'gameConfig.json'),
    '{"speed": 290, "fallSpeed": 145}\n',
  );
  await writeFile(
    path.join(workspace, 'design.md'),
    '# 星尘远航\n\n方向键或 WASD 控制飞船，也可触摸拖动。收集 15 枚青色星尘完成目标；撞到流星损失两枚，短暂无敌。可随时重新开始。\n',
  );
  await writeFile(
    path.join(workspace, 'memory.md'),
    '# 项目记忆\n\n## 已确认\n\n这是平台附带的参考作品，不是一次 AI 生成结果。\n\n## 设计约定\n\n深蓝太空、青色飞船和星尘；节奏轻松。速度和难度数值保存在 gameConfig.json。\n\n## 验证\n\n由平台检查开始与重新开始；玩法质量仍需试玩。\n',
  );
  const id = randomUUID();
  const output = artifactDir(id);
  await mkdir(output, { recursive: true });
  await buildGame(workspace, output);
  const validation = await validateGame(output);
  const commit = await commitWorkspace(job, workspace);
  const hash = await artifactHash(output);
  await transaction(async (client) => {
    await client.query(
      "INSERT INTO studio_versions(id,project_id,number,commit_sha,artifact_key,artifact_hash,summary,kind,standards_version,validation) VALUES($1::uuid,$2,1,$3,$1::text,$4,'内置参考作品：星尘远航','sample',$5,$6)",
      [id, projectId, commit, hash, standardsVersion, validation],
    );
    await client.query(
      'UPDATE studio_projects SET latest_version_id=$2 WHERE id=$1',
      [projectId, id],
    );
  });
  console.log('参考作品已准备好。');
}
if (process.argv[1]?.endsWith('seed.ts')) {
  await seed();
  await pool().end();
}
