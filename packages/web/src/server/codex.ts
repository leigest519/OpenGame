import { generationTimeout } from './model-runtime';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { webRoot } from './config';
import {
  generatorArguments,
  prepareGeneratorWorkspace,
} from './generator-policy';

export async function runCodex(options: {
  cwd: string;
  model?: import('../shared/models').GenerationModel;
  prompt: string;
  images?: string[];
  readOnly?: boolean;
  maxReplyChars?: number;
  signal: AbortSignal;
  onThreadStarted?: (id: string) => void;
  onMessage: (message: string) => void;
  onUsage: (usage: unknown) => void;
}): Promise<string> {
  options.signal.throwIfAborted();
  await prepareGeneratorWorkspace(options.cwd);
  options.signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    for (const key of [
      'PATH',
      'HOME',
      'TMPDIR',
      'LANG',
      'SSL_CERT_FILE',
      'SSL_CERT_DIR',
    ]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const child = spawn(
      process.execPath,
      [path.join(webRoot, 'scripts/codex-supervisor.mjs')],
      { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    const args = generatorArguments(
      options.cwd,
      options.readOnly,
      options.model,
    );
    if (options.images?.length)
      args.splice(
        args.length - 1,
        0,
        ...options.images.flatMap((file) => ['--image', file]),
      );
    let pending = '';
    let summary = '';
    let failed = '';
    let stderr = '';
    const cancel = () => {
      if (child.connected) child.send({ type: 'cancel' });
    };
    options.signal.addEventListener('abort', cancel, { once: true });
    child.stdout!.on('data', (chunk: Buffer) => {
      pending += chunk.toString();
      if (pending.length > 2_000_000) {
        failed = '生成器返回的内容过大。';
        cancel();
        return;
      }
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (
            event.type === 'thread.started' &&
            typeof event.thread_id === 'string' &&
            /^[0-9a-f-]{36}$/i.test(event.thread_id)
          )
            options.onThreadStarted?.(event.thread_id);
          if (
            event.type === 'item.completed' &&
            event.item?.type === 'agent_message'
          ) {
            summary = String(event.item.text).slice(
              0,
              options.maxReplyChars || 4000,
            );
            options.onMessage(summary);
          }
          if (event.type === 'turn.completed') options.onUsage(event.usage);
          if (event.type === 'turn.failed')
            failed = String(
              event.error?.message || '生成中断，请检查本机生成服务。',
            ).slice(0, 600);
        } catch {
          /* Non-JSON diagnostics are not task events. */
        }
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      options.signal.removeEventListener('abort', cancel);
      if (options.signal.aborted)
        reject(new Error('任务已停止，上一可玩版本保持不变。'));
      else if (code !== 0 || failed)
        reject(
          new Error(
            failed ||
              (/not found|ENOENT/i.test(stderr)
                ? '未找到本机 Codex，请完成安装后重试。'
                : '生成未完成，请检查本机 Codex 登录、额度和连接后重试。'),
          ),
        );
      else resolve(summary || '游戏已更新。');
    });
    child.send({
      type: 'start',
      binary: process.env.OPENGAME_CODEX_BIN || 'codex',
      args,
      cwd: options.cwd,
      prompt: options.prompt,
      timeout: generationTimeout(options.model),
    });
  });
}
