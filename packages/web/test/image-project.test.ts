import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  normalizeArtwork,
  saveArtwork,
  readCodexArtwork,
} from '../src/server/image-project';
import { temporaryArtifactServer } from '../src/server/static-files';
import { chromium } from 'playwright';
import { browserOptions } from '../src/server/build-game';

test('artwork rejects malformed, SVG and oversized input', async () => {
  await assert.rejects(normalizeArtwork(Buffer.from('not an image')));
  await assert.rejects(
    normalizeArtwork(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
      ),
    ),
  );
  await assert.rejects(normalizeArtwork(Buffer.alloc(12_000_001)), /12 MB/);
});

test('image versions preserve dimensions and alpha and render without game controls', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio-image-'));
  const workspace = path.join(root, 'workspace');
  const output = path.join(root, 'artifact');
  await mkdir(workspace);
  await writeFile(path.join(workspace, 'memory.md'), '# memory');
  const source = await sharp({
    create: {
      width: 240,
      height: 400,
      channels: 4,
      background: { r: 120, g: 80, b: 220, alpha: 0.4 },
    },
  })
    .png()
    .toBuffer();
  try {
    const report = await saveArtwork(
      source,
      '<script>name.png',
      '紫色花树',
      workspace,
      output,
    );
    assert.deepEqual(report.image, { width: 240, height: 400, format: 'png' });
    assert.equal(report.start, false);
    assert.equal(report.browser, false);
    const original = await readFile(path.join(output, 'artwork.png'));
    assert.equal((await sharp(original).metadata()).hasAlpha, true);
    const server = await temporaryArtifactServer(output);
    const browser = await chromium.launch(browserOptions());
    try {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(server.url);
      assert.equal(
        await page
          .locator('img')
          .evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth === 240,
          ),
        true,
      );
      assert.equal(await page.locator('button').count(), 0);
      assert.equal(await page.locator('script').count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex output is scoped to structured thread ID and rejects symlinked files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-artwork-'));
  const id = '11111111-1111-4111-8111-111111111111';
  const directory = path.join(root, 'generated_images', id);
  try {
    await assert.rejects(readCodexArtwork('../../other', root), /任务标识/);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, 'outside.png'), 'not trusted');
    await symlink(
      path.join(root, 'outside.png'),
      path.join(directory, 'image.png'),
    );
    await assert.rejects(readCodexArtwork(id, root), /文件无效/);
    await rm(path.join(directory, 'image.png'));
    await writeFile(path.join(directory, 'image.png'), 'owned bytes');
    assert.equal(
      (await readCodexArtwork(id, root)).data.toString(),
      'owned bytes',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
