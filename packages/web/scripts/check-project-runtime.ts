import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { artifactDir, dataRoot, projectRepo } from '../src/server/config';
import { pool } from '../src/server/db';
import { getProject } from '../src/server/store';
import { run } from '../src/server/process';
import {
  checkInProjectContainer,
  requireRuntimeImage,
} from '../src/server/project-runtime';
import { artifactHash } from '../src/server/build-game';

const projectId = process.argv[2];
if (
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
    projectId || '',
  )
)
  throw new Error('请提供需要复验的项目编号。');
const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
const timeout = setTimeout(() => controller.abort(), 180000);
let temporary: string | undefined;
try {
  const detail = await getProject(projectId);
  const base = detail.versions.find(
    (v) => v.id === detail.project.latest_version_id,
  );
  if (!base) throw new Error('项目还没有可复验的版本。');
  const originalHash = await artifactHash(artifactDir(base.artifact_key));
  const image = await requireRuntimeImage();
  temporary = await mkdtemp(path.join(dataRoot, 'runtime-check-workspace-'));
  const workspace = path.join(temporary, 'project');
  await run(
    'git',
    ['clone', '--no-hardlinks', projectRepo(projectId), workspace],
    dataRoot,
  );
  await run('git', ['checkout', '--detach', base.commit_sha], workspace);
  const parent = path.join(dataRoot, 'runtime-checks', projectId, randomUUID());
  await mkdir(parent, { recursive: true });
  const validation = await checkInProjectContainer({
    projectId,
    jobId: randomUUID(),
    workspace,
    image,
    output: path.join(parent, 'game'),
    signal: controller.signal,
  });
  const unchanged =
    originalHash === (await artifactHash(artifactDir(base.artifact_key)));
  if (!unchanged) throw new Error('原版本产物发生意外变化。');
  const report = {
    projectId,
    title: detail.project.title,
    version: base.id,
    commit: base.commit_sha,
    originalArtifactsUnchanged: unchanged,
    validation,
  };
  await writeFile(
    path.join(parent, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      { ...report, reportPath: path.join(parent, 'report.json') },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(timeout);
  if (temporary) await rm(temporary, { recursive: true, force: true });
  await pool().end();
}
