/** Balanced production workflow benchmark. Generated files only; no inference/model download. */
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(
  process.env.PERF_PACKAGE_JSON || new URL('../package.json', import.meta.url),
);
const { chromium, expect } = require('@playwright/test');
const JSZip = require('jszip');
const output = process.env.PERF_OUTPUT
  ? pathToFileURL(resolve(process.env.PERF_OUTPUT) + sep)
  : new URL('../output/workflow-performance/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const repetitions = Number(process.env.PERF_REPEATS || 6);
const warmups = Number(process.env.PERF_WARMUPS || 1);
const count = Number(process.env.PERF_IMAGES || 3000);
const importedCount = Number(process.env.PERF_IMPORT_IMAGES || 300);
const targets = {
  original: process.env.PERF_ORIGINAL || 'http://127.0.0.1:4610/',
  prior: process.env.PERF_PRIOR || 'http://127.0.0.1:4611/',
  final: process.env.PERF_FINAL || 'http://127.0.0.1:4612/',
};
const cachedOnly = process.env.PERF_CACHED_ONLY === '1';
let savedClip = [];
if (cachedOnly) {
  const ts = require('typescript');
  const source = await fs.readFile(new URL('../src/contentSimilarity.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const module = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  savedClip = Array.from({ length: count }, (_, i) =>
    module.packVector(
      module.normalizeVector(
        Float32Array.from({ length: 512 }, (_, j) => Math.sin(i * 0.7 + j * 0.3)),
      ),
    ),
  );
}
const browser = await chromium.launch();
const results = {
  date: new Date().toISOString(),
  chromium: browser.version(),
  repetitions,
  warmups,
  count,
  importedCount,
  targets,
  viewport: { width: 1440, height: 1000 },
  clip: false,
  savedClip: cachedOnly,
  samples: [],
};
const frames = (page, n = 2) =>
  page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
  }, n);
const idle = (page) =>
  expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved', { timeout: 45000 });
const board = (page) => page.getByTestId('board-root');
async function createContext() {
  const context = await browser.newContext({ viewport: results.viewport, acceptDownloads: true });
  await context.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, (route) => route.abort());
  return context;
}
async function fixtureImages() {
  const context = await createContext(),
    page = await context.newPage();
  try {
    return await page.evaluate(async () => {
      const canvas = document.createElement('canvas'),
        out = [];
      for (let kind = 0; kind < 12; kind++) {
        canvas.width = 1024;
        canvas.height = 768;
        const ctx = canvas.getContext('2d'),
          image = ctx.createImageData(canvas.width, canvas.height);
        let random = 17 + kind;
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++) {
            random = (Math.imul(1664525, random) + 1013904223) | 0;
            const i = (y * canvas.width + x) * 4,
              noise = (random >>> 24) * 0.25;
            image.data[i] = (x / 6 + kind * 13 + noise) % 255;
            image.data[i + 1] = (y / 4 + kind * 19 + noise) % 255;
            image.data[i + 2] = 80 + noise;
            image.data[i + 3] = 255;
          }
        ctx.putImageData(image, 0, 0);
        ctx.fillStyle = '#fff';
        ctx.font = '50px sans-serif';
        ctx.fillText('FolderSort ' + kind, 80, 160);
        out.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      }
      return out;
    });
  } finally {
    await context.close();
  }
}
const originals = (await fixtureImages()).map((base64) => Buffer.from(base64, 'base64'));
const importDirectory = await fs.mkdtemp(join(tmpdir(), 'foldersort-perf-import-'));
const importFiles = [];
for (let i = 0; i < importedCount; i++) {
  const path = join(importDirectory, 'import-' + String(i).padStart(4, '0') + '.jpg');
  await fs.writeFile(path, originals[i % originals.length]);
  importFiles.push(path);
}
results.importOriginalBytes = Array.from(
  { length: importedCount },
  (_, i) => originals[i % originals.length].length,
).reduce((a, b) => a + b, 0);
async function seed(page, empty = false) {
  await page.evaluate(
    async ({ count, empty, savedClip }) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('sortboard-image-library-minimal', 2);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#aac393';
      ctx.fillRect(0, 0, 160, 100);
      ctx.fillStyle = '#365847';
      ctx.fillRect(30, 20, 50, 40);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const tx = db.transaction(
        ['projects', 'meta', 'categories', 'images', 'assets'],
        'readwrite',
      );
      tx.objectStore('projects').put(
        {
          id: 'perf',
          name: 'Performance fixture',
          createdAt: 1,
          updatedAt: 1,
          settings: { clipEnabled: false },
        },
        'perf',
      );
      tx.objectStore('meta').put('perf', 'activeProjectId');
      tx.objectStore('meta').put('1', 'folder-boards:v1:perf');
      if (!empty) {
        for (let i = 0; i < 100; i++)
          tx.objectStore('categories').put(
            {
              id: 'stash-' + i,
              projectId: 'perf',
              name: 'Folder ' + i,
              createdAt: 1,
              layoutInitialized: true,
            },
            'stash-' + i,
          );
        for (let i = 0; i < count; i++) {
          const id = 'image-' + String(i).padStart(4, '0'),
            assigned = i >= count / 2,
            staged = !assigned && i < 300;
          const folderIndex = Math.floor((i - count / 2) / 100);
          tx.objectStore('images').put(
            {
              id,
              projectId: 'perf',
              path: id + '.png',
              mime: 'image/png',
              size: blob.size,
              addedAt: i,
              fileModifiedAt: 1,
              categoryId: assigned ? 'stash-' + (i % 100) : null,
              ...(savedClip[i] ? { clip: savedClip[i] } : {}),
              rootOnBoard: assigned ? undefined : staged,
              stashOrder: i,
              placement: 'board',
              boardScope: assigned ? 'stash-' + (i % 100) : null,
              ...(staged
                ? { boardX: 32 + (i % 7) * 200, boardY: 120 + Math.floor(i / 7) * 200 }
                : assigned
                  ? {
                      boardX: 110 + (folderIndex % 7) * 200,
                      boardY: 130 + Math.floor(folderIndex / 7) * 200,
                    }
                  : {}),
            },
            id,
          );
          tx.objectStore('assets').put(blob, id);
          tx.objectStore('assets').put(blob, 'thumbnail:v1:' + id);
        }
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      const anchors = Object.fromEntries(
        Array.from({ length: 100 }, (_, i) => [
          'stash-' + i,
          { x: 1900 + (i % 10) * 220, y: 100 + Math.floor(i / 10) * 220 },
        ]),
      );
      localStorage.setItem(
        'folder-sort-board:perf',
        JSON.stringify({ mode: 'free', anchors, expanded: [], autoNext: false }),
      );
      localStorage.setItem('folder-sort-board-appearance:perf', '2');
      localStorage.setItem(
        'folder-sort-stash-view:perf',
        JSON.stringify({ active: null, cameras: { root: { x: 600, y: 500, zoom: 0.85 } } }),
      );
      localStorage.setItem(
        'folder-sort-browser:perf',
        JSON.stringify({
          version: 2,
          width: 440,
          size: 120,
          collapsed: false,
          filter: 'all',
          stash: 'all',
          inFolder: false,
          query: '',
          focus: 0,
          scrollTop: 0,
        }),
      );
      localStorage.setItem(
        'folder-sort-browser-order:perf',
        JSON.stringify({ order: 'name', reversed: false, ids: [] }),
      );
    },
    { count, empty, savedClip },
  );
}
async function readImages(page, ids) {
  return page.evaluate(async (ids) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('sortboard-image-library-minimal', 2);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction('images'),
      store = tx.objectStore('images');
    const rows = await Promise.all(
      ids.map(
        (id) =>
          new Promise((resolve, reject) => {
            const r = store.get(id);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          }),
      ),
    );
    db.close();
    return rows.map(
      (image) =>
        image && {
          id: image.id,
          categoryId: image.categoryId,
          rootOnBoard: image.rootOnBoard,
          boardX: image.boardX,
          boardY: image.boardY,
        },
    );
  }, ids);
}
async function instrument(context, page, sample) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]),
    );
  async function measure(name, action) {
    const before = await metrics(),
      start = performance.now();
    const data = await action();
    const elapsed = performance.now() - start;
    const after = await metrics();
    const result = {
      wallMs: elapsed,
      mainThreadMs: (after.TaskDuration - before.TaskDuration) * 1000,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      layouts: after.LayoutCount - before.LayoutCount,
      styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
    };
    if (data?.frameMs) result.frameMs = data.frameMs;
    sample.metrics[name] = result;
  }
  async function memory(name) {
    await cdp.send('HeapProfiler.collectGarbage');
    await frames(page);
    await cdp.send('HeapProfiler.collectGarbage');
    const result = await metrics(),
      dom = await cdp.send('Memory.getDOMCounters');
    sample.memory[name] = { jsHeapBytes: result.JSHeapUsedSize, ...dom };
  }
  return { measure, memory };
}
async function frameLoop(page, kind, iterations) {
  return page.evaluate(
    async ({ kind, iterations }) => {
      const gaps = [];
      let previous;
      const area =
        kind === 'browser'
          ? document.querySelector('.image-browser__scroll')
          : document.querySelector('[data-testid="board-root"]');
      const start = area?.scrollTop || 0;
      for (let i = 0; i < iterations; i++) {
        if (kind === 'selection') {
          const card = document.querySelector('[data-testid="card-image-000' + (i % 2) + '"]');
          if (!card) throw new Error('Missing selection target');
          card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
        } else area.scrollTop = kind === 'browser' ? i * 120 : start + i * 20;
        const time = await new Promise(requestAnimationFrame);
        if (previous !== undefined) gaps.push(time - previous);
        previous = time;
      }
      return { frameMs: gaps };
    },
    { kind, iterations },
  );
}
async function runUI(branch, pair, warmup) {
  const context = await createContext(),
    page = await context.newPage();
  page.setDefaultTimeout(45000);
  const sample = { branch, pair, warmup, metrics: {}, memory: {}, errors: [] };
  page.on('pageerror', (error) => sample.errors.push(String(error)));
  const { measure, memory } = await instrument(context, page, sample);
  const photo = (id) => page.getByTestId('card-' + id);
  try {
    await measure('emptyStartup', async () => {
      await page.goto(targets[branch]);
      await expect(
        page.getByRole('heading', { name: 'Drop an image folder here', exact: true }),
      ).toBeVisible();
      await frames(page);
    });
    await seed(page);
    await measure('restoreProject', async () => {
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Performance fixture', exact: true }),
      ).toBeVisible();
      if (cachedOnly)
        await expect(
          page.getByRole('region', { name: 'CLIP indexing' }).getByRole('status'),
        ).toHaveText('Off · ' + count.toLocaleString('en-US') + ' saved');
      await frames(page);
    });
    await memory('project');
    await measure('openBoard', async () => {
      await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
      await expect(photo('image-0000')).toBeVisible();
      await page.waitForFunction(() => {
        const images = [
          ...document.querySelectorAll('.sorting-workspace__board img, .image-browser img'),
        ];
        return (
          images.length > 10 && images.every((image) => image.complete && image.naturalWidth > 0)
        );
      });
      await frames(page);
    });
    await memory('board');
    const origin = await board(page).evaluate((element) => ({
      left: element.scrollLeft,
      top: element.scrollTop,
    }));
    await measure('select60', () => frameLoop(page, 'selection', 60));
    await measure('browserScroll90', () => frameLoop(page, 'browser', 90));
    await measure('boardPan90', () => frameLoop(page, 'board', 90));
    if (cachedOnly) {
      await memory('interactions');
      sample.boardNodes = await board(page).locator('.card').count();
      if (sample.errors.length) throw new Error(sample.errors.join('\n'));
      return sample;
    }
    await board(page).evaluate(
      (element, origin) => element.scrollTo(origin.left, origin.top),
      origin,
    );
    await frames(page, 4);
    await photo('image-0000').click();
    await photo('image-0001').click({ modifiers: ['Shift'] });
    const beforeMove = await readImages(page, ['image-0000', 'image-0001']);
    await measure('moveTwoImages', async () => {
      const box = await photo('image-0000').boundingBox(),
        x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(x + (36 * i) / 12, y + (80 * i) / 12);
        await frames(page, 1);
      }
      await page.mouse.up();
      await idle(page);
      await frames(page);
    });
    const afterMove = await readImages(page, ['image-0000', 'image-0001']);
    if (
      afterMove.some(
        (image, i) =>
          image.boardX === beforeMove[i].boardX && image.boardY === beforeMove[i].boardY,
      )
    )
      throw new Error('Group movement did not commit both images');
    await measure('createFolder', async () => {
      await page
        .getByRole('group', { name: 'Image actions', exact: true })
        .getByRole('button', { name: /^Create folder(?: with [\d,]+ images?)?$/ })
        .click();
      await idle(page);
      await expect(
        page.getByRole('button', { name: 'Open folder Untitled folder', exact: true }),
      ).toBeVisible();
      await frames(page, 3);
    });
    await measure('enterFolder', async () => {
      await page.getByRole('button', { name: 'Open folder Untitled folder', exact: true }).click();
      await expect(page.locator('[data-current-location]')).toHaveText('Untitled folder');
      await expect(
        page.getByRole('region', { name: 'Sorting board area', exact: true }),
      ).not.toHaveAttribute('data-stash-navigation');
      await frames(page);
    });
    const dismiss = page.getByRole('button', { name: 'Keep folder untitled', exact: true });
    if (await dismiss.isVisible()) await dismiss.click();
    await measure('returnToStaging', async () => {
      await page.getByRole('button', { name: 'Back to Staging', exact: true }).click();
      await expect(page.locator('[data-current-location]')).toHaveText('Staging');
      await expect(
        page.getByRole('region', { name: 'Sorting board area', exact: true }),
      ).not.toHaveAttribute('data-stash-navigation');
      await frames(page);
    });
    await measure('previewRandom3', async () => {
      await page.getByRole('button', { name: /^Preview 3 random images$/ }).click();
      await expect(page.locator('[data-suggestion-preview]')).toHaveCount(3);
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('[data-suggestion-preview] img')].length === 3 &&
          [...document.querySelectorAll('[data-suggestion-preview] img')].every(
            (image) => image.complete && image.naturalWidth > 0,
          ),
      );
      await frames(page);
    });
    const previews = await page
      .locator('[data-suggestion-preview]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.dataset.suggestionPreview,
          x: parseFloat(node.style.left),
          y: parseFloat(node.style.top),
        })),
      );
    await measure('acceptRandom3', async () => {
      await page
        .getByRole('region', { name: 'Random image previews', exact: true })
        .getByRole('button', { name: 'Add 3', exact: true })
        .click();
      await idle(page);
      await expect(page.locator('[data-suggestion-preview]')).toHaveCount(0);
      await frames(page);
    });
    const added = await readImages(
      page,
      previews.map((image) => image.id),
    );
    for (const [i, image] of added.entries())
      if (
        !image.rootOnBoard ||
        image.boardX !== Math.round(previews[i].x) ||
        image.boardY !== Math.round(previews[i].y)
      )
        throw new Error('Preview coordinates did not survive acceptance');
    await page.waitForFunction(() => !document.querySelector('[data-arriving="true"]'));
    for (const [i, image] of added.entries())
      await photo(image.id).click(i ? { modifiers: ['Shift'] } : {});
    await measure('removeThreeImages', async () => {
      await page
        .getByRole('group', { name: 'Image actions', exact: true })
        .getByRole('button', { name: 'Remove from staging', exact: true })
        .click();
      await idle(page);
      await frames(page);
    });
    if (
      (
        await readImages(
          page,
          added.map((image) => image.id),
        )
      ).some((image) => image.rootOnBoard !== false)
    )
      throw new Error('Removal failed');
    await memory('interactions');
    const exportMenu = page.locator('.workspace-export');
    await exportMenu.locator('summary').click();
    await measure('sortedZip3000', async () => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export sorted ZIP', exact: true }).click();
      const download = await pending,
        file = await download.path();
      sample.zipBytes = (await fs.stat(file)).size;
      sample.zipPath = file;
      await frames(page);
    });
    const archive = await JSZip.loadAsync(await fs.readFile(sample.zipPath));
    delete sample.zipPath;
    if (
      Object.values(archive.files).filter((file) => !file.dir && file.name.endsWith('.png'))
        .length !== count
    )
      throw new Error('Sorted ZIP missing originals');
    await board(page).evaluate(
      (element, origin) => element.scrollTo(origin.left, origin.top),
      origin,
    );
    await frames(page, 4);
    await exportMenu.locator('summary').click();
    await measure('currentViewPng', async () => {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Current view (PNG)', exact: true }).click();
      const download = await pending;
      sample.pngBytes = (await fs.stat(await download.path())).size;
      await frames(page);
    });
    await page.waitForTimeout(1100);
    await memory('exports');
    sample.boardNodes = await board(page).locator('.card').count();
    if (sample.errors.length) throw new Error(sample.errors.join('\n'));
    return sample;
  } catch (error) {
    await page.screenshot({ path: new URL('failure-' + branch + '.png', output).pathname });
    throw error;
  } finally {
    await context.close();
  }
}
async function runImport(branch) {
  const context = await createContext(),
    page = await context.newPage();
  page.setDefaultTimeout(60000);
  const sample = { metrics: {}, memory: {}, errors: [] },
    { measure, memory } = await instrument(context, page, sample);
  page.on('pageerror', (error) => sample.errors.push(String(error)));
  try {
    await page.goto(targets[branch]);
    await expect(
      page.getByRole('heading', { name: 'Drop an image folder here', exact: true }),
    ).toBeVisible();
    await seed(page, true);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Performance fixture', exact: true }),
    ).toBeVisible();
    await measure('import300Jpeg', async () => {
      await page.locator('input[accept="image/*"]').setInputFiles(importFiles);
      await expect(page.getByRole('button', { name: 'Add 3 images', exact: true })).toBeVisible({
        timeout: 60000,
      });
      await idle(page);
      await frames(page);
    });
    const imported = await page.evaluate(async () => {
      const r = indexedDB.open('sortboard-image-library-minimal', 2);
      const db = await new Promise((resolve) => {
        r.onsuccess = () => resolve(r.result);
      });
      const total = await new Promise((resolve) => {
        const q = db.transaction('images').objectStore('images').count();
        q.onsuccess = () => resolve(q.result);
      });
      db.close();
      return total;
    });
    if (imported !== importedCount) throw new Error('Import did not finish all originals');
    await memory('import');
    if (sample.errors.length) throw new Error(sample.errors.join('\n'));
    return sample;
  } finally {
    await context.close();
  }
}
async function run(branch, pair, warmup) {
  const sample = await runUI(branch, pair, warmup);
  if (!cachedOnly) {
    const imported = await runImport(branch);
    Object.assign(sample.metrics, imported.metrics);
    Object.assign(sample.memory, imported.memory);
  }
  results.samples.push(sample);
  await fs.writeFile(
    new URL(cachedOnly ? 'measurements-cached.json' : 'measurements.json', output),
    JSON.stringify(results, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      branch,
      pair,
      warmup,
      wallMs: Object.fromEntries(
        Object.entries(sample.metrics).map(([name, value]) => [name, Math.round(value.wallMs)]),
      ),
    }),
  );
}
try {
  const orders = [
    ['original', 'prior', 'final'],
    ['prior', 'final', 'original'],
    ['final', 'original', 'prior'],
    ['final', 'prior', 'original'],
    ['prior', 'original', 'final'],
    ['original', 'final', 'prior'],
  ];
  for (let pair = -warmups; pair < repetitions; pair++) {
    const order = pair < 0 ? ['final', 'prior', 'original'] : orders[pair % orders.length];
    for (const branch of order) await run(branch, pair, pair < 0);
  }
} finally {
  await browser.close();
  await fs.rm(importDirectory, { recursive: true, force: true });
}
