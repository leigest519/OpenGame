import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { appOrigin } from './config';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
export async function serveArtifact(
  dir: string,
  file: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.writeHead(405).end();
    return;
  }
  try {
    const root = await realpath(dir);
    const target = await realpath(path.resolve(root, file || 'index.html'));
    if (
      !target.startsWith(`${root}${path.sep}`) ||
      !(await stat(target)).isFile() ||
      !types[path.extname(target)]
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(target)],
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'none'; frame-ancestors ${appOrigin}; sandbox allow-scripts`,
    });
    res.end(req.method === 'HEAD' ? undefined : await readFile(target));
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }
}
export async function temporaryArtifactServer(dir: string) {
  const server = createServer((req, res) => {
    const file = new URL(req.url || '/', 'http://localhost').pathname.slice(1);
    void serveArtifact(dir, file, req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Preview failed to start');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
