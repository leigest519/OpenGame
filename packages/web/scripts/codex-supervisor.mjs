import { spawn } from 'node:child_process';

// An IPC disconnect also happens when the worker crashes: stop its Codex process group.
let child;
let stopping = false;
function stop() {
  stopping = true;
  if (!child?.pid) return process.exit(1);
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* Already stopped. */
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* Already stopped. */
    }
  }, 2500).unref();
}
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('message', (message) => {
  if (message.type === 'cancel') return stop();
  if (child || stopping) return;
  child = spawn(message.binary, message.args, {
    cwd: message.cwd,
    env: process.env,
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const deadline = setTimeout(stop, message.timeout);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on('error', () => {
    clearTimeout(deadline);
    process.exit(1);
  });
  child.on('close', (code) => {
    clearTimeout(deadline);
    process.exit(stopping ? 1 : (code ?? 1));
  });
  child.stdin.on('error', () => {});
  child.stdin.end(message.prompt);
});
