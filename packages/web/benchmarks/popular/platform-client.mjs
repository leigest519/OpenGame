// Uses the real production HTTP API. Credentials stay in memory; only redacted
// results and idempotency keys are written. No browser automation is used here.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const stateDir = path.join(root, '.opengame/benchmarks/popular-20261015');
const origin = 'https://studio.xiajuan.app';
const [command, name, baseCase] = process.argv.slice(2);
if (
  !['status', 'submit', 'revise', 'publish', 'memory'].includes(command) ||
  !/^[a-z-]+$/.test(name || '')
)
  throw new Error('Usage: client <status|submit|revise|publish|memory> <case>');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const stateFile = path.join(stateDir, `${name}.json`);
let state;
try {
  state = JSON.parse(await readFile(stateFile, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
let cookie;
async function api(route, body) {
  const response = await fetch(`${origin}/api/${route}`, {
    method: body ? 'POST' : 'GET',
    redirect: 'error',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `HTTP ${response.status}: ${result.error || 'Request failed'}`,
    );
  if (route === 'session')
    cookie = response.headers.get('set-cookie')?.split(';')[0];
  return result;
}
const accessFile = await readFile(
  path.join(root, '.opengame/deployment/studio-owner-access.txt'),
  'utf8',
);
const code = accessFile.match(/og_[A-Za-z0-9_-]{43}/)?.[0];
if (!code) throw new Error('Owner invitation missing');
await api('session', { code });
const save = () =>
  writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
try {
  if (command === 'submit' || command === 'revise') {
    const prompt = await readFile(
      new URL(`./briefs/${name}.md`, import.meta.url),
      'utf8',
    );
    const hash = createHash('sha256').update(prompt).digest('hex');
    if (!state) {
      state = {
        name,
        requestKey: randomUUID(),
        promptHash: hash,
        startedAt: new Date().toISOString(),
      };
      if (command === 'revise') {
        if (!/^[a-z-]+$/.test(baseCase || ''))
          throw new Error('Revision requires a base case name');
        const base = JSON.parse(
          await readFile(path.join(stateDir, `${baseCase}.json`), 'utf8'),
        );
        const current = await api(`projects/${base.projectId}`);
        state.projectId = base.projectId;
        state.baseVersionId = current.project.latest_version_id;
      }
      await save();
    }
    if (state.promptHash !== hash)
      throw new Error('Prompt changed: use a new case name');
    const route =
      command === 'revise' ? `projects/${state.projectId}/jobs` : 'projects';
    if (
      command === 'revise' &&
      (!state.projectId || !Object.hasOwn(state, 'baseVersionId'))
    )
      throw new Error(
        'Revision requires an explicit project and base version (null for a failed first build)',
      );
    const result = await api(route, {
      prompt,
      requestKey: state.requestKey,
      ...(state.baseVersionId ? { baseVersionId: state.baseVersionId } : {}),
    });
    state = { ...state, ...result };
    await save();
    console.log(JSON.stringify(result));
  } else {
    if (!state?.projectId)
      throw new Error('No submitted project for this case');
    const detail = await api(`projects/${state.projectId}`);
    const job = detail.jobs.find((j) => j.id === state.jobId);
    state = {
      ...state,
      title: detail.project.title,
      latestVersionId: detail.project.latest_version_id,
      releasedVersionId: detail.project.released_version_id,
      job: job
        ? {
            status: job.status,
            phase: job.phase,
            error: job.error,
            createdAt: job.created_at,
            finishedAt: job.finished_at,
          }
        : null,
      versions: detail.versions.map((v) => ({
        id: v.id,
        number: v.number,
        commit: v.commit_sha,
        validation: v.validation,
      })),
    };
    if (command === 'publish') {
      if (job?.status !== 'succeeded')
        throw new Error('Benchmark job has not succeeded');
      const result = await api(`projects/${state.projectId}/publish`, {
        versionId: state.latestVersionId,
        expectedVersionId: state.releasedVersionId,
      });
      state.playUrl = result.url;
      state.releasedVersionId = state.latestVersionId;
    }
    if (command === 'memory') {
      const result = await api(`projects/${state.projectId}/memory`);
      await writeFile(path.join(stateDir, `${name}-memory.md`), result.memory, {
        mode: 0o600,
      });
      state.memorySaved = true;
    }
    await save();
    console.log(JSON.stringify(state, null, 2));
  }
} finally {
  if (cookie) await api('logout', {}).catch(() => {});
  cookie = undefined;
}
