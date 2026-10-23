import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { artworkPreview } from '../src/server/image-project';
test('display previews are bounded WebP images while the source stays unchanged', async () => {
  const source = await sharp({
    create: {
      width: 1200,
      height: 2400,
      channels: 4,
      background: { r: 80, g: 90, b: 120, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const original = Buffer.from(source);
  const preview = await artworkPreview(source);
  const meta = await sharp(preview).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 480);
  assert.equal(meta.height, 960);
  assert.equal(meta.hasAlpha, true);
  assert.ok(preview.length < source.length);
  assert.deepEqual(source, original);
});
