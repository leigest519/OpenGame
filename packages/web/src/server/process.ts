import { spawn } from 'node:child_process';

export function run(
  command: string,
  args: string[],
  cwd: string,
  options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        NODE_ENV: 'production',
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        LANG: 'en_US.UTF-8',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
      timeout: options.timeout ?? 30000,
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-16000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(`${command} exited ${code}: ${output.slice(-3000)}`),
          ),
    );
  });
}
