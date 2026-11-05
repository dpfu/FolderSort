/** Opt-in real browser inference check (downloads ~88 MB plus the runtime).
 * Usage: node scripts/smoke-clip.mjs /path/to/cat-photo.jpg
 * CLIP_BROWSERS=webkit,chromium selects engines. UI suites mock inference;
 * this check deliberately exercises real quantized weights and browser workers.
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, webkit, firefox } from '@playwright/test';
const fixture = process.argv[2];
if (!fixture) throw new Error('Provide a cat-photo JPEG for the real-model ranking check.');
const image = (await fs.readFile(fixture)).toString('base64');
const server = await createServer({ server: { host: '127.0.0.1', port: 4451, strictPort: true } });
await server.listen();
try {
  for (const name of (process.env.CLIP_BROWSERS || 'webkit,chromium').split(',')) {
    console.log(`Starting real ${name} inference…`);
    const browser = await ({ chromium, webkit, firefox })[name].launch();
    try {
      const page = await browser.newPage();
      const weights = new Set();
      page.on('request', request => { const file = new URL(request.url()).pathname.split('/').pop(); if (file.endsWith('.onnx')) weights.add(file); });
      page.on('pageerror', error => console.error(error.message));
      await page.goto('http://127.0.0.1:4451/');
      const result = await page.evaluate(async image => {
        const { ClipClient } = await import('/src/clipClient.ts');
        const { FOLDER_LABELS } = await import('/src/folderLabels.ts');
        const client = new ClipClient(() => {});
        const started = performance.now();
        try {
          await client.initialize();
          const photo = new Blob([Uint8Array.from(atob(image), c => c.charCodeAt(0))], { type: 'image/jpeg' });
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
          const context = canvas.getContext('2d'); context.fillStyle = '#53a152'; context.fillRect(0, 0, 128, 128);
          const blank = await new Promise(resolve => canvas.toBlob(resolve));
          const cat = await client.analyze('cat', photo);
          await client.analyze('blank', blank);
          const matches = await client.search(['blank', 'cat'], 'cats', 2);
          const names = await client.labels(['cat'], FOLDER_LABELS, 3);
          const repeat = await client.search(['blank', 'cat'], 'cats', 2);
          return { matches, names, repeat, imageCacheKey: cat.model, seconds: Math.round((performance.now() - started) / 1000) };
        } finally { client.dispose(); }
      }, image);
      assert.equal(result.matches[0].id, 'cat');
      assert.equal(result.names[0].label, 'Cats');
      assert.deepEqual(result.repeat, result.matches);
      assert(weights.has('text_model_quantized.onnx'));
      assert(!weights.has('text_model.onnx'));
      assert.equal(await page.evaluate(() => sessionStorage.getItem('foldersort:clip-active')), null);
      console.log(JSON.stringify({ browser: name, ...result, requestedWeights: [...weights] }, null, 2));
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
