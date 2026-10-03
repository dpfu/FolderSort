import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { CLIP_CACHE_KEY, normalizeVector, packVector } from '../src/contentSimilarity';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function seedOverviewImages(page: Page, count: number) {
  await page.goto('/');
  await page.evaluate(async (count) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sortboard-image-library-minimal', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    // Real originals exercise worker decoding and thumbnail persistence without
    // depending on external image hosts. Reusing blobs keeps the fixture small.
    const originals: Blob[] = [];
    for (let index = 0; index < 4; index++) {
      const canvas = document.createElement('canvas');
      canvas.width = index % 2 ? 768 : 1024; canvas.height = index % 2 ? 1024 : 768;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = ['#d9b89e', '#9caecc', '#a6bfa1', '#d6c584'][index]; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#233e31'; ctx.fillRect(180, 160, 330, 410);
      ctx.fillStyle = '#fff'; ctx.font = '64px sans-serif'; ctx.fillText(`Image ${index}`, 210, 250);
      originals.push(await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg', .9)));
    }
    const projectId = 'overview-study', now = Date.now();
    const transaction = db.transaction(['projects', 'images', 'categories', 'assets', 'meta'], 'readwrite');
    transaction.objectStore('projects').put({ id: projectId, name: 'Overview study', createdAt: now, updatedAt: now }, projectId);
    transaction.objectStore('meta').put(projectId, 'activeProjectId');
    transaction.objectStore('categories').put({ id: 'scenes', projectId, name: 'Scenes', createdAt: now }, 'scenes');
    transaction.objectStore('categories').put({ id: 'details', projectId, name: 'Scenes/Detail', createdAt: now }, 'details');
    for (let index = 0; index < count; index++) {
      const id = `overview-${index}`, blob = originals[index % 4];
      transaction.objectStore('images').put({ id, projectId, path: `image-${String(index).padStart(4, '0')}.jpg`, mime: 'image/jpeg', size: blob.size,
        addedAt: now, categoryId: index % 3 === 0 ? 'details' : null, placement: 'tray', fileModifiedAt: 1700000000000 + index,
        visual: { version: 1, width: index % 2 ? 768 : 1024, height: index % 2 ? 1024 : 768, hash: index.toString(16).padStart(16, '0') } }, id);
      transaction.objectStore('assets').put(blob, id);
    }
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    db.close();
  }, count);
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  await page.getByRole('combobox', { name: 'Overview order' }).selectOption('name');
}

async function similarityFixtures(page: Page) {
  return page.evaluate(() => {
    const draw = (width: number, height: number, mirrored: boolean, brightness: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = `rgb(${45 + brightness},${45 + brightness},${45 + brightness})`;
      context.fillRect(0, 0, width, height);
      context.fillStyle = `rgb(${165 + brightness},${165 + brightness},${165 + brightness})`;
      context.fillRect(mirrored ? 0 : width * 13 / 32, height * 9 / 32, width * (mirrored ? 13 : 19) / 32, height * 17 / 32);
      return canvas.toDataURL('image/png').split(',')[1];
    };
    return [
      { name: 'a-source.png', data: draw(320, 160, false, 0), date: 300 },
      { name: 'z-variant.png', data: draw(640, 320, false, 20), date: 100 },
      { name: 'b-other.png', data: draw(160, 320, true, 0), date: 200 },
      { name: 'y-other-variant.png', data: draw(320, 640, true, 20), date: 150 },
    ];
  });
}

async function importSimilarityFixtures(page: Page) {
  const fixtures = await similarityFixtures(page);
  await page.locator('input[type=file][accept="image/*"]').evaluate((input: HTMLInputElement, files) => {
    const transfer = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: 'image/png', lastModified: file.date }));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, fixtures);
  await expect(page.getByRole('status').filter({ hasText: '4 images added' })).toBeVisible();
}

async function savedImages(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('sortboard-image-library-minimal', 2);
      request.onsuccess = () => resolve(request.result);
    });
    const images = await new Promise<Array<{ id: string; path: string; categoryId: string | null; placement?: string; clip?: { model: string; vector: string }; fileModifiedAt?: number; visual?: { version: number; hash: string; width: number; height: number } }>>((resolve) => {
      const request = db.transaction('images').objectStore('images').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return images;
  });
}

/** Replace only model loading/inference. Cache decoding, ordering and neighbour
 * ranking still run in the real worker. CI never downloads AI models. */
async function mockClipInference(page: Page, failModel = false) {
  await page.addInitScript(({ model, fail }) => {
    const NativeWorker = window.Worker;
    const counts = { workers: 0, models: 0, embeds: 0 };
    (window as unknown as { clipCounts: typeof counts }).clipCounts = counts;
    window.Worker = class extends NativeWorker {
      private clipWorker: boolean;
      private stopped = false;
      private initialized = false;
      private embedded = new Map<number, { model: string; vector: string }>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.clipWorker = String(url).includes('clip.worker');
        if (this.clipWorker) counts.workers++;
        this.addEventListener('message', (event: MessageEvent) => {
          const vector = this.embedded.get(event.data.requestId);
          if (vector) { event.data.result = vector; this.embedded.delete(event.data.requestId); }
        });
      }
      terminate() { this.stopped = true; super.terminate(); }
      postMessage(message: unknown, transfer: Transferable[] = []) {
        const job = message as { kind: string; requestId: number; id: string; blob: File };
        const reply = (data: object) => { if (!this.stopped) this.onmessage?.call(this, new MessageEvent('message', { data })); };
        if (this.clipWorker && job.kind === 'init') {
          if (!this.initialized) { this.initialized = true; counts.models++; reply({ progress: { phase: 'loading', percent: 50 } }); }
          setTimeout(() => reply(fail ? { requestId: job.requestId, error: 'Model download failed', stage: 'model' } : { requestId: job.requestId, result: null }), 80);
        } else if (this.clipWorker && job.kind === 'embed') {
          setTimeout(() => {
            if (this.stopped) return;
            const name = job.blob.name || '';
            const vector = new Float32Array(512);
            const axis = name.includes('other') ? 10 : 0;
            const nearby = name.includes('variant') ? .1 : 0;
            vector[axis] = 1 / Math.sqrt(1 + nearby * nearby);
            vector[axis + 1] = nearby / Math.sqrt(1 + nearby * nearby);
            const bytes = new Uint8Array(2048), view = new DataView(bytes.buffer);
            vector.forEach((value, index) => view.setFloat32(index * 4, value, true));
            let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
            const clip = { model, vector: btoa(binary) };
            this.embedded.set(job.requestId, clip); counts.embeds++;
            super.postMessage({ kind: 'cache', requestId: job.requestId, images: [{ id: job.id, clip }] });
          }, 180);
        } else super.postMessage(message, transfer);
      }
    };
  }, { model: CLIP_CACHE_KEY, fail: failModel });
}

test('CLIP is optional, resumable, cached in backups, and shared by pile and board matching', async ({ page }) => {
  await mockClipInference(page);
  const modelRequests: string[] = [];
  await page.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, (route) => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await importSimilarityFixtures(page);
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  const counts = () => page.evaluate(() => (window as unknown as { clipCounts: { workers: number; models: number; embeds: number } }).clipCounts);
  expect(await counts()).toEqual({ workers: 0, models: 0, embeds: 0 });
  const order = page.getByRole('combobox', { name: 'Pile order' });
  const method = page.getByRole('combobox', { name: 'Similarity method' });
  const index = page.getByRole('region', { name: 'CLIP indexing' });
  await order.selectOption('semantic');
  await expect(method).toHaveValue('clip');
  await expect.poll(async () => (await counts()).embeds).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause CLIP indexing' }).click();
  await expect(index).toContainText('paused');
  await expect.poll(async () => (await savedImages(page)).filter((image) => image.clip).length).toBeGreaterThan(0);
  const paused = (await counts()).embeds;
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('group', { name: 'Board zoom' })).toContainText('115%');
  await page.getByRole('button', { name: 'Resume CLIP indexing' }).click();
  await expect(index).toContainText('CLIP 4 / 4 indexed');
  expect(paused).toBeLessThan(4);
  await expect.poll(async () => (await savedImages(page)).filter((image) => image.clip).length).toBe(4);
  expect((await counts()).embeds).toBe(4);
  const pile = page.getByRole('region', { name: 'Image pile' });
  const names = () => pile.locator('.card--sort').evaluateAll((cards) => [...cards].sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x).map((card) => card.getAttribute('aria-label')!.replace('Card: ', '')));
  await expect.poll(names).toEqual(['a-source.png', 'z-variant.png', 'b-other.png', 'y-other-variant.png']);
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  const overview = page.getByRole('dialog', { name: 'Explore image pile', exact: true });
  await expect(overview.getByRole('combobox', { name: 'Overview order' })).toHaveValue('semantic');
  await expect(overview.getByRole('checkbox')).toHaveCount(4);
  await overview.getByRole('button', { name: 'Reverse overview order' }).click();
  await expect(overview.getByRole('button', { name: 'Reverse overview order' })).toHaveAttribute('aria-pressed', 'true');
  await overview.getByRole('button', { name: 'Reverse overview order' }).click();
  await overview.getByRole('button', { name: 'Back to sorting board' }).click();
  await expect.poll(names).toEqual(['a-source.png', 'z-variant.png', 'b-other.png', 'y-other-variant.png']);
  await page.getByRole('button', { name: '1 image per add' }).click();
  await page.getByRole('button', { name: 'Add 1 image here' }).first().click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  await board.getByRole('group', { name: 'Card: a-source.png' }).click();
  await page.getByRole('button', { name: 'Add similar to selected image' }).click();
  await expect(board.getByRole('group', { name: 'Card: z-variant.png' })).toBeInViewport({ ratio: 1 });
  expect((await savedImages(page)).every((image) => image.categoryId === null)).toBe(true);
  await page.getByRole('button', { name: 'Back to project' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup ZIP' }).click();
  const backup = await download;
  const manifest = JSON.parse(await (await JSZip.loadAsync(await fs.readFile(await backup.path()))).file('project.json')!.async('string'));
  expect(manifest.images.every((image: { clip: { model: string; vector: string } }) => image.clip.model === CLIP_CACHE_KEY && image.clip.vector.length === 2732)).toBe(true);
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(await backup.path());
  await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await order.selectOption('semantic');
  await expect(index).toContainText('CLIP 4 / 4 indexed');
  await page.getByRole('button', { name: '1 image per add' }).click();
  await page.getByRole('button', { name: 'Add similar to board' }).click();
  await expect(board.locator('.card--sort')).toHaveCount(3);
  expect((await counts()).models).toBe(0);
  expect((await counts()).embeds).toBe(0);
  expect(modelRequests).toEqual([]);
});

test('a CLIP download failure leaves normal sorting usable on mobile', async ({ page }) => {
  await mockClipInference(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await importSimilarityFixtures(page);
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  const method = page.getByRole('combobox', { name: 'Similarity method' });
  await expect(method).toBeInViewport();
  await method.selectOption('clip');
  await expect(page.getByRole('region', { name: 'CLIP indexing' })).toContainText('CLIP unavailable: Model download failed');
  await expect(page.getByRole('button', { name: 'Retry CLIP indexing' })).toBeInViewport();
  await page.getByRole('button', { name: 'Add up to 3 random images here' }).first().click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(3);
  await method.selectOption('visual');
  await expect(page.getByRole('region', { name: 'CLIP indexing' })).toHaveCount(0);
});

test('orders the pile and expands selected/board references with cached local perceptual hashes', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const counts = { analyze: 0 };
    (window as unknown as { analysisCounts: typeof counts }).analysisCounts = counts;
    window.Worker = class extends NativeWorker {
      postMessage(message: unknown, transfer: Transferable[] = []) {
        if ((message as { kind?: string })?.kind === 'analyze') counts.analyze++;
        super.postMessage(message, transfer);
      }
    };
  });
  await page.goto('/');
  await importSimilarityFixtures(page);
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  const pile = page.getByRole('region', { name: 'Image pile' });
  const board = page.getByRole('region', { name: 'Sorting board area' });
  const order = page.getByRole('combobox', { name: 'Pile order' });
  expect(await page.evaluate(() => (window as unknown as { analysisCounts: { analyze: number } }).analysisCounts.analyze)).toBe(0);
  await order.selectOption('similarity');
  await expect.poll(async () => (await savedImages(page)).filter((image) => image.visual).length).toBe(4);
  const names = () => pile.locator('.card--sort').evaluateAll((cards) => [...cards].sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x).map((card) => card.getAttribute('aria-label')!.replace('Card: ', '')));
  await expect.poll(names).toEqual(['a-source.png', 'z-variant.png', 'b-other.png', 'y-other-variant.png']);

  await order.selectOption('modified');
  await expect.poll(names).toEqual(['z-variant.png', 'y-other-variant.png', 'b-other.png', 'a-source.png']);
  await page.getByRole('button', { name: 'Reverse pile order' }).click();
  await expect.poll(names).toEqual(['a-source.png', 'b-other.png', 'y-other-variant.png', 'z-variant.png']);
  await order.selectOption('resolution');
  await expect.poll(names).toEqual(['y-other-variant.png', 'z-variant.png', 'a-source.png', 'b-other.png']);
  await order.selectOption('aspect');
  await expect.poll(names).toEqual(['b-other.png', 'y-other-variant.png', 'a-source.png', 'z-variant.png']);
  await order.selectOption('name');
  await expect.poll(names).toEqual(['a-source.png', 'b-other.png', 'y-other-variant.png', 'z-variant.png']);
  await page.getByRole('button', { name: '1 image per add' }).click();
  await page.getByRole('button', { name: 'Add 1 image here' }).first().click();
  const source = board.getByRole('group', { name: 'Card: a-source.png' });
  await source.click();
  await page.getByRole('button', { name: 'Add similar to selected image' }).click();
  await expect(board.getByRole('group', { name: 'Card: z-variant.png' })).toBeVisible();
  await expect(board.getByRole('group', { name: 'Card: z-variant.png' })).toBeInViewport({ ratio: 1 });
  await expect(board.locator('.card--sort')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add similar to board' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No close visual matches left' })).toBeVisible();
  await expect(board.locator('.card--sort')).toHaveCount(2);

  await pile.getByRole('group', { name: 'Card: b-other.png' }).click();
  await page.getByRole('button', { name: 'Add to board', exact: true }).click();
  await expect(board.locator('.card--sort')).toHaveCount(3);
  await page.getByRole('button', { name: 'Add similar to board' }).click();
  await expect(board.getByRole('group', { name: 'Card: y-other-variant.png' })).toBeVisible();
  await expect(board.locator('.card--sort')).toHaveCount(4);
  expect((await savedImages(page)).every((image) => image.categoryId === null)).toBe(true);

  const cached = await savedImages(page);
  await page.getByRole('button', { name: 'Back to project' }).click();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await page.getByRole('button', { name: 'Clear board' }).click();
  await order.selectOption('similarity');
  await expect.poll(names).toEqual(['a-source.png', 'z-variant.png', 'b-other.png', 'y-other-variant.png']);
  expect(await page.evaluate(() => (window as unknown as { analysisCounts: { analyze: number } }).analysisCounts.analyze)).toBe(4);
  await page.getByRole('button', { name: 'Back to project' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup ZIP' }).click();
  const backup = await download;
  const zip = await JSZip.loadAsync(await fs.readFile(await backup.path()));
  const manifest = JSON.parse(await zip.file('project.json')!.async('string'));
  expect(manifest.images.find((image: { path: string }) => image.path === 'z-variant.png').fileModifiedAt).toBe(100);
  expect(manifest.images.find((image: { path: string }) => image.path === 'z-variant.png').visual.width).toBe(640);
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(await backup.path());
  await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await order.selectOption('similarity');
  await expect.poll(names).toEqual(['a-source.png', 'z-variant.png', 'b-other.png', 'y-other-variant.png']);
  expect(await page.evaluate(() => (window as unknown as { analysisCounts: { analyze: number } }).analysisCounts.analyze)).toBe(0);
  const restored = (await savedImages(page)).slice().sort((a, b) => a.path.localeCompare(b.path));
  for (const image of cached) {
    expect(restored.filter((item) => item.path === image.path).every((item) => JSON.stringify(item.visual) === JSON.stringify(image.visual))).toBe(true);
  }
});

test('can analyze and sort on mobile when worker decoding is unavailable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'Worker', { value: undefined, configurable: true }); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await importSimilarityFixtures(page);
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  const order = page.getByRole('combobox', { name: 'Pile order' });
  await expect(order).toBeInViewport();
  await order.selectOption('similarity');
  await expect.poll(async () => (await savedImages(page)).filter((image) => image.visual).length).toBe(4);
  await expect(page.getByRole('button', { name: '3 images per add' })).toBeInViewport();
  await page.getByRole('button', { name: '1 image per add' }).click();
  await page.getByRole('button', { name: 'Add 1 image here' }).first().click();
  await page.getByRole('button', { name: 'Add similar to board' }).click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Sorting board area' }).getByRole('group', { name: 'Card: z-variant.png' })).toBeInViewport({ ratio: 1 });
});

async function exposedCardPoint(card: Locator): Promise<{ x: number; y: number }> {
  await card.hover({ position: { x: 8, y: 56 } });
  const rect = (await card.boundingBox())!;
  return { x: rect.x + 8, y: rect.y + 56 };
}

async function dragKeepingGrabPoint(page: Page, source: Locator, destination: Locator, target: { x: number; y: number }) {
  const from = await exposedCardPoint(source);
  const start = (await source.boundingBox())!;
  const anchor = { x: (from.x - start.x) / start.width, y: (from.y - start.y) / start.height };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 16 });
  const preview = page.locator('.sorting-workspace__drag-ghost');
  await expect(preview).toBeVisible();
  const grabPointError = async (element: Locator) => {
    const bounds = (await element.boundingBox())!;
    return Math.max(Math.abs(bounds.x + anchor.x * bounds.width - target.x), Math.abs(bounds.y + anchor.y * bounds.height - target.y));
  };
  await expect.poll(() => grabPointError(preview)).toBeLessThan(3);
  await page.mouse.up();
  await expect(destination).toBeVisible();
  await expect.poll(() => grabPointError(destination)).toBeLessThan(3);
}

for (const zoomSteps of [0, -2, 2]) {
  test(`keeps manual drops under the grabbed point at ${100 + zoomSteps * 15}% zoom, including overlaps and a scrolled pile`, async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type=file][accept="image/*"]').setInputFiles(
      Array.from({ length: 90 }, (_, index) => ({ name: `position-${index}.png`, mimeType: 'image/png', buffer: tinyPng }))
    );
    await page.getByRole('button', { name: 'Open sorting workspace' }).click();
    for (let step = 0; step < Math.abs(zoomSteps); step++) {
      await page.getByRole('button', { name: zoomSteps < 0 ? 'Zoom out' : 'Zoom in' }).click();
    }
    await page.getByTestId('board-root').evaluate((board) => { board.scrollLeft += 170; board.scrollTop += 95; });
    const pile = page.getByRole('region', { name: 'Image pile' });
    const pileScroll = pile.getByLabel('Scroll image pile');
    await pileScroll.evaluate((element) => { element.scrollLeft = 1200; });
    await expect.poll(() => pileScroll.evaluate((element) => element.scrollLeft)).toBe(1200);
    const board = page.getByRole('region', { name: 'Sorting board area' });
    const bounds = (await board.boundingBox())!;
    const target = { x: bounds.x + bounds.width * .42, y: bounds.y + bounds.height * .62 };
    let lastCardId = '';
    for (let drop = 0; drop < 2; drop++) {
      let cardId: string | null | undefined;
      await expect.poll(async () => {
        cardId = await pile.locator('.card--sort').evaluateAll((cards) => {
          const viewport = document.querySelector('.sorting-workspace__tray-scroll')!.getBoundingClientRect();
          return cards.find((card) => {
            const rect = card.getBoundingClientRect();
            return rect.left > viewport.left + 45 && rect.right < viewport.right - 45;
          })?.getAttribute('data-testid');
        });
        return cardId;
      }).toBeTruthy();
      lastCardId = cardId!;
      await dragKeepingGrabPoint(page, pile.getByTestId(lastCardId), board.getByTestId(lastCardId), target);
      await expect(board.locator('.card--sort')).toHaveCount(drop + 1);
    }
    await dragKeepingGrabPoint(page, board.getByTestId(lastCardId), board.getByTestId(lastCardId),
      { x: bounds.x + bounds.width * .62, y: bounds.y + bounds.height * .4 });
  });
}

test('adds an image, survives immediate reload, and imports its ZIP backup', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Folder Sort');
  await expect(page.getByRole('heading', { name: 'Folder Sort' })).toBeVisible();
  await page.getByRole('textbox', { name: 'New project name' }).fill('Synthetic study');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('heading', { name: 'Synthetic study' })).toBeVisible();

  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(page.getByRole('status').filter({ hasText: 'Saved locally' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open sample.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Open sample.png' }).click();
  await expect(page.getByRole('dialog', { name: 'sample.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Close image' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup ZIP' }).click();
  const exported = await downloadPromise;
  expect(exported.suggestedFilename()).toBe('Synthetic-study.zip');
  const currentZip = await JSZip.loadAsync(await fs.readFile(await exported.path()));
  expect(JSON.parse(await currentZip.file('project.json')!.async('string')).format).toBe('folder-sort-project');
  await page.getByRole('button', { name: 'Import project ZIP' }).click();
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(await exported.path());
  await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open sample.png' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Synthetic study' })).toHaveCount(2);

  const olderZip = await JSZip.loadAsync(await fs.readFile(await exported.path()));
  const olderManifest = JSON.parse(await olderZip.file('project.json')!.async('string'));
  olderManifest.format = 'sortboard-image-library';
  olderManifest.version = 1;
  delete olderManifest.categories;
  for (const image of olderManifest.images) delete image.categoryId;
  olderZip.file('project.json', JSON.stringify(olderManifest));
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles({
    name: 'older-library.zip', mimeType: 'application/zip', buffer: await olderZip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open sample.png' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Synthetic study' })).toHaveCount(3);
});

test('adds a folder with relative paths and restores a project directory', async ({ page }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sortboard-library-test-'));
  try {
    const source = path.join(root, 'source-images');
    await fs.mkdir(path.join(source, 'nested'), { recursive: true });
    await fs.mkdir(path.join(source, 'metadata'), { recursive: true });
    await fs.writeFile(path.join(source, 'nested', 'sample.png'), tinyPng);
    await fs.writeFile(path.join(source, 'metadata', 'notes.csv'), 'source,label\n1,test\n');
    await page.goto('/');
    await page.getByRole('textbox', { name: 'New project name' }).fill('Folder study');
    await page.getByRole('button', { name: 'New project' }).click();
    await expect(page.getByRole('heading', { name: 'Folder study' })).toBeVisible();
    await page.locator('input[webkitdirectory]').first().setInputFiles(source);
    const choice = page.getByRole('dialog', { name: 'Choose starting categories' });
    await expect(choice).toContainText('1 image');
    await expect(choice).not.toContainText('metadata');
    await choice.getByRole('button', { name: 'Start fresh · ignore subfolders' }).click();
    await expect(page.getByRole('status').filter({ hasText: '1 image added' })).toBeVisible();
    await expect(page.locator('.library-categories__list button')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open source-images/nested/sample.png' }).click();
    await expect(page.getByRole('dialog', { name: 'source-images/nested/sample.png' })).toBeVisible();
    await page.getByRole('button', { name: 'Close image' }).click();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Backup ZIP' }).click();
    const zipDownload = await downloadPromise;
    const zip = await JSZip.loadAsync(await fs.readFile(await zipDownload.path()));
    const backup = path.join(root, 'project-backup');
    await fs.mkdir(backup);
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const target = path.join(backup, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, await entry.async('nodebuffer'));
    }
    await page.locator('input[webkitdirectory]').last().setInputFiles(backup);
    await expect(page.getByRole('status').filter({ hasText: 'Project folder imported' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open source-images/nested/sample.png' })).toBeVisible();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('starts from a folder, keeps nested categories, and exports a renamed category tree', async ({ page }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-sort-tree-test-'));
  try {
    const source = path.join(root, 'collection');
    await fs.mkdir(path.join(source, 'topic', 'subtopic'), { recursive: true });
    await fs.writeFile(path.join(source, 'topic', 'subtopic', 'a.png'), tinyPng);
    await fs.writeFile(path.join(source, 'root.png'), tinyPng);

    await page.goto('/');
    await expect(page.getByRole('region', { name: 'How Folder Sort works' })).toContainText('each image in one category or subcategory');
    await page.locator('input[webkitdirectory]').first().setInputFiles(source);
    const prompt = page.getByRole('dialog', { name: 'Choose starting categories' });
    await expect(prompt).toContainText('topic/subtopic');
    await prompt.getByRole('button', { name: 'Keep subfolders as categories' }).click();

    await expect(page.getByRole('heading', { name: 'collection' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'collection' })).toHaveCount(1);
    const parentSelect = page.getByRole('combobox', { name: 'Parent category' });
    await expect(parentSelect.getByRole('option', { name: 'topic', exact: true })).toHaveCount(1);
    await expect(parentSelect.getByRole('option', { name: 'topic/subtopic' })).toHaveCount(1);
    await parentSelect.selectOption({ label: 'topic' });
    await page.getByRole('textbox', { name: 'New category name' }).fill('another');
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(parentSelect.getByRole('option', { name: 'topic/another' })).toHaveCount(1);

    page.once('dialog', (dialog) => dialog.accept('renamed'));
    await page.getByTitle('Rename topic', { exact: true }).click();
    await expect(parentSelect.getByRole('option', { name: 'renamed/subtopic' })).toHaveCount(1);
    await expect(parentSelect.getByRole('option', { name: 'renamed/another' })).toHaveCount(1);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export sorted ZIP' }).click();
    const sorted = await JSZip.loadAsync(await fs.readFile(await (await downloadPromise).path()));
    expect(sorted.file('renamed/subtopic/a.png')).not.toBeNull();
    expect(sorted.files['renamed/another/']?.dir).toBe(true);
    expect(sorted.file('_Unassigned/root.png')).not.toBeNull();
    expect(await sorted.file('renamed/subtopic/a.png')!.async('nodebuffer')).toEqual(tinyPng);
    expect(await sorted.file('assignments.csv')!.async('string')).toContain('"collection/topic/subtopic/a.png","renamed/subtopic","renamed/subtopic/a.png"');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('keeps a child inside its parent when category names collide as folder names', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New project name' }).fill('Collision study');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles([
    { name: 'a.png', mimeType: 'image/png', buffer: tinyPng },
    { name: 'b.png', mimeType: 'image/png', buffer: tinyPng },
  ]);
  await expect(page.getByRole('status').filter({ hasText: '2 images added' })).toBeVisible();
  for (const name of ['A?', 'A_', 'A_/Child']) {
    await page.getByRole('textbox', { name: 'New category name' }).fill(name);
    await page.getByRole('button', { name: 'Add category' }).click();
    await expect(page.getByRole('combobox', { name: 'Parent category' }).getByRole('option', { name, exact: true })).toHaveCount(1);
  }
  for (const [filename, category] of [['a.png', 'A_'], ['b.png', 'A_/Child']]) {
    await page.getByRole('button', { name: `Open ${filename}` }).click();
    await page.getByRole('combobox', { name: 'Image category' }).selectOption({ label: category });
    await expect(page.getByRole('status').filter({ hasText: 'Category assignment saved' })).toBeVisible();
    await page.getByRole('button', { name: 'Close image' }).click();
  }
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sorted ZIP' }).click();
  const sorted = await JSZip.loadAsync(await fs.readFile(await (await downloadPromise).path()));
  const csv = await sorted.file('assignments.csv')!.async('string');
  const rows = csv.trim().split('\r\n').slice(1).map((line) => line.match(/^"([^"]*)","([^"]*)","([^"]*)"$/)!.slice(1));
  const parentImage = rows.find((row) => row[0] === 'a.png')![2];
  const childImage = rows.find((row) => row[0] === 'b.png')![2];
  expect(childImage.startsWith(`${parentImage.slice(0, parentImage.lastIndexOf('/'))}/Child/`)).toBe(true);
});

test('writes a folder backup with originals and a manifest', async ({ page }) => {
  await page.addInitScript(() => {
    const writes: Array<{ path: string; bytes: number }> = [];
    (window as unknown as { libraryTestWrites: typeof writes }).libraryTestWrites = writes;
    const directory = (prefix: string) => ({
      getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
      getFileHandle: async (name: string) => ({
        createWritable: async () => ({
          write: async (blob: Blob) => { writes.push({ path: `${prefix}${name}`, bytes: blob.size }); },
          close: async () => {},
        }),
      }),
    });
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => directory(''), configurable: true });
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New project name' }).fill('Directory study');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('heading', { name: 'Directory study' })).toBeVisible();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(page.getByRole('status').filter({ hasText: '1 image added' })).toBeVisible();
  await page.getByRole('button', { name: 'Backup folder' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Project saved in' })).toBeVisible();
  const writes = await page.evaluate(() => (window as unknown as { libraryTestWrites: Array<{ path: string; bytes: number }> }).libraryTestWrites);
  expect(writes).toHaveLength(2);
  expect(writes[0].path).toMatch(/^Directory-study-.*\/images\/.*\/sample\.png$/);
  expect(writes[0].bytes).toBe(tinyPng.length);
  expect(writes[1].path).toMatch(/^Directory-study-.*\/project\.json$/);
  expect(writes[1].bytes).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Export sorted folder' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sorted images saved' })).toBeVisible();
  const allWrites = await page.evaluate(() => (window as unknown as { libraryTestWrites: Array<{ path: string; bytes: number }> }).libraryTestWrites);
  expect(allWrites).toHaveLength(4);
  expect(allWrites[2].path).toMatch(/^Directory-study-sorted-.*\/_Unassigned\/sample\.png$/);
  expect(allWrites[2].bytes).toBe(tinyPng.length);
  expect(allWrites[3].path).toMatch(/^Directory-study-sorted-.*\/assignments\.csv$/);
});

test('reads every batch when a folder is dropped', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New project name' }).fill('Dropped folder');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('heading', { name: 'Dropped folder' })).toBeVisible();
  await page.locator('.library-dropzone').evaluate((dropzone) => {
    const image = (name: string) => ({
      isFile: true, isDirectory: false, name,
      file: (success: (file: File) => void) => success(new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })),
    });
    const batches = [[image('one.png')], [image('two.png')], []];
    const folder = {
      isFile: false, isDirectory: true, name: 'dropped',
      createReader: () => ({ readEntries: (success: (entries: unknown[]) => void) => success(batches.shift() || []) }),
    };
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { items: [{ kind: 'file', webkitGetAsEntry: () => folder }], files: [] },
    });
    dropzone.dispatchEvent(event);
  });
  await expect(page.getByRole('status').filter({ hasText: '2 images added' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open dropped/one.png' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open dropped/two.png' })).toBeVisible();
});

test('seeds nested categories, revises an assignment, and exports sorted originals', async ({ page }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sortboard-categories-test-'));
  try {
    const source = path.join(root, 'collection');
    await fs.mkdir(path.join(source, 'topic', 'subtopic'), { recursive: true });
    await fs.mkdir(path.join(source, 'topic', 'other'), { recursive: true });
    for (const name of ['topic/subtopic/a.png', 'topic/other/a.png', 'root.png']) {
      const target = path.join(source, name);
      await fs.writeFile(target, tinyPng);
    }
    await page.goto('/');
    await page.getByRole('textbox', { name: 'New project name' }).fill('Category study');
    await page.getByRole('button', { name: 'New project' }).click();
    await expect(page.getByRole('heading', { name: 'Category study' })).toBeVisible();
    await page.locator('input[webkitdirectory]').first().setInputFiles(source);
    const prompt = page.getByRole('dialog', { name: 'Choose starting categories' });
    await expect(prompt).toContainText('topic/subtopic');
    await prompt.getByRole('button', { name: 'Keep subfolders as categories' }).click();
    await expect(page.getByRole('status').filter({ hasText: '3 images added' })).toBeVisible();
    const parentCategories = page.getByRole('combobox', { name: 'Parent category' });
    await expect(parentCategories.getByRole('option', { name: 'topic/subtopic' })).toHaveCount(1);
    await expect(parentCategories.getByRole('option', { name: 'topic/other' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Open collection/topic/subtopic/a.png' }).click();
    const category = page.getByRole('combobox', { name: 'Image category' });
    await expect(category).toHaveValue((await category.getByRole('option', { name: 'topic/subtopic' }).getAttribute('value'))!);
    await category.selectOption({ label: 'topic/other' });
    await expect(page.getByRole('status').filter({ hasText: 'Category assignment saved' })).toBeVisible();
    await page.getByRole('button', { name: 'Close image' }).click();

    const sortedDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export sorted ZIP' }).click();
    const sorted = await JSZip.loadAsync(await fs.readFile(await (await sortedDownload).path()));
    expect(sorted.file('topic/other/a.png')).not.toBeNull();
    expect(sorted.file('topic/other/a (2).png')).not.toBeNull();
    expect(sorted.file('_Unassigned/root.png')).not.toBeNull();
    expect(await sorted.file('topic/other/a.png')!.async('nodebuffer')).toEqual(tinyPng);
    const csv = await sorted.file('assignments.csv')!.async('string');
    expect(csv).toContain('"collection/topic/subtopic/a.png","topic/other","topic/other/a (2).png"');

    page.once('dialog', (dialog) => dialog.accept('Reviewed'));
    await page.getByRole('button', { name: /topic\/other 2/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Category renamed' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Reviewed (2)' })).toHaveCount(1);

    const backupDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Backup ZIP' }).click();
    const backup = await backupDownload;
    const legacyZip = await JSZip.loadAsync(await fs.readFile(await backup.path()));
    const legacyManifest = JSON.parse(await legacyZip.file('project.json')!.async('string'));
    legacyManifest.format = 'sortboard-image-library';
    legacyManifest.categories = legacyManifest.categories.filter((item: { name: string }) => item.name !== 'topic');
    legacyZip.file('project.json', JSON.stringify(legacyManifest));
    await page.locator('input[accept=".zip,application/zip"]').setInputFiles({
      name: 'legacy-project.zip', mimeType: 'application/zip', buffer: await legacyZip.generateAsync({ type: 'nodebuffer' }),
    });
    await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Parent category' }).getByRole('option', { name: 'topic', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Open collection/topic/subtopic/a.png' }).click();
    await expect(page.getByRole('combobox', { name: 'Image category' })).toHaveValue((await page.getByRole('option', { name: 'Reviewed' }).last().getAttribute('value'))!);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('opens an existing version-one library after the category-store upgrade', async ({ page }) => {
  await page.route('**/seed.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Seed</title>' }));
  await page.goto('/seed.html');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sortboard-image-library-minimal', 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('projects');
        database.createObjectStore('images').createIndex('byProject', 'projectId');
        database.createObjectStore('assets');
        database.createObjectStore('meta');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['projects', 'images', 'assets', 'meta'], 'readwrite');
    tx.objectStore('projects').put({ id: 'old-project', name: 'Earlier library', createdAt: 1, updatedAt: 1 }, 'old-project');
    tx.objectStore('images').put({ id: 'old-image', projectId: 'old-project', path: 'old.png', mime: 'image/png', size: 3, addedAt: 1 }, 'old-image');
    tx.objectStore('assets').put(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'old-image');
    tx.objectStore('meta').put('old-project', 'activeProjectId');
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Earlier library' })).toBeVisible();
  await page.getByRole('button', { name: 'Open old.png' }).click();
  await expect(page.getByRole('combobox', { name: 'Image category' })).toHaveValue('');
  await page.getByRole('button', { name: 'Close image' }).click();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Image pile' }).locator('.card--sort')).toHaveCount(0);
});

test('draws from the pile, codes through the tree, and clears coded cards without losing assignments', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New project name' }).fill('Three-area study');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Project created and saved locally' })).toBeVisible();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(
    Array.from({ length: 7 }, (_, index) => ({ name: `${index}.png`, mimeType: 'image/png', buffer: tinyPng }))
  );
  await expect(page.getByRole('status').filter({ hasText: '7 images added' })).toBeVisible();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  const pile = page.getByRole('region', { name: 'Image pile' });
  await expect(board.getByTestId('board-root').locator('.card--sort')).toHaveCount(0);
  await expect(pile.locator('.card--sort')).toHaveCount(7);
  await expect(page.getByRole('complementary', { name: 'Categories' })).toBeVisible();
  await page.getByRole('button', { name: 'Add up to 3 random images here' }).first().click();
  await expect(page.getByRole('status').filter({ hasText: 'Board saved.' })).toBeVisible();
  await expect(board.locator('.card--sort')).toHaveCount(3);
  await expect(pile.locator('.card--sort')).toHaveCount(4);

  await page.getByRole('textbox', { name: 'New category name' }).fill('Theme');
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByRole('button', { name: 'Theme', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add subcategory to Theme' }).click();
  await page.getByRole('textbox', { name: 'New category name' }).fill('Child');
  await page.getByRole('button', { name: 'Create category' }).click();
  const child = page.locator('[data-category-drop-id]').filter({ has: page.getByRole('button', { name: 'Theme/Child', exact: true }) });
  await expect(child).toBeVisible();
  const card = board.locator('.card--sort').first();
  const filename = (await card.getAttribute('aria-label'))!.replace('Card: ', '');
  await expect.poll(async () => (await card.boundingBox())?.y).toBeGreaterThan(70);
  await page.waitForTimeout(450);
  const from = (await card.boundingBox())!;
  const to = (await child.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page.getByRole('status').filter({ hasText: 'Category assignment saved.' })).toBeVisible();
  await expect(card.locator('.card__categoryLabel')).toHaveText('Theme/Child');
  await expect(board.locator('.card--sort')).toHaveCount(3);
  await expect.poll(async () => {
    const settled = (await card.boundingBox())!;
    return Math.max(Math.abs(settled.x - from.x), Math.abs(settled.y - from.y));
  }).toBeLessThan(8);
  await page.getByRole('button', { name: 'Clear coded 1' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Images returned to the pile.' })).toBeVisible();
  await expect(board.locator('.card--sort')).toHaveCount(2);
  await expect(pile.locator('.card--sort')).toHaveCount(5);
  await expect(pile.locator('.card__categoryLabel')).toHaveText('Theme/Child');
  await page.getByRole('button', { name: 'Clear board' }).click();
  await expect(board.locator('.card--sort')).toHaveCount(0);
  await expect(pile.locator('.card--sort')).toHaveCount(7);
  await page.getByRole('button', { name: 'Shuffle pile' }).click();
  await expect(pile.locator('.card--sort')).toHaveCount(7);
  await page.getByRole('button', { name: 'Back to project' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sorted ZIP' }).click();
  const sorted = await JSZip.loadAsync(await fs.readFile(await (await downloadPromise).path()));
  expect(sorted.file(`Theme/Child/${filename}`)).not.toBeNull();
});

test('drags between pile and board, returns one card, and restores placements from a backup', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New project name' }).fill('Placement study');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Project created and saved locally' })).toBeVisible();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: tinyPng },
    { name: 'two.png', mimeType: 'image/png', buffer: tinyPng },
  ]);
  await expect(page.getByRole('status').filter({ hasText: '2 images added' })).toBeVisible();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  const pile = page.getByRole('region', { name: 'Image pile' });
  await page.getByRole('textbox', { name: 'New category name' }).fill('From pile');
  await page.getByRole('button', { name: 'Create category' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByTestId('board-root').evaluate((element) => { element.scrollLeft += 120; element.scrollTop += 80; });
  const pileCardToCode = pile.getByRole('group', { name: 'Card: two.png' });
  const pileCardPoint = await exposedCardPoint(pileCardToCode);
  const categoryBounds = (await page.locator('[data-category-drop-id]').first().boundingBox())!;
  await page.mouse.move(pileCardPoint.x, pileCardPoint.y);
  await page.mouse.down();
  await page.mouse.move(categoryBounds.x + categoryBounds.width / 2, categoryBounds.y + categoryBounds.height / 2, { steps: 16 });
  await expect(page.locator('.sorting-workspace__drag-ghost')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole('status').filter({ hasText: 'Image assigned and added to board.' })).toBeVisible();
  const codedCard = board.getByRole('group', { name: 'Card: two.png' });
  await expect(codedCard.locator('.card__categoryLabel')).toHaveText('From pile');
  await expect(codedCard).toBeInViewport();
  await expect(pile.locator('.card--sort')).toHaveCount(1);
  const visibleBoard = (await board.boundingBox())!;
  await expect.poll(async () => {
    const placed = (await codedCard.boundingBox())!;
    return Math.max(Math.abs(placed.x + placed.width / 2 - visibleBoard.x - visibleBoard.width / 2),
      Math.abs(placed.y + placed.height / 2 - visibleBoard.y - visibleBoard.height / 2));
  }).toBeLessThan(3);
  const trayCard = pile.getByRole('group', { name: 'Card: one.png' });
  const from = await exposedCardPoint(trayCard);
  const boardBounds = (await board.boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(boardBounds.x + boardBounds.width / 2, boardBounds.y + boardBounds.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page.getByRole('status').filter({ hasText: 'Board saved.' })).toBeVisible();
  await expect(board.getByRole('group', { name: 'Card: one.png' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(board.getByRole('group', { name: 'Card: one.png' })).toBeVisible();
  await expect(board.getByRole('group', { name: 'Card: two.png' }).locator('.card__categoryLabel')).toHaveText('From pile');
  await expect(pile.locator('.card--sort')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to project' }).click();
  const positionedDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup ZIP' }).click();
  const positionedBackup = await positionedDownloadPromise;
  const positionedManifest = JSON.parse(await (await JSZip.loadAsync(await fs.readFile(await positionedBackup.path()))).file('project.json')!.async('string'));
  expect(positionedManifest.images.find((image: { path: string }) => image.path === 'one.png').placement).toBe('board');
  expect(positionedManifest.images.find((image: { path: string }) => image.path === 'one.png').boardX).toBeGreaterThan(0);
  expect(positionedManifest.images.find((image: { path: string }) => image.path === 'two.png').placement).toBe('board');
  expect(positionedManifest.images.find((image: { path: string }) => image.path === 'two.png').categoryId).toBeTruthy();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();

  const boardCard = board.getByRole('group', { name: 'Card: one.png' });
  const placed = (await boardCard.boundingBox())!;
  const trayBounds = (await pile.boundingBox())!;
  await page.mouse.move(placed.x + placed.width - 12, placed.y + placed.height / 2);
  await page.mouse.down();
  await page.mouse.move(trayBounds.x + trayBounds.width / 2, trayBounds.y + trayBounds.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page.getByRole('status').filter({ hasText: 'Images returned to the pile.' })).toBeVisible();
  await expect(board.locator('.card--sort')).toHaveCount(1);
  await expect(pile.locator('.card--sort')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear coded 1' }).click();
  await expect(board.locator('.card--sort')).toHaveCount(0);
  await expect(pile.locator('.card--sort')).toHaveCount(2);

  await page.getByRole('button', { name: '1 image per add' }).click();
  await page.getByRole('button', { name: 'Add 1 random image here' }).first().click();
  await expect(board.locator('.card--sort')).toHaveCount(1);
  await board.locator('.card--sort').first().click();
  await page.getByRole('button', { name: 'Return to pile' }).click();
  await expect(board.locator('.card--sort')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Images returned to the pile.' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to project' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Backup ZIP' }).click();
  const exported = await downloadPromise;
  const backup = await JSZip.loadAsync(await fs.readFile(await exported.path()));
  const manifest = JSON.parse(await backup.file('project.json')!.async('string'));
  expect(manifest.images).toHaveLength(2);
  expect(manifest.images.every((image: { placement: string }) => image.placement === 'tray')).toBe(true);
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(await exported.path());
  await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(board.locator('.card--sort')).toHaveCount(0);
  await expect(pile.locator('.card--sort')).toHaveCount(2);
  await page.getByRole('button', { name: 'Back to project' }).click();
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(await positionedBackup.path());
  await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(board.getByRole('group', { name: 'Card: one.png' })).toBeVisible();
  await expect(board.getByRole('group', { name: 'Card: two.png' }).locator('.card__categoryLabel')).toHaveText('From pile');
  await expect(pile.locator('.card--sort')).toHaveCount(0);
});

test('keeps the board, pile, and category tree usable on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New project name' }).fill('Mobile sort');
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Project created and saved locally' })).toBeVisible();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: tinyPng },
    { name: 'two.png', mimeType: 'image/png', buffer: tinyPng },
    { name: 'three.png', mimeType: 'image/png', buffer: tinyPng },
  ]);
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(page.getByRole('region', { name: 'Image pile' }).locator('.card--sort')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Back to project' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeInViewport();
  await page.getByRole('button', { name: 'Show categories' }).click();
  await expect(page.getByRole('complementary', { name: 'Categories' })).toBeInViewport();
  await expect.poll(async () => page.getByRole('complementary', { name: 'Categories' }).evaluate(
    (element) => getComputedStyle(element).transform
  )).toBe('matrix(1, 0, 0, 1, 0, 0)');
  await page.getByRole('textbox', { name: 'New category name' }).fill('Mobile code');
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByRole('button', { name: 'Mobile code', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close categories' }).click();
  await page.getByRole('button', { name: '1 image per add' }).click();
  await page.getByRole('button', { name: 'Add 1 random image here' }).first().click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to project' }).click();
  await expect(page.getByRole('heading', { name: 'Mobile sort' })).toBeVisible();
});

test('keeps large-pile navigation usable without visible scrollbars or accidental text selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New project name' }).fill('Navigation study');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(
    Array.from({ length: 30 }, (_, index) => ({ name: `${index}.png`, mimeType: 'image/png', buffer: tinyPng }))
  );
  await expect(page.getByRole('status').filter({ hasText: '30 images added' })).toBeVisible();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  const board = page.getByTestId('board-root');
  const pile = page.getByRole('region', { name: 'Image pile' });
  const pileScroll = pile.locator('.sorting-workspace__tray-scroll');
  await expect(pile.locator('.card--sort')).toHaveCount(30);
  expect(await board.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar').display)).toBe('none');
  expect(await pileScroll.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar').display)).toBe('none');
  const image = pile.locator('.cardPreview__img').first();
  await expect(image).toBeVisible();
  expect(await image.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await pile.locator('.card--sort').first().evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  expect(await page.getByRole('textbox', { name: 'New category name' }).evaluate((element) => getComputedStyle(element).userSelect)).toBe('text');

  const bounds = (await pileScroll.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 70);
  await page.mouse.wheel(0, 480);
  await expect.poll(async () => pileScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Scroll pile left' }).click();
  await expect.poll(async () => pileScroll.evaluate((element) => element.scrollLeft)).toBe(0);
  await page.getByRole('button', { name: 'Scroll pile right' }).click();
  await expect.poll(async () => pileScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const header = pile.getByRole('button', { name: 'Explore image pile' });
  const start = (await header.boundingBox())!;
  const end = (await page.getByRole('button', { name: 'Clear board' }).boundingBox())!;
  await page.mouse.move(start.x + 8, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});

test('draws the selection outline around the displayed image in board and pile', async ({ page }) => {
  const svg = (width: number, height: number) => Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#a8c9b0"/></svg>`
  );
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New project name' }).fill('Image bounds');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles([
    { name: 'wide.svg', mimeType: 'image/svg+xml', buffer: svg(240, 120) },
    { name: 'tall.svg', mimeType: 'image/svg+xml', buffer: svg(120, 240) },
  ]);
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await page.getByRole('button', { name: 'Add up to 3 random images here' }).first().click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  const wide = board.getByRole('group', { name: 'Card: wide.svg' });
  await wide.locator('img').evaluate((image: HTMLImageElement) => image.decode());
  await wide.click();
  await expect.poll(async () => wide.evaluate((card) => {
    const outline = getComputedStyle(card, '::after');
    return [parseFloat(outline.width), parseFloat(outline.height)];
  })).toEqual([172, 86]);

  const tall = board.getByRole('group', { name: 'Card: tall.svg' });
  await tall.click();
  await page.getByRole('button', { name: 'Return to pile' }).click();
  const pileTall = page.getByRole('region', { name: 'Image pile' }).getByRole('group', { name: 'Card: tall.svg' });
  await pileTall.locator('img').evaluate((image: HTMLImageElement) => image.decode());
  await pileTall.click();
  await expect.poll(async () => pileTall.evaluate((card) => {
    const outline = getComputedStyle(card, '::after');
    return [parseFloat(outline.width), parseFloat(outline.height)];
  })).toEqual([56, 112]);
});

test('keeps a large image pile navigable without mounting every card', async ({ page }) => {
  await mockClipInference(page);
  await page.goto('/');
  // Seed metadata directly so this test isolates rendering and also works in
  // Playwright WebKit, whose IndexedDB runner cannot store File objects.
  await page.evaluate(async (clip) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sortboard-image-library-minimal', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const projectId = 'large-pile';
    const now = Date.now();
    const transaction = db.transaction(['projects', 'images', 'meta'], 'readwrite');
    transaction.objectStore('projects').put({ id: projectId, name: 'Large pile', createdAt: now, updatedAt: now }, projectId);
    transaction.objectStore('meta').put(projectId, 'activeProjectId');
    for (let index = 0; index < 3000; index++) {
      const id = `large-pile-${index}`;
      transaction.objectStore('images').put({ id, projectId, path: `image-${index}.png`, mime: 'image/png', size: 1,
        addedAt: now, categoryId: null, placement: 'tray', fileModifiedAt: null, clip,
        visual: { version: 1, width: 120, height: 80, hash: (index % 100).toString(16).padStart(16, '0') } }, id);
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }, packVector(normalizeVector(Float32Array.from({ length: 512 }, (_, index) => index === 0 ? 1 : 0))));
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();

  const pile = page.getByRole('region', { name: 'Image pile' });
  const cards = pile.locator('.card--sort');
  const scroll = pile.locator('.sorting-workspace__tray-scroll');
  await expect.poll(() => cards.count()).toBeGreaterThan(0);
  expect(await cards.count()).toBeLessThan(60);

  await page.getByRole('combobox', { name: 'Pile order' }).selectOption('similarity');
  await expect(page.getByRole('button', { name: 'Add up to 3 images here' }).first()).toBeEnabled();
  expect(await cards.count()).toBeLessThan(60);
  await expect(pile.getByRole('group', { name: 'Card: image-0.png', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Pile order' }).selectOption('semantic');
  await expect(page.getByRole('region', { name: 'CLIP indexing' })).toContainText('CLIP 3000 / 3000 indexed');
  expect(await cards.count()).toBeLessThan(60);
  expect(await page.evaluate(() => (window as unknown as { clipCounts: { models: number; embeds: number } }).clipCounts.models)).toBe(0);
  await page.getByRole('button', { name: 'Shuffle pile' }).click();
  const initialCard = await cards.first().getAttribute('data-testid');

  await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => cards.first().getAttribute('data-testid')).not.toBe(initialCard);
  expect(await cards.count()).toBeLessThan(60);

  const visibleCardId = await scroll.evaluate((element) => {
    const viewport = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>('.card--sort')]
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= viewport.left + 40 && rect.right <= viewport.right - 20;
      })
      .at(-1)?.dataset.testid;
  });
  expect(visibleCardId).toBeTruthy();
  const cardBounds = (await pile.getByTestId(visibleCardId!).boundingBox())!;
  const boardBounds = (await page.getByRole('region', { name: 'Sorting board area' }).boundingBox())!;
  await page.mouse.move(cardBounds.x + cardBounds.width / 2, cardBounds.y + cardBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(boardBounds.x + 210, boardBounds.y + 230, { steps: 12 });
  await expect(page.locator('.sorting-workspace__drag-ghost')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(1);

  await page.getByRole('button', { name: 'Shuffle pile' }).click();
  expect(await cards.count()).toBeLessThan(60);
  await page.getByRole('button', { name: 'Add up to 3 random images here' }).first().click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(4);
  expect(await cards.count()).toBeLessThan(60);
});

test('explores the whole pile, preserves marks across views, and adds them without changing categories', async ({ page }) => {
  await seedOverviewImages(page, 30);
  const overview = page.getByRole('dialog', { name: 'Explore image pile', exact: true });
  const first = overview.getByRole('checkbox', { name: 'Mark image-0000.jpg', exact: true });
  await first.click();
  await overview.getByRole('checkbox', { name: 'Mark image-0002.jpg', exact: true }).click({ modifiers: ['Shift'] });
  await expect(overview.getByRole('button', { name: 'Add 3 to board', exact: true })).toBeEnabled();
  await overview.getByRole('searchbox', { name: 'Find images' }).fill('0000');
  await expect(overview.getByRole('region', { name: 'Image overview' }).locator('[data-overview-image]')).toHaveCount(1);
  await expect(overview.getByText('2 outside this view')).toBeVisible();
  await overview.getByRole('button', { name: 'View image-0000.jpg', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview image-0000.jpg', exact: true });
  await expect(preview.locator('img')).toBeVisible();
  await expect(preview).toContainText('Scenes/Detail');
  await preview.getByRole('button', { name: 'Marked for board' }).click();
  await expect(preview.getByRole('button', { name: 'Mark for board' })).toBeVisible();
  await preview.getByRole('button', { name: 'Mark for board' }).click();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(overview).toBeVisible();
  await expect(first).toBeFocused();
  await overview.getByRole('button', { name: 'Clear search' }).click();
  await overview.getByRole('button', { name: 'Grid layout' }).click();
  await overview.getByRole('combobox', { name: 'Overview order' }).selectOption('modified');
  await overview.getByRole('button', { name: 'Back to sorting board' }).click();
  await expect(overview).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Explore image pile' })).toBeFocused();
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  await expect(overview.getByRole('button', { name: 'Grid layout' })).toHaveAttribute('aria-pressed', 'true');
  await expect(overview.getByRole('button', { name: 'Add 3 to board', exact: true })).toBeEnabled();
  await overview.getByRole('button', { name: 'Add 3 to board', exact: true }).click();
  await expect(overview).toHaveCount(0);
  const board = page.getByRole('region', { name: 'Sorting board area' });
  await expect(board.locator('.card--sort')).toHaveCount(3);
  const placed = (await savedImages(page)).filter(image => image.placement === 'board');
  expect(placed.map(image => image.path).sort()).toEqual(['image-0000.jpg', 'image-0001.jpg', 'image-0002.jpg']);
  expect(placed.find(image => image.path === 'image-0000.jpg')!.categoryId).toBe('details');
  expect(placed.filter(image => image.path !== 'image-0000.jpg').every(image => image.categoryId === null)).toBe(true);
  await expect(board.getByRole('group', { name: 'Card: image-0000.jpg' })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  await overview.getByRole('combobox', { name: 'Overview image scope' }).selectOption('all');
  await expect(overview.getByRole('button', { name: 'View image-0000.jpg, on board', exact: true })).toBeVisible();
  await expect(overview.getByRole('checkbox', { name: 'Mark image-0000.jpg', exact: true })).toHaveCount(0);
  await overview.getByRole('combobox', { name: 'Overview category filter' }).selectOption('scenes');
  await expect(overview.locator('[data-overview-image]')).toHaveCount(10);
  await overview.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(board.locator('.card--sort')).toHaveCount(3);
});

test('keeps 3000 real images virtualized in the overview and after a bulk board addition', async ({ page }) => {
  test.setTimeout(90_000);
  await seedOverviewImages(page, 3000);
  const overview = page.getByRole('dialog', { name: 'Explore image pile', exact: true });
  const region = overview.getByRole('region', { name: 'Image overview' });
  const tiles = region.locator('[data-overview-image]');
  expect(await tiles.count()).toBeLessThan(120);
  await overview.getByRole('checkbox', { name: 'Mark image-0000.jpg', exact: true }).click();
  await expect.poll(() => region.locator('img').count()).toBeGreaterThan(20);
  expect(await region.locator('img').first().evaluate((image: HTMLImageElement) => Math.max(image.naturalWidth, image.naturalHeight))).toBeLessThanOrEqual(512);
  await region.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await overview.getByRole('checkbox', { name: 'Mark image-2999.jpg', exact: true }).click();
  await expect(overview.getByRole('button', { name: 'Add 2 to board', exact: true })).toBeEnabled();
  expect(await tiles.count()).toBeLessThan(120);
  const top = await region.evaluate(element => element.scrollTop);
  await overview.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeCloseTo(top, 0);
  await expect(overview.getByRole('button', { name: 'Add 2 to board', exact: true })).toBeEnabled();
  await overview.getByRole('button', { name: 'Larger overview images' }).click();
  await expect(overview.getByRole('checkbox', { name: 'Mark image-2999.jpg', exact: true })).toBeInViewport();
  await overview.getByRole('button', { name: 'Mark all', exact: true }).click();
  await expect(overview.getByRole('button', { name: 'Add 3000 to board', exact: true })).toBeEnabled();
  await overview.getByRole('button', { name: 'Add 3000 to board', exact: true }).click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  await expect.poll(async () => (await savedImages(page)).filter(image => image.placement === 'board').length).toBe(3000);
  expect(await board.locator('.card--sort').count()).toBeLessThan(100);
  await expect(page.getByRole('button', { name: 'Clear board', exact: true })).toBeEnabled();
  const cache = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction('assets');
    const keys = await new Promise<IDBValidKey[]>(resolve => { const request = transaction.objectStore('assets').getAllKeys(); request.onsuccess = () => resolve(request.result); });
    db.close(); return keys.filter(key => String(key).startsWith('thumbnail:v1:')).length;
  });
  expect(cache).toBeGreaterThan(20); expect(cache).toBeLessThan(320);
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  await expect(overview.getByRole('heading', { name: 'The pile is empty' })).toBeVisible();
  await overview.getByRole('button', { name: 'Show all images' }).click();
  expect(await tiles.count()).toBeLessThan(120);
  await overview.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.getByRole('button', { name: 'Clear board', exact: true }).click();
  await expect.poll(async () => (await savedImages(page)).filter(image => image.placement === 'board').length).toBe(0);
});

test('supports keyboard marking, range selection, navigation and focus containment in the overview', async ({ page }) => {
  await seedOverviewImages(page, 80);
  const overview = page.getByRole('dialog', { name: 'Explore image pile', exact: true });
  const first = overview.getByRole('checkbox', { name: 'Mark image-0000.jpg', exact: true });
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(overview.getByRole('checkbox', { name: 'Mark image-0001.jpg', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  const last = overview.getByRole('checkbox', { name: 'Mark image-0079.jpg', exact: true });
  await expect(last).toBeFocused();
  await page.keyboard.press('Space');
  await expect(overview.getByRole('button', { name: 'Add 2 to board', exact: true })).toBeEnabled();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('dialog', { name: 'Preview image-0079.jpg', exact: true });
  await expect(preview).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'Preview image-0078.jpg', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overview).toBeVisible();
  await overview.getByRole('searchbox', { name: 'Find images' }).fill('image-000');
  await overview.getByRole('button', { name: 'Mark all matches', exact: true }).click();
  await expect(overview.getByRole('button', { name: 'Add 11 to board', exact: true })).toBeEnabled();
  await overview.getByRole('button', { name: 'Clear', exact: true }).click();
  const back = overview.getByRole('button', { name: 'Back to sorting board' });
  await back.focus(); await page.keyboard.press('Shift+Tab');
  await expect(overview.getByRole('slider', { name: 'Browse image collection' })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(back).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(overview).toHaveCount(0);
});

test('keeps the overview usable on mobile with scrolling, sizing, preview and bulk selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedOverviewImages(page, 80);
  const overview = page.getByRole('dialog', { name: 'Explore image pile', exact: true });
  for (const control of [overview.getByRole('combobox', { name: 'Overview order' }), overview.getByRole('slider', { name: 'Overview image size' }), overview.getByRole('button', { name: 'Back to sorting board' }), overview.getByRole('button', { name: 'Add marked to board' })]) await expect(control).toBeInViewport({ ratio: 1 });
  expect(await overview.evaluate(element => element.scrollWidth)).toBe(390);
  await overview.getByRole('button', { name: 'Smaller overview images' }).click();
  await expect(overview.getByRole('slider', { name: 'Overview image size' })).toHaveValue('104');
  await overview.getByRole('button', { name: 'Show overview filters' }).click();
  await expect(overview.getByRole('searchbox', { name: 'Find images' })).toBeInViewport({ ratio: 1 });
  await overview.getByRole('button', { name: 'Hide overview filters' }).click();
  await overview.getByRole('checkbox', { name: 'Mark image-0000.jpg', exact: true }).click();
  await overview.getByRole('button', { name: 'View image-0000.jpg', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview image-0000.jpg', exact: true });
  await expect(preview.locator('img')).toBeInViewport({ ratio: 1 });
  await preview.getByRole('button', { name: 'Close preview' }).click();
  const scroll = overview.getByRole('region', { name: 'Image overview' });
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await overview.getByRole('checkbox', { name: 'Mark image-0079.jpg', exact: true }).click();
  await expect(overview.getByRole('button', { name: 'Add 2 to board', exact: true })).toBeInViewport({ ratio: 1 });
  await overview.getByRole('button', { name: 'Add 2 to board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(2);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});
