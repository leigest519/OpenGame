import { createServer } from 'node:http';
import {
  artifactDir,
  previewPort,
  previewOrigin,
  accessMode,
  previewSecret,
} from './config';
import { migrate, pool } from './db';
import { serveArtifact } from './static-files';
import { authorizedArtifact } from './access';

await migrate();
if (accessMode === 'invite') previewSecret();
const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.headers.host !== new URL(previewOrigin).host) {
      res.writeHead(403).end();
      return;
    }
    const match = url.pathname.match(
      accessMode === 'invite'
        ? /^\/v\/([a-f0-9-]{36})\/([^/]+)\/(.*)$/
        : /^\/v\/([a-f0-9-]{36})\/(.*)$/,
    );
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    const artifact = await authorizedArtifact(
      match[1],
      accessMode === 'invite' ? match[2] : undefined,
    );
    if (!artifact) {
      res.writeHead(404).end();
      return;
    }
    await serveArtifact(
      artifactDir(artifact),
      decodeURIComponent(match[accessMode === 'invite' ? 3 : 2]),
      req,
      res,
    );
  })().catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
server.listen(previewPort, '127.0.0.1', () =>
  console.log(`游戏预览：http://127.0.0.1:${previewPort}`),
);
const stop = () => {
  server.closeAllConnections();
  server.close(() => {
    void pool()
      .end()
      .then(() => process.exit(0));
  });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
