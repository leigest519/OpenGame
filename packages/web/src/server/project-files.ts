import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Git and trusted context are managed by the platform, not game build inputs.
export const excludedProjectDirectories = new Set([
  '.git',
  '.opengame-context',
]);

export async function projectFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let bytes = 0;
  async function visit(folder: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (excludedProjectDirectories.has(entry.name)) continue;
      const file = path.join(folder, entry.name);
      const info = await lstat(file);
      if (info.isDirectory()) await visit(file);
      else {
        if (!info.isFile())
          throw new Error('项目中包含不支持的链接或特殊文件。');
        bytes += info.size;
        files.push(path.relative(dir, file));
        if (files.length > 200 || bytes > 15_000_000)
          throw new Error('首版项目超过文件或素材大小限制。');
      }
    }
  }
  await visit(dir);
  return files;
}

export async function assertProjectFiles(dir: string): Promise<void> {
  await projectFiles(dir);
  for (const name of [
    'game.project.json',
    'gameConfig.json',
    'modules.lock.json',
    'assets.manifest.json',
  ])
    JSON.parse(await readFile(path.join(dir, name), 'utf8'));
  for (const name of ['design.md', 'memory.md', 'src/main.ts']) {
    if (!(await readFile(path.join(dir, name), 'utf8')).trim())
      throw new Error(`缺少项目文件 ${name}`);
  }
}
