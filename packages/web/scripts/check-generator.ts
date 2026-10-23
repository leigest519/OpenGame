import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dataRoot } from '../src/server/config';
import { runCodex } from '../src/server/codex';
import { run } from '../src/server/process';

await mkdir(dataRoot, { recursive: true, mode: 0o700 });
const root = await mkdtemp(path.join(dataRoot, 'generator-check-'));
const work = path.join(root, 'workspace');
const outside = await mkdtemp(
  path.join(tmpdir(), 'opengame-generator-outside-'),
);
const server = createServer((_request, response) =>
  response.end('synthetic network fixture'),
);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('无法启动联网权限测试服务。');
  const endpoint = `http://127.0.0.1:${address.port}/`;
  if ((await (await fetch(endpoint)).text()) !== 'synthetic network fixture')
    throw new Error('联网测试基准不可用。');
  await mkdir(work);
  await writeFile(path.join(root, 'neighbor.txt'), 'Synthetic private fixture');
  const fixture = path.join(outside, 'fixture.txt');
  await writeFile(fixture, 'Synthetic temporary fixture');
  await run('git', ['init', '--quiet', work], dataRoot);
  const script = `set -eu
test -x /usr/bin/curl
printf 'write=ok\\n' > result.txt
if /bin/cat ../neighbor.txt >/dev/null 2>&1; then printf 'neighbor=ALLOWED\\n' >> result.txt; else printf 'neighbor=denied\\n' >> result.txt; fi
if /bin/cat ${quote(fixture)} >/dev/null 2>&1; then printf 'tmp=ALLOWED\\n' >> result.txt; else printf 'tmp=denied\\n' >> result.txt; fi
if /usr/bin/curl --silent --noproxy '*' --max-time 2 ${endpoint} >/dev/null 2>&1; then printf 'network=ALLOWED\\n' >> result.txt; else printf 'network=denied\\n' >> result.txt; fi`;
  await runCodex({
    cwd: work,
    prompt: `这是平台的权限验收，仅使用人工测试文件。请使用 shell 工具原样执行下面的脚本，不要尝试绕过被拒绝的读取或联网，不要读取其他文件。不要直接编写 result.txt，必须用脚本生成它。完成后只回复已完成。\n${script}`,
    signal: AbortSignal.timeout(120000),
    onMessage: () => {},
    onUsage: () => {},
  });
  const report = await readFile(path.join(work, 'result.txt'), 'utf8');
  if (report !== 'write=ok\nneighbor=denied\ntmp=denied\nnetwork=denied\n')
    throw new Error(`生成权限验收未通过：${report}`);
  console.log(
    '生成权限检查通过：项目可写、相邻项目不可读、共享临时文件不可读、命令不可联网。',
  );
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
}
