import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const root = await mkdtemp(path.join(tmpdir(), 'opengame-runtime-test-'));
process.env.OPENGAME_DATA_DIR = root;
const {
  ProjectContainer,
  requireRuntimeImage,
  checkInProjectContainer,
  recoverProjectContainers,
} = await import('../../src/server/project-runtime');
const { run } = await import('../../src/server/process');
const image = await requireRuntimeImage();
after(() => rm(root, { recursive: true, force: true }));

async function fixture(name: string, infinite = false) {
  const dir = path.join(root, name);
  await mkdir(path.join(dir, 'src'), { recursive: true });
  for (const file of [
    'game.project.json',
    'gameConfig.json',
    'modules.lock.json',
    'assets.manifest.json',
  ])
    await writeFile(path.join(dir, file), '{}');
  for (const file of ['design.md', 'memory.md'])
    await writeFile(path.join(dir, file), name);
  await mkdir(path.join(dir, '.git'));
  await writeFile(path.join(dir, '.git/config'), 'not a build input');
  await writeFile(
    path.join(dir, 'src/main.ts'),
    infinite
      ? 'while (true) {}'
      : `
    const root = document.getElementById('game-root')!;
    root.innerHTML = '<h1>${name}</h1><button id="start-game">开始</button><button id="restart-game">重开</button><canvas width="400" height="300"></canvas>';
    let count = 0;
    const paint = () => {
      const ctx = document.querySelector('canvas')!.getContext('2d')!;
      ctx.fillStyle = count++ % 2 ? '#765bfa' : '#28ac98'; ctx.fillRect(0,0,400,300);
    };
    document.getElementById('start-game')!.onclick = paint;
    document.getElementById('restart-game')!.onclick = paint;
  `,
  );
  return dir;
}

test(
  'two live projects isolate files, processes and ports; builds survive container disposal',
  { timeout: 120000 },
  async () => {
    const workspaces = await Promise.all([
      fixture('project-a'),
      fixture('project-b'),
    ]);
    const signal = new AbortController().signal;
    const containers: Awaited<ReturnType<typeof ProjectContainer.start>>[] = [];
    try {
      for (const workspace of workspaces)
        containers.push(
          await ProjectContainer.start({
            projectId: randomUUID(),
            jobId: randomUUID(),
            workspace,
            image,
            signal,
          }),
        );
      const [a, b] = containers;
      const inspected = JSON.parse(
        await run('docker', ['inspect', a.name], root),
      )[0];
      assert.equal(inspected.HostConfig.NetworkMode, 'none');
      assert.equal(inspected.Config.User, '1000:1000');
      assert.equal(inspected.HostConfig.ReadonlyRootfs, true);
      assert.equal(inspected.HostConfig.Memory, 1024 ** 3);
      assert.equal(inspected.Mounts.length, 1);
      assert.deepEqual(Object.keys(inspected.HostConfig.Tmpfs).sort(), [
        '/output',
        '/tmp',
      ]);
      assert.equal(
        inspected.Mounts.find(
          (m: { Destination: string }) => m.Destination === '/input',
        ).RW,
        false,
      );
      await a.exec([
        'node',
        '-e',
        `require('fs').writeFileSync('/tmp/only-a','private-a')`,
      ]);
      assert.equal(
        await b.exec([
          'node',
          '-e',
          `const fs=require('fs'); console.log(JSON.stringify({own:fs.readFileSync('/input/project/memory.md','utf8'), other:fs.existsSync('/tmp/only-a'), git:fs.existsSync('/input/project/.git'), docker:fs.existsSync('/var/run/docker.sock'), home:fs.existsSync('/Users'), interfaces:Object.keys(require('os').networkInterfaces()), uid:process.getuid()}))`,
        ]),
        JSON.stringify({
          own: 'project-b',
          other: false,
          git: false,
          docker: false,
          home: false,
          interfaces: ['lo'],
          uid: 1000,
        }),
      );
      assert.equal(
        await a.exec([
          'node',
          '-e',
          `try { require('fs').writeFileSync('/input/project/memory.md','bad'); process.exit(1); } catch(e) { console.log(e.code); }`,
        ]),
        'EROFS',
      );
      const samePort = `const h=require('http'); const s=h.createServer((q,r)=>r.end('private port')); s.listen(45678,'127.0.0.1',()=>h.get('http://127.0.0.1:45678',r=>{let t='';r.on('data',c=>t+=c);r.on('end',()=>{console.log(t);s.close()})}));`;
      assert.deepEqual(
        await Promise.all(
          containers.map((c) => c.exec(['node', '-e', samePort])),
        ),
        ['private port', 'private port'],
      );
      const outputs = containers.map((_, i) => path.join(root, `output-${i}`));
      const reports = await Promise.all(
        containers.map((c, i) => c.check(outputs[i], signal)),
      );
      assert.ok(
        reports.every(
          (r) => r.start && r.restart && r.environment?.kind === 'docker',
        ),
      );
      assert.notEqual(
        await readFile(path.join(outputs[0], 'game.js'), 'utf8'),
        await readFile(path.join(outputs[1], 'game.js'), 'utf8'),
      );
      await a.dispose();
      assert.equal(
        await b.exec(['node', '-e', `console.log('still alive')`]),
        'still alive',
      );
      await access(path.join(outputs[0], 'preview.png'));
      const workerContainer = await ProjectContainer.start({
        projectId: randomUUID(),
        jobId: randomUUID(),
        workspace: workspaces[0],
        image,
        signal,
        owner: 'worker',
      });
      containers.push(workerContainer);
      await recoverProjectContainers();
      assert.equal(
        await run(
          'docker',
          ['ps', '-aq', '--filter', `name=^/${workerContainer.name}$`],
          root,
        ),
        '',
      );
      assert.equal(
        await b.exec(['node', '-e', `console.log('verification preserved')`]),
        'verification preserved',
      );
      assert.equal(
        await readFile(path.join(workspaces[0], 'memory.md'), 'utf8'),
        'project-a',
      );
    } finally {
      await Promise.all(containers.map((c) => c.dispose()));
    }
  },
);

test(
  'cancellation stops an unresponsive game and removes its container',
  { timeout: 30000 },
  async () => {
    const workspace = await fixture('unresponsive', true);
    const controller = new AbortController();
    const projectId = randomUUID();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      await assert.rejects(
        checkInProjectContainer({
          projectId,
          jobId: randomUUID(),
          workspace,
          image,
          output: path.join(root, 'cancelled-output'),
          signal: controller.signal,
        }),
      );
      assert.equal(
        await run(
          'docker',
          ['ps', '-aq', '--filter', `label=io.opengame.project=${projectId}`],
          root,
        ),
        '',
      );
      await access(path.join(workspace, 'memory.md'));
    } finally {
      clearTimeout(timer);
    }
  },
);

test(
  'an owner crash expires its lease and removes the abandoned container',
  { timeout: 45000 },
  async () => {
    const workspace = await fixture('orphaned');
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        path.resolve('test/runtime/abandoned-owner.ts'),
        workspace,
      ],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let name = '';
    try {
      name = await new Promise<string>((resolve, reject) => {
        let text = '';
        child.stdout.on('data', (data) => {
          text += data;
          if (text.includes('\n'))
            resolve(JSON.parse(text.split('\n')[0]).name);
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (!text) reject(new Error(`Owner exited ${code}`));
        });
      });
      child.kill('SIGKILL');
      const end = Date.now() + 35000;
      let exists = true;
      while (exists && Date.now() < end) {
        await pause(1000);
        exists = !!(await run(
          'docker',
          ['ps', '-aq', '--filter', `name=^/${name}$`],
          root,
        ));
      }
      assert.equal(
        exists,
        false,
        'guardian must remove the container within 35 seconds of losing its owner',
      );
      await access(path.join(workspace, 'memory.md'));
    } finally {
      child.kill('SIGKILL');
      if (name) await run('docker', ['rm', '-f', name], root).catch(() => {});
    }
  },
);
