import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
export async function artifactHash(dir: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(folder: string) {
    for (const file of (await readdir(folder, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const target = path.join(folder, file.name);
      if (file.isDirectory()) await visit(target);
      else {
        hash.update(path.relative(dir, target));
        hash.update(await readFile(target));
      }
    }
  }
  await visit(dir);
  return hash.digest('hex');
}
