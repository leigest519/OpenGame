import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizeImageBuffer, parseImageSize } from './generate-assets.js';

async function fixture(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 20, g: 120, b: 220, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

describe('generated image normalization', () => {
  it('parses provider size notation', () => {
    expect(parseImageSize('1024*1024')).toEqual({ width: 1024, height: 1024 });
    expect(parseImageSize('1536x1024')).toEqual({ width: 1536, height: 1024 });
    expect(() => parseImageSize('bad')).toThrow('Invalid image size');
  });

  it('shrinks an ignored 1024 request to the required sprite canvas', async () => {
    const output = await normalizeImageBuffer(await fixture(1254, 1254), {
      width: 1024,
      height: 1024,
      fit: 'contain',
    });
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({
      width: 1024,
      height: 1024,
      format: 'png',
    });
  });

  it('keeps an already-correct PNG byte-identical', async () => {
    const input = await fixture(1024, 1024);
    const output = await normalizeImageBuffer(input, {
      width: 1024,
      height: 1024,
      fit: 'contain',
    });
    expect(output).toBe(input);
  });

  it('normalizes an opaque background to its requested canvas', async () => {
    const output = await normalizeImageBuffer(await fixture(1254, 1254), {
      width: 1536,
      height: 1024,
      fit: 'cover',
    });
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({
      width: 1536,
      height: 1024,
      format: 'png',
    });
  });
});
