import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('gallery navigation keeps images, thumbnails and downloads in sync across enlarged and swipe views', async () => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ImageVersionGallery} from './src/components/image-version-gallery';createRoot(document.getElementById('root')).render(<ImageVersionGallery projectId="project" title="景色" version={{id:'version',number:11,validation:{images:[0,1,2].map(i=>({file:'artwork-'+i+'.png',label:'景色'+i,batchIndex:i,width:100,height:200,format:'png'}))}}}/>);`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outfile: 'gallery.js',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const js = bundle.outputFiles.find((f) => f.path.endsWith('.js'))!.text,
    css = bundle.outputFiles.find((f) => f.path.endsWith('.css'))!.text;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1100, height: 850 },
    });
    await page.route('**/*', (route) =>
      route.fulfill(
        route.request().url().includes('/api/')
          ? {
              contentType: 'image/svg+xml',
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="200"><rect width="100" height="200" fill="green"/></svg>',
            }
          : {
              contentType: 'text/html',
              body: `<style>${css}</style><div id="root" style="height:650px;display:flex"></div><script>${js}</script>`,
            },
      ),
    );
    await page.goto('https://gallery.test/');
    const gallery = page.getByRole('region', {
      name: '版本 11 图片组',
      exact: true,
    });
    const check = async (item: number, scope = gallery) => {
      await scope
        .getByRole('button', {
          name: `查看第 ${item + 1} 张：景色${item}`,
          exact: true,
        })
        .waitFor();
      assert.equal(
        await scope
          .getByRole('button', {
            name: `查看第 ${item + 1} 张：景色${item}`,
            exact: true,
          })
          .getAttribute('aria-pressed'),
        'true',
      );
      assert.match(
        (await scope
          .getByRole('link', { name: '下载当前图片' })
          .getAttribute('href'))!,
        new RegExp('item=' + item + '$'),
      );
      assert.match(
        (await scope
          .getByRole('img', { name: '景色' + item, exact: true })
          .getAttribute('src'))!,
        new RegExp('item=' + item + '$'),
      );
    };
    await check(0);
    await gallery.getByRole('button', { name: '下一张图片' }).click();
    await check(1);
    await gallery.press('ArrowRight');
    await check(2);
    await gallery.press('ArrowRight');
    await check(0);
    await gallery.getByRole('button', { name: '上一张图片' }).click();
    await check(2);
    await gallery
      .getByRole('button', { name: '查看第 2 张：景色1', exact: true })
      .click();
    await check(1);
    await gallery.getByRole('button', { name: '放大当前图片' }).click();
    const large = page.getByRole('region', {
      name: '放大图片浏览',
      exact: true,
    });
    await large.getByRole('button', { name: '下一张图片' }).click();
    await check(2, large);
    await large.press('ArrowLeft');
    await check(1, large);
    await large.press('Escape');
    await check(1);
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await page.setViewportSize({ width: 390, height: 800 });
    const img = gallery.getByRole('img', { name: '景色1', exact: true });
    await img.evaluate((el) => {
      const first = new Touch({
        identifier: 0,
        target: el,
        clientX: 250,
        clientY: 100,
      });
      el.dispatchEvent(
        new TouchEvent('touchstart', { bubbles: true, touches: [first] }),
      );
      const last = new Touch({
        identifier: 0,
        target: el,
        clientX: 70,
        clientY: 105,
      });
      el.dispatchEvent(
        new TouchEvent('touchend', { bubbles: true, changedTouches: [last] }),
      );
    });
    await check(2);
  } finally {
    await browser.close();
  }
});
