import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// All runtime state is private, ignored by Git, and outside the public directory.
export const webRoot = path.resolve(
  process.env.OPENGAME_WEB_ROOT ||
    (existsSync(path.join(process.cwd(), 'src/server/schema.sql'))
      ? process.cwd()
      : path.join(process.cwd(), 'packages/web')),
);
export const dataRoot = path.resolve(
  process.env.OPENGAME_DATA_DIR || path.join(webRoot, '../../.opengame'),
);
export const appPort = Number(process.env.OPENGAME_PORT || 4190);
export const previewPort = Number(process.env.OPENGAME_PREVIEW_PORT || 4191);
export const accessMode = process.env.OPENGAME_ACCESS_MODE || 'local';
if (!['local', 'invite'].includes(accessMode))
  throw new Error('OPENGAME_ACCESS_MODE 必须是 local 或 invite。');
export const authProvider = process.env.OPENGAME_AUTH_PROVIDER || 'invite';
if (!['invite', 'privy'].includes(authProvider))
  throw new Error('OPENGAME_AUTH_PROVIDER 必须是 invite 或 privy。');
export const privyAppId = process.env.OPENGAME_PRIVY_APP_ID || '';
if (authProvider === 'privy' && !/^[a-zA-Z0-9_-]{10,100}$/.test(privyAppId))
  throw new Error('Privy 登录需要有效的 OPENGAME_PRIVY_APP_ID。');
if (authProvider === 'privy' && accessMode !== 'invite')
  throw new Error(
    'Privy 登录需要 OPENGAME_ACCESS_MODE=invite，以保护用户数据。',
  );
function origin(value: string): string {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !['http:', 'https:'].includes(url.protocol) ||
    (!loopback && (url.protocol !== 'https:' || accessMode !== 'invite'))
  )
    throw new Error(
      '公网地址必须使用 HTTPS 和 invite 访问模式，且不能包含路径。',
    );
  return url.origin;
}
export const appOrigin = origin(
  process.env.OPENGAME_APP_ORIGIN || `http://127.0.0.1:${appPort}`,
);
export const previewOrigin = origin(
  process.env.OPENGAME_PREVIEW_ORIGIN || `http://127.0.0.1:${previewPort}`,
);
if (appOrigin === previewOrigin)
  throw new Error('工作台与游戏必须使用不同的访问地址。');
const loopbackHosts = ['127.0.0.1', 'localhost', '[::1]'];
if (
  loopbackHosts.includes(new URL(appOrigin).hostname) !==
  loopbackHosts.includes(new URL(previewOrigin).hostname)
)
  throw new Error('工作台与游戏地址必须同时为本机地址或同时为公网地址。');
export function previewSecret(): string {
  const value = process.env.OPENGAME_PREVIEW_SECRET;
  if (!value || value.length < 32 || value.startsWith('CHANGE_ME'))
    throw new Error('内测环境需要至少 32 字符的随机 OPENGAME_PREVIEW_SECRET。');
  return value;
}
export const databasePort = Number(process.env.OPENGAME_DB_PORT || 55432);

export function localSettings(): { password: string } {
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
  const file = path.join(dataRoot, 'local-settings.json');
  if (!existsSync(file)) {
    try {
      writeFileSync(
        file,
        JSON.stringify({ password: randomBytes(24).toString('hex') }),
        { mode: 0o600, flag: 'wx' },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function databaseUrl(): string {
  return (
    process.env.OPENGAME_DATABASE_URL ||
    `postgresql://opengame:${localSettings().password}@127.0.0.1:${databasePort}/opengame`
  );
}

export function projectRepo(id: string): string {
  return path.join(dataRoot, 'projects', id, 'repo.git');
}

export function artifactDir(key: string): string {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid artifact key');
  return path.join(dataRoot, 'artifacts', key);
}
