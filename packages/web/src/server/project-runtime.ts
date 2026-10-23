import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from './config';
import { assertProjectFiles, projectFiles } from './project-files';
import { run } from './process';
import type { ValidationReport } from '../shared/types';
import {
  acceptanceScreenshots,
  qualityScreenshots,
} from '../shared/game-quality';
import type { AcceptanceCase } from '../shared/game-production';
import { parseAcceptanceCases } from './game-playtest';

export const runtimeImage = 'opengame-project-runtime:0.4.0';
const instance = createHash('sha256')
  .update(dataRoot)
  .digest('hex')
  .slice(0, 16);
const ownerLabel = `io.opengame.instance=${instance}`;
const allowedArtifacts = new Set([
  'index.html',
  'game.js',
  'game.css',
  'base.css',
  ...qualityScreenshots.map((shot) => shot.file),
  ...acceptanceScreenshots,
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export class RuntimeUnavailableError extends Error {}

// Stream bytes from a checked regular file. Docker's archive copy cannot read
// these private tmpfs mounts reliably; do not extract container-controlled tar
// files or symbolic links onto the host.
function readArtifact(
  container: string,
  file: string,
  signal: AbortSignal,
): Promise<Buffer> {
  if (!allowedArtifacts.has(file)) throw new Error('不支持的游戏产物。');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        container,
        'node',
        '-e',
        `
      const fs = require('fs');
      const fd = fs.openSync(process.argv[1], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const info = fs.fstatSync(fd);
      if (!info.isFile() || info.size > 64000000) process.exit(2);
      fs.createReadStream(null, {fd}).pipe(process.stdout);
    `,
        `/output/${file}`,
      ],
      {
        env: {
          NODE_ENV: 'production',
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
        },
        signal,
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64_000_000) child.kill();
      else chunks.push(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 && size <= 64_000_000
        ? resolve(Buffer.concat(chunks))
        : reject(new RuntimeUnavailableError('独立环境的游戏产物导出失败。')),
    );
  });
}

export async function requireRuntimeImage(): Promise<string> {
  try {
    const id = await run(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', runtimeImage],
      dataRoot,
      { timeout: 5000 },
    );
    if (!/^sha256:[a-f0-9]{64}$/.test(id))
      throw new Error('Invalid runtime image');
    return id;
  } catch {
    throw new RuntimeUnavailableError(
      '项目独立环境尚未就绪。请启动 Docker，并在本机完成独立环境准备；上一可玩版本保留。',
    );
  }
}

let statusCache:
  | {
      expires: number;
      result: Promise<{ runtimeReady: boolean; runtime: 'docker' }>;
    }
  | undefined;
export function runtimeStatus() {
  if (!statusCache || statusCache.expires < Date.now()) {
    statusCache = {
      expires: Date.now() + 5000,
      result: requireRuntimeImage().then(
        () => ({ runtimeReady: true, runtime: 'docker' as const }),
        () => ({ runtimeReady: false, runtime: 'docker' as const }),
      ),
    };
  }
  return statusCache.result;
}

export function containerArguments(options: {
  name: string;
  input: string;
  image: string;
  projectId: string;
  jobId: string;
  owner?: 'worker' | 'verification';
}): string[] {
  if (!uuid.test(options.projectId) || !uuid.test(options.jobId))
    throw new Error('无效的项目或任务编号。');
  if (!path.isAbsolute(options.input) || /[,\n\r]/.test(options.input))
    throw new Error('独立环境目录不能包含逗号或换行。');
  return [
    'run',
    '--detach',
    '--rm',
    '--init',
    '--name',
    options.name,
    '--label',
    ownerLabel,
    '--label',
    `io.opengame.project=${options.projectId}`,
    '--label',
    `io.opengame.job=${options.jobId}`,
    '--label',
    `io.opengame.owner=${options.owner || 'verification'}`,
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '1000:1000',
    '--cpus',
    '1',
    '--memory',
    '1g',
    '--memory-swap',
    '1g',
    '--pids-limit',
    '256',
    '--shm-size',
    '128m',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777',
    '--tmpfs',
    '/output:rw,noexec,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700',
    '--mount',
    `type=bind,source=${options.input},target=/input,readonly`,
    // Docker's client can inject authenticated proxy URLs from user config.
    // This offline runtime must not inherit them.
    ...[
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'ALL_PROXY',
      'NO_PROXY',
      'http_proxy',
      'https_proxy',
      'all_proxy',
      'no_proxy',
    ].flatMap((key) => ['--env', `${key}=`]),
    options.image,
  ];
}

// Call only after obtaining the worker's exclusive DB lock. Never touch other
// installations' containers, even when they use the same project UUID.
export async function recoverProjectContainers(): Promise<void> {
  const ids = await run(
    'docker',
    [
      'ps',
      '--all',
      '--quiet',
      '--filter',
      `label=${ownerLabel}`,
      '--filter',
      'label=io.opengame.owner=worker',
    ],
    dataRoot,
    { timeout: 5000 },
  );
  for (const id of ids.split('\n').filter(Boolean)) {
    if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Invalid container ID');
    await run('docker', ['rm', '--force', id], dataRoot, { timeout: 10000 });
  }
}

export class ProjectContainer {
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private constructor(
    readonly name: string,
    readonly input: string,
    readonly projectId: string,
    readonly image: string,
    private readonly acceptance: AcceptanceCase[],
  ) {}

  static async start(options: {
    projectId: string;
    jobId: string;
    workspace: string;
    image: string;
    signal: AbortSignal;
    owner?: 'worker' | 'verification';
    acceptance?: AcceptanceCase[];
  }): Promise<ProjectContainer> {
    options.signal.throwIfAborted();
    if (!uuid.test(options.projectId) || !uuid.test(options.jobId))
      throw new Error('无效的项目或任务编号。');
    const acceptance = parseAcceptanceCases(options.acceptance || []);
    await assertProjectFiles(options.workspace);
    const parent = path.join(dataRoot, 'runtime-inputs');
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const input = await mkdtemp(path.join(parent, `${options.projectId}-`));
    const name = `opengame-${instance}-${options.projectId}-${randomUUID().slice(0, 8)}`;
    const container = new ProjectContainer(
      name,
      input,
      options.projectId,
      options.image,
      acceptance,
    );
    try {
      await chmod(input, 0o755);
      // Authored by the read-only reviewer and frozen by the host, never read from the game.
      await writeFile(
        path.join(input, 'acceptance.json'),
        JSON.stringify(container.acceptance),
        { mode: 0o444 },
      );
      // Copy a closed set of ordinary files, not the workspace's Git database,
      // platform source, model credentials, or another project's directories.
      for (const file of await projectFiles(options.workspace)) {
        const target = path.join(input, 'project', file);
        // systemd uses a private umask. Explicit directory permissions let the
        // container's unrelated UID traverse only this read-only input mount.
        let directory = input;
        for (const segment of path
          .relative(input, path.dirname(target))
          .split(path.sep)) {
          directory = path.join(directory, segment);
          await mkdir(directory, { recursive: true, mode: 0o755 });
          await chmod(directory, 0o755);
        }
        await copyFile(path.join(options.workspace, file), target);
        await chmod(target, 0o444);
      }
      const lease = path.join(input, 'lease');
      await writeFile(lease, '', { mode: 0o644 });
      container.heartbeat = setInterval(() => {
        const now = new Date();
        void utimes(lease, now, now).catch(() => {
          /* Guardian expires a lost lease. */
        });
      }, 5000);
      container.heartbeat.unref();
      // Do not abort this launch halfway: wait for the daemon's answer and then
      // remove the known container name if cancellation arrived during launch.
      await run(
        'docker',
        containerArguments({ ...options, name, input }),
        dataRoot,
        { timeout: 30000 },
      );
      options.signal.throwIfAborted();
      return container;
    } catch (error) {
      await container.dispose();
      if (options.signal.aborted) throw error;
      throw new RuntimeUnavailableError(
        '项目独立环境启动失败，请检查 Docker 的可用资源。',
      );
    }
  }

  // Only platform-owned server code calls this; it is never a web API.
  async exec(
    args: string[],
    signal?: AbortSignal,
    timeout = 120000,
  ): Promise<string> {
    if (this.disposed)
      throw new RuntimeUnavailableError('项目独立环境已停止。');
    try {
      return await run('docker', ['exec', this.name, ...args], dataRoot, {
        signal,
        timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new RuntimeUnavailableError(
        '独立环境中的检查进程未完成，可能已超时或超过资源上限。',
      );
    }
  }

  async check(output: string, signal: AbortSignal): Promise<ValidationReport> {
    signal.throwIfAborted();
    const result = await this.exec(['node', '/opt/opengame/check.mjs'], signal);
    const line = result
      .split('\n')
      .findLast((item) => item.startsWith('OPENGAME_RESULT='));
    if (!line) throw new RuntimeUnavailableError('独立环境没有返回检查结果。');
    let data;
    try {
      data = JSON.parse(line.slice('OPENGAME_RESULT='.length));
    } catch {
      throw new RuntimeUnavailableError('独立环境返回了无效的检查结果。');
    }
    if (!data.ok)
      throw new Error(
        typeof data.error === 'string'
          ? data.error.slice(0, 1500)
          : '游戏未通过检查。',
      );
    const report = data.validation as ValidationReport;
    if (
      !report ||
      report.build !== true ||
      report.browser !== true ||
      report.start !== true ||
      report.restart !== true ||
      !Array.isArray(report.errors) ||
      report.errors.length ||
      typeof report.checkedAt !== 'string'
    )
      throw new RuntimeUnavailableError('独立环境返回了无效的检查结果。');
    const quality = report.quality;
    if (
      !quality ||
      !Array.isArray(quality.screenshots) ||
      quality.screenshots.length !== qualityScreenshots.length ||
      !qualityScreenshots.every((shot, index) => {
        const actual = quality.screenshots[index];
        return (
          actual?.file === shot.file &&
          actual.label === shot.label &&
          actual.width === shot.width &&
          actual.height === shot.height
        );
      }) ||
      !quality.playtest ||
      !['passed', 'missing'].includes(quality.playtest.status) ||
      !Number.isInteger(quality.playtest.steps) ||
      quality.playtest.steps < 0 ||
      quality.playtest.steps > 12 ||
      (quality.playtest.status === 'missing'
        ? quality.playtest.steps !== 0
        : quality.playtest.steps === 0) ||
      !Array.isArray(quality.warnings) ||
      quality.warnings.length > 12 ||
      quality.warnings.some(
        (warning) => typeof warning !== 'string' || warning.length > 500,
      ) ||
      quality.reviewed !== undefined ||
      quality.production !== undefined ||
      !Array.isArray(quality.acceptance) ||
      quality.acceptance.length !== this.acceptance.length ||
      !this.acceptance.every((test, index) => {
        const result = quality.acceptance![index];
        return (
          result?.criterionId === test.criterionId &&
          result.variant === test.variant &&
          result.scenario === test.scenario &&
          ['passed', 'failed'].includes(result.status) &&
          result.steps === test.plan.steps.length &&
          result.screenshot === acceptanceScreenshots[index] &&
          (result.status === 'passed'
            ? result.error === undefined
            : typeof result.error === 'string' &&
              result.error.length > 0 &&
              result.error.length <= 600)
        );
      })
    )
      throw new RuntimeUnavailableError('独立环境返回了无效的画面检查结果。');
    const files: unknown = data.files;
    if (
      !Array.isArray(files) ||
      files.length > allowedArtifacts.size ||
      new Set(files).size !== files.length ||
      files.some(
        (file) => typeof file !== 'string' || !allowedArtifacts.has(file),
      ) ||
      ![
        'index.html',
        'game.js',
        'base.css',
        ...qualityScreenshots.map((shot) => shot.file),
        ...this.acceptance.map((_, i) => acceptanceScreenshots[i]),
      ].every((file) => files.includes(file)) ||
      files.some(
        (file) =>
          acceptanceScreenshots.includes(file) &&
          !this.acceptance.some((_, i) => acceptanceScreenshots[i] === file),
      )
    )
      throw new RuntimeUnavailableError('独立环境返回了无效的游戏产物。');
    await mkdir(output, { recursive: false });
    let bytes = 0;
    for (const file of files as string[]) {
      signal.throwIfAborted();
      const contents = await readArtifact(this.name, file, signal);
      bytes += contents.length;
      if (bytes > 64_000_000) throw new Error('游戏产物超过大小限制。');
      await writeFile(path.join(output, file), contents, {
        flag: 'wx',
        mode: 0o644,
      });
    }
    return {
      ...report,
      environment: {
        kind: 'docker',
        projectId: this.projectId,
        image: this.image,
      },
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.heartbeat);
    try {
      await run('docker', ['rm', '--force', this.name], dataRoot, {
        timeout: 10000,
      });
    } catch {
      // The daemon may be stopping or --rm may already have removed it.
      // Removing its lease makes the guardian terminate if it is still alive.
    } finally {
      await rm(this.input, { recursive: true, force: true });
    }
  }
}

export async function checkInProjectContainer(options: {
  projectId: string;
  jobId: string;
  workspace: string;
  output: string;
  image: string;
  signal: AbortSignal;
  owner?: 'worker' | 'verification';
  acceptance?: AcceptanceCase[];
}): Promise<ValidationReport> {
  const container = await ProjectContainer.start(options);
  try {
    return await container.check(options.output, options.signal);
  } finally {
    await container.dispose();
  }
}
