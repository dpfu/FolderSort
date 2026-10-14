import { mockClipInference } from './clipFixtures';
import { openBoardActions, openWorkspaceExport, openBoardTools, zoomBoard, createBoardStash, backToProject, openProjectActions, openProjectStashes, openBrowserFilters, browserOptions, moveReviewedImage, openProjectImage, closeProjectImage, hideBrowserFilters, browserImageSize, browserSelectAll } from './menuBar';
import { choosePileOrder, openPileOptions } from './pileDock';
import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { CLIP_CACHE_KEY, normalizeVector, packVector } from '../src/contentSimilarity';

const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function readPng(page: Page, buffer: Buffer, points: Array<{ x: number; y: number }> = []) {
  return page.evaluate(async ({ base64, points }) => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, pixels: points.map(point => [...ctx.getImageData(point.x, point.y, 1, 1).data]) };
  }, { base64: buffer.toString('base64'), points });
}

async function sortedExport(page: Page, format: 'ZIP' | 'folder' = 'ZIP') {
  await openWorkspaceExport(page);
  await page.getByRole('button', { name: `Export sorted ${format}` }).click();
}

async function stableCard(card: Locator) {
  await card.evaluate(async element => {
    let previous = element.getBoundingClientRect(), stable = 0;
    for (let frame = 0; frame < 120 && stable < 4; frame++) {
      await new Promise(requestAnimationFrame);
      const rect = element.getBoundingClientRect();
      stable = Math.abs(rect.x - previous.x) + Math.abs(rect.y - previous.y) < .1 ? stable + 1 : 0;
      previous = rect;
    }
  });
}

async function expectInsideBoard(card: Locator) {
  // IntersectionObserver can report .99999988 for a fully visible transformed
  // image. Verify real board bounds as well, allowing only half-pixel rounding.
  await expect(card).toBeInViewport({ ratio: .999 });
  await expect.poll(() => card.evaluate(element => {
    const image = element.getBoundingClientRect();
    const board = element.closest('.sorting-workspace__board')!.getBoundingClientRect();
    return image.left >= board.left - .5 && image.right <= board.right + .5 &&
      image.top >= board.top - .5 && image.bottom <= board.bottom + .5;
  })).toBe(true);
}

async function seedOverviewImages(page: Page, count: number) {
  await page.goto('/');
  await expect(page.locator('input[type=file][accept="image/*"]')).toHaveCount(1);
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
  await openBrowserFilters(page); await page.getByRole('combobox', { name: 'Overview order' }).selectOption('name');

  await page.getByRole('combobox', { name: 'Overview image scope' }).selectOption('all');
  await hideBrowserFilters(page);
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
    const images = await new Promise<Array<{ id: string; path: string; categoryId: string | null; placement?: string; boardX?: number; boardY?: number; clip?: { model: string; vector: string }; fileModifiedAt?: number; visual?: { version: number; hash: string; width: number; height: number } }>>((resolve) => {
      const request = db.transaction('images').objectStore('images').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return images;
  });
}

/** Replace only model loading/inference. Cache decoding, ordering and neighbour
 * ranking still run in the real worker. CI never downloads AI models. */
test('CLIP is optional, resumable, cached in backups, and shared by pile and board matching', async ({ page }) => {
  await mockClipInference(page);
  const modelRequests: string[] = [];
  await page.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, (route) => { modelRequests.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await importSimilarityFixtures(page);
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  const counts = () => page.evaluate(() => (window as unknown as { clipCounts: { workers: number; models: number; embeds: number } }).clipCounts);
  expect(await counts()).toEqual({ workers: 0, models: 0, embeds: 0 });
  const order = page.locator('select[aria-label="Pile order"]');
  const method = page.locator('select[aria-label="Similarity method"]');
  const index = page.getByRole('region', { name: 'CLIP indexing' });
  await choosePileOrder(page, 'semantic');
  await openBoardTools(page);
  await expect(method).toHaveValue('clip');
  await expect.poll(async () => (await counts()).embeds).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause CLIP indexing' }).click();
  await expect(index).toContainText('paused');
  await expect.poll(async () => (await savedImages(page)).filter((image) => image.clip).length).toBeGreaterThan(0);
  const paused = (await counts()).embeds;
  await zoomBoard(page, 'in');
  await expect(page.getByRole('group', { name: 'Board zoom' })).toContainText('115%');
  await openBoardTools(page);
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
  await openBrowserFilters(page);
  await expect(overview.getByRole('combobox', { name: 'Overview order' })).toHaveValue('semantic');
  await expect(overview.getByRole('checkbox')).toHaveCount(4);
  await overview.getByRole('button', { name: 'Reverse overview order' }).click();
  await expect(overview.getByRole('button', { name: 'Reverse overview order' })).toHaveAttribute('aria-pressed', 'true');
  await overview.getByRole('button', { name: 'Reverse overview order' }).click();
  await overview.getByRole('button', { name: 'Back to sorting board' }).click();
  await expect.poll(names).toEqual(['a-source.png', 'z-variant.png', 'b-other.png', 'y-other-variant.png']);
  await page.getByRole('combobox', { name: 'Images per add' }).selectOption('1');
  await page.getByRole('button', { name: 'Add next 1 image' }).first().click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  await board.getByRole('group', { name: 'Card: a-source.png' }).click();
  await page.getByRole('button', { name: 'Add similar to selected image' }).click();
  await expectInsideBoard(board.getByRole('group', { name: 'Card: z-variant.png' }));
  expect((await savedImages(page)).every((image) => image.categoryId === null)).toBe(true);
  await backToProject(page);
  const download = page.waitForEvent('download');
  await openProjectActions(page); await page.getByRole('button', { name: 'Backup ZIP' }).click();
  const backup = await download;
  const manifest = JSON.parse(await (await JSZip.loadAsync(await fs.readFile(await backup.path()))).file('project.json')!.async('string'));
  expect(manifest.images.every((image: { clip: { model: string; vector: string } }) => image.clip.model === CLIP_CACHE_KEY && image.clip.vector.length === 2732)).toBe(true);
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(await backup.path());
  await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await choosePileOrder(page, 'semantic');
  await openBoardTools(page);
  await expect(index).toContainText('CLIP 4 / 4 indexed');
  await page.getByRole('combobox', { name: 'Images per add' }).selectOption('1');
  await openBoardTools(page);
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
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  const method = page.locator('select[aria-label="Similarity method"]');
  await openBoardTools(page);
  await expect(method).toBeInViewport();
  await method.selectOption('clip');
  await expect(page.getByRole('region', { name: 'CLIP indexing' })).toContainText('CLIP unavailable: Model download failed');
  await expect(page.getByRole('button', { name: 'Retry CLIP indexing' })).toBeInViewport();
  await page.getByRole('button', { name: 'Add 3 random images' }).first().click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(3);
  await openBoardTools(page);
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
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  const pile = page.getByRole('region', { name: 'Image pile' });
  const board = page.getByRole('region', { name: 'Sorting board area' });
  const order = page.locator('select[aria-label="Pile order"]');
  expect(await page.evaluate(() => (window as unknown as { analysisCounts: { analyze: number } }).analysisCounts.analyze)).toBe(0);
  await choosePileOrder(page, 'similarity');
  await expect.poll(async () => (await savedImages(page)).filter((image) => image.visual).length).toBe(4);
  const names = () => pile.locator('.card--sort').evaluateAll((cards) => [...cards].sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x).map((card) => card.getAttribute('aria-label')!.replace('Card: ', '')));
  await expect.poll(names).toEqual(['a-source.png', 'z-variant.png', 'b-other.png', 'y-other-variant.png']);

  await choosePileOrder(page, 'modified');
  await expect.poll(names).toEqual(['z-variant.png', 'y-other-variant.png', 'b-other.png', 'a-source.png']);
  await openPileOptions(page); await page.getByRole('button', { name: 'Reverse pile order' }).click();
  await expect.poll(names).toEqual(['a-source.png', 'b-other.png', 'y-other-variant.png', 'z-variant.png']);
  await choosePileOrder(page, 'resolution');
  await expect.poll(names).toEqual(['y-other-variant.png', 'z-variant.png', 'a-source.png', 'b-other.png']);
  await choosePileOrder(page, 'aspect');
  await expect.poll(names).toEqual(['b-other.png', 'y-other-variant.png', 'a-source.png', 'z-variant.png']);
  await choosePileOrder(page, 'name');
  await expect.poll(names).toEqual(['a-source.png', 'b-other.png', 'y-other-variant.png', 'z-variant.png']);
  await page.getByRole('combobox', { name: 'Images per add' }).selectOption('1');
  await page.getByRole('button', { name: 'Add next 1 image' }).first().click();
  const source = board.getByRole('group', { name: 'Card: a-source.png' });
  await source.click();
  await page.getByRole('button', { name: 'Add similar to selected image' }).click();
  await expect(board.getByRole('group', { name: 'Card: z-variant.png' })).toBeVisible();
  await expect(board.getByRole('group', { name: 'Card: z-variant.png' })).toBeInViewport({ ratio: 1 });
  await expect(board.locator('.card--sort')).toHaveCount(2);
  await openBoardTools(page);
  await page.getByRole('button', { name: 'Add similar to board' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No close visual matches left' })).toBeVisible();
  await expect(board.locator('.card--sort')).toHaveCount(2);

  await pile.getByRole('group', { name: 'Card: b-other.png' }).click();
  await openBoardActions(page); await page.getByRole('button', { name: 'Add to board', exact: true }).click();
  await expect(board.locator('.card--sort')).toHaveCount(3);
  await openBoardTools(page);
  await page.getByRole('button', { name: 'Add similar to board' }).click();
  await expect(board.getByRole('group', { name: 'Card: y-other-variant.png' })).toBeVisible();
  await expect(board.locator('.card--sort')).toHaveCount(4);
  expect((await savedImages(page)).every((image) => image.categoryId === null)).toBe(true);

  const cached = await savedImages(page);
  await backToProject(page);
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await openBoardActions(page);
  await page.getByRole('button', { name: 'Clear board' }).click();
  await choosePileOrder(page, 'similarity');
  await expect.poll(names).toEqual(['a-source.png', 'z-variant.png', 'b-other.png', 'y-other-variant.png']);
  expect(await page.evaluate(() => (window as unknown as { analysisCounts: { analyze: number } }).analysisCounts.analyze)).toBe(4);
  await backToProject(page);
  const download = page.waitForEvent('download');
  await openProjectActions(page); await page.getByRole('button', { name: 'Backup ZIP' }).click();
  const backup = await download;
  const zip = await JSZip.loadAsync(await fs.readFile(await backup.path()));
  const manifest = JSON.parse(await zip.file('project.json')!.async('string'));
  expect(manifest.images.find((image: { path: string }) => image.path === 'z-variant.png').fileModifiedAt).toBe(100);
  expect(manifest.images.find((image: { path: string }) => image.path === 'z-variant.png').visual.width).toBe(640);
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(await backup.path());
  await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await choosePileOrder(page, 'similarity');
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
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  const order = page.locator('select[aria-label="Pile order"]');
  await openPileOptions(page);
  await expect(order).toBeInViewport();
  await choosePileOrder(page, 'similarity');
  await expect.poll(async () => (await savedImages(page)).filter((image) => image.visual).length).toBe(4);
  await expect(page.getByRole('combobox', { name: 'Images per add' })).toBeInViewport();
  await page.getByRole('combobox', { name: 'Images per add' }).selectOption('1');
  await page.getByRole('button', { name: 'Add next 1 image' }).first().click();
  await openBoardTools(page);
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
    await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
    for (let step = 0; step < Math.abs(zoomSteps); step++) {
      await zoomBoard(page, zoomSteps < 0 ? 'out' : 'in');
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
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Explore project images' })).toBeVisible();
  await openProjectImage(page, 'sample.png');
  await expect(page.getByRole('dialog', { name: 'Preview sample.png' })).toBeVisible();
  await closeProjectImage(page);

  const downloadPromise = page.waitForEvent('download');
  await openProjectActions(page); await page.getByRole('button', { name: 'Backup ZIP' }).click();
  const exported = await downloadPromise;
  expect(exported.suggestedFilename()).toBe('Synthetic-study.zip');
  const currentZip = await JSZip.loadAsync(await fs.readFile(await exported.path()));
  expect(JSON.parse(await currentZip.file('project.json')!.async('string')).format).toBe('folder-sort-project');
  await page.locator('.library-project-management summary').click();
  await page.getByRole('button', { name: 'Import project ZIP' }).click();
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(await exported.path());
  await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore project images' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: 'Explore project images' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Synthetic study' })).toHaveCount(3);
});

test('starts sorting on first import, keeps later additions in the library, and waits for valid images', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toContainText('No supported images');
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toHaveCount(0);
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'one.png', mimeType: 'image/png', buffer: tinyPng });
  const workspace = page.getByRole('main', { name: 'Sorting workspace' });
  await expect(workspace).toBeVisible();
  await expect(workspace).toBeFocused();
  await expect(page.getByRole('region', { name: 'Image pile' }).locator('.card--sort')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(0);
  await backToProject(page);
  const files = page.locator('input[type=file][accept="image/*"]');
  await files.setInputFiles({ name: 'one.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(page.getByRole('status').filter({ hasText: '0 images added' })).toBeVisible();
  await expect(workspace).toHaveCount(0);
  await files.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.getByRole('alert')).toContainText('No supported images');
  await expect(workspace).toHaveCount(0);
  await files.setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(page.getByRole('status').filter({ hasText: '1 image added' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore project images' })).toBeVisible();
  await expect(workspace).toHaveCount(0);
  await page.locator('.library-project-management summary').click();
  await page.getByRole('textbox', { name: 'New project name' }).fill('Second collection');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Project created' })).toBeVisible();
  await files.setInputFiles({ name: 'three.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(workspace).toBeVisible();
  await expect(page.getByRole('region', { name: 'Image pile' }).getByRole('group', { name: 'Card: three.png', exact: true })).toBeVisible();
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
    const choice = page.getByRole('dialog', { name: 'Choose starting stashes' });
    await expect(choice).toContainText('1 image');
    await expect(choice).not.toContainText('metadata');
    await choice.getByRole('button', { name: 'Start fresh · ignore subfolders' }).click();
    await expect(page.getByRole('status').filter({ hasText: '1 image added' })).toBeVisible();
    await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
    await backToProject(page);
    await expect(page.locator('.project-stashes__list button')).toHaveCount(0);
    await openProjectImage(page, 'source-images/nested/sample.png');
    await expect(page.getByRole('dialog', { name: 'source-images/nested/sample.png' })).toBeVisible();
    await closeProjectImage(page);

    const downloadPromise = page.waitForEvent('download');
    await openProjectActions(page); await page.getByRole('button', { name: 'Backup ZIP' }).click();
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
    await expect(page.getByRole('button', { name: 'Explore project images' })).toBeVisible();
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
    await page.locator('.project-help summary').click(); await expect(page.getByRole('region', { name: 'How Folder Sort works' })).toContainText('each image in one stash or sub-stash');
    await page.locator('input[webkitdirectory]').first().setInputFiles(source);
    const prompt = page.getByRole('dialog', { name: 'Choose starting stashes' });
    await expect(prompt).toContainText('topic/subtopic');
    await expect(page.getByRole('main', { name: 'Sorting workspace' })).toHaveCount(0);
    await prompt.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(prompt).toHaveCount(0);
    await expect(page.getByRole('main', { name: 'Sorting workspace' })).toHaveCount(0);
    await page.locator('input[webkitdirectory]').first().setInputFiles(source);
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Keep subfolders as stashes' }).click();
    await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
    await backToProject(page);

    await expect(page.getByRole('heading', { name: 'collection', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'collection' })).toHaveCount(1);
    await openProjectStashes(page);
    const parentSelect = page.getByRole('combobox', { name: 'Parent stash' });
    await expect(parentSelect.getByRole('option', { name: 'topic', exact: true })).toHaveCount(1);
    await expect(parentSelect.getByRole('option', { name: 'topic/subtopic' })).toHaveCount(1);
    await parentSelect.selectOption({ label: 'topic' });
    await page.getByRole('textbox', { name: 'New stash name' }).fill('another');
    await page.getByRole('button', { name: 'Create stash', exact: true }).click();
    await expect(parentSelect.getByRole('option', { name: 'topic/another' })).toHaveCount(1);

    page.once('dialog', (dialog) => dialog.accept('renamed'));
    await page.getByTitle('Rename topic', { exact: true }).click();
    await expect(parentSelect.getByRole('option', { name: 'renamed/subtopic' })).toHaveCount(1);
    await expect(parentSelect.getByRole('option', { name: 'renamed/another' })).toHaveCount(1);

    const downloadPromise = page.waitForEvent('download');
    await sortedExport(page);
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
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  await backToProject(page);
  await openProjectStashes(page);
  for (const name of ['A?', 'A_', 'A_/Child']) {
    if (name.includes('/')) await page.getByRole('combobox', {name: 'Parent stash'}).selectOption({label: name.split('/').slice(0, -1).join('/')});
    await page.getByRole('textbox', { name: 'New stash name' }).fill(name.split('/').at(-1)!);
    await page.getByRole('button', { name: 'Create stash', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Parent stash' }).getByRole('option', { name, exact: true })).toHaveCount(1);
  }
  for (const [filename, category] of [['a.png', 'A_'], ['b.png', 'A_/Child']]) {
    await openProjectImage(page, filename);
    await moveReviewedImage(page, category);
    await expect(page.locator('.image-review').getByRole('button', {name: 'Undo stash move'})).toBeEnabled();
    await closeProjectImage(page);
  }
  const downloadPromise = page.waitForEvent('download');
  await sortedExport(page);
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
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  await backToProject(page);
  await openProjectActions(page); await page.getByRole('button', { name: 'Backup folder' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Project backup saved' })).toBeVisible();
  const writes = await page.evaluate(() => (window as unknown as { libraryTestWrites: Array<{ path: string; bytes: number }> }).libraryTestWrites);
  expect(writes).toHaveLength(2);
  expect(writes[0].path).toMatch(/^Directory-study-.*\/images\/.*\/sample\.png$/);
  expect(writes[0].bytes).toBe(tinyPng.length);
  expect(writes[1].path).toMatch(/^Directory-study-.*\/project\.json$/);
  expect(writes[1].bytes).toBeGreaterThan(0);
  await sortedExport(page, 'folder');
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
  await page.getByRole('region', { name: 'Add images', exact: true }).evaluate((dropzone) => {
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
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  await backToProject(page);
  await expect(page.getByRole('button', { name: 'Explore project images' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore project images' })).toBeVisible();
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
    const prompt = page.getByRole('dialog', { name: 'Choose starting stashes' });
    await expect(prompt).toContainText('topic/subtopic');
    await prompt.getByRole('button', { name: 'Keep subfolders as stashes' }).click();
    await expect(page.getByRole('status').filter({ hasText: '3 images added' })).toBeVisible();
    await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
    await backToProject(page);
    await openProjectStashes(page);
    const parentCategories = page.getByRole('combobox', { name: 'Parent stash' });
    await expect(parentCategories.getByRole('option', { name: 'topic/subtopic' })).toHaveCount(1);
    await expect(parentCategories.getByRole('option', { name: 'topic/other' })).toHaveCount(1);

    await openProjectImage(page, 'collection/topic/subtopic/a.png');
    await expect(page.locator('.image-review__title small')).toHaveText('topic/subtopic');
    await moveReviewedImage(page, 'topic/other');
    await expect(page.locator('.image-review').getByRole('button', {name: 'Undo stash move'})).toBeEnabled();
    await closeProjectImage(page);

    const sortedDownload = page.waitForEvent('download');
    await sortedExport(page);
    const sorted = await JSZip.loadAsync(await fs.readFile(await (await sortedDownload).path()));
    expect(sorted.file('topic/other/a.png')).not.toBeNull();
    expect(sorted.file('topic/other/a (2).png')).not.toBeNull();
    expect(sorted.file('_Unassigned/root.png')).not.toBeNull();
    expect(await sorted.file('topic/other/a.png')!.async('nodebuffer')).toEqual(tinyPng);
    const csv = await sorted.file('assignments.csv')!.async('string');
    expect(csv).toContain('"collection/topic/subtopic/a.png","topic/other","topic/other/a (2).png"');

    await openProjectStashes(page);
    page.once('dialog', (dialog) => dialog.accept('Reviewed'));
    await page.getByRole('button', { name: /topic\/other 2/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Stash renamed' })).toBeVisible();
    await expect(page.getByTitle('Rename Reviewed', {exact:true})).toBeVisible();

    const backupDownload = page.waitForEvent('download');
    await openProjectActions(page); await page.getByRole('button', { name: 'Backup ZIP' }).click();
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
    await openProjectStashes(page); await expect(page.getByRole('combobox', { name: 'Parent stash' }).getByRole('option', { name: 'topic', exact: true })).toHaveCount(1);
    await openProjectImage(page, 'collection/topic/subtopic/a.png');
    await expect(page.locator('.image-review__title small')).toHaveText('Reviewed');
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
  await openProjectImage(page, 'old.png');
  await expect(page.locator('.image-review__title small')).toHaveText('Unsorted');
  await closeProjectImage(page);
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Image pile' }).locator('.card--sort')).toHaveCount(0);
});

test('drags between pile and board, returns a card, and restores working-board placement from ZIP', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(['one.png','two.png','three.png'].map(name => ({ name, mimeType:'image/png',buffer:tinyPng })));
  const board = page.getByRole('region',{name:'Sorting board area'}),pile=page.getByRole('region',{name:'Image pile'});
  const source=pile.getByRole('group',{name:'Card: two.png'});
  await dragKeepingGrabPoint(page,source,board.getByRole('group',{name:'Card: two.png'}),{x:320,y:240});
  const before=(await savedImages(page)).find(image=>image.path==='two.png')!;
  await board.getByRole('group',{name:'Card: two.png'}).click();
  await openBoardActions(page); await page.getByRole('button', { name: 'Return selected images to pile' }).click();
  await expect(board.locator('.card')).toHaveCount(0);await page.getByRole('button',{name:'Undo clear'}).click();
  await expect(board.getByRole('group',{name:'Card: two.png'})).toBeVisible();
  await backToProject(page);
  const download=page.waitForEvent('download');await openProjectActions(page); await page.getByRole('button', { name: 'Backup ZIP' }).click();const backup=await download;
  const manifest=JSON.parse(await (await JSZip.loadAsync(await fs.readFile(await backup.path()))).file('project.json')!.async('string'));
  expect(manifest.images.find((image:{path:string})=>image.path==='two.png')).toMatchObject({placement:'board',boardX:before.boardX,boardY:before.boardY,boardScope:null});
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(await backup.path());await expect(page.getByRole('status').filter({hasText:'Project imported'})).toBeVisible();
  await page.getByRole('button',{name:'Open sorting workspace'}).click();await expect(board.getByRole('group',{name:'Card: two.png'})).toBeVisible();
  expect((await savedImages(page)).find(image=>image.path==='two.png')).toMatchObject({placement:'board',boardX:before.boardX,boardY:before.boardY,boardScope:null});
});

test('keeps large-pile navigation usable without visible scrollbars or accidental text selection', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New project name' }).fill('Navigation study');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(
    Array.from({ length: 30 }, (_, index) => ({ name: `${index}.png`, mimeType: 'image/png', buffer: tinyPng }))
  );
  await expect(page.getByRole('status').filter({ hasText: '30 images added' })).toBeVisible();
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
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
  await openPileOptions(page);
  expect(await page.getByRole('combobox', { name: 'Pile order' }).evaluate((element) => getComputedStyle(element).userSelect)).toBe('text');

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
  await openBoardActions(page);
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
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Add remaining 2' }).click();
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
  await openBoardActions(page); await page.getByRole('button', { name: 'Return selected images to pile' }).click();
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

  await choosePileOrder(page, 'similarity');
  await expect(page.getByRole('button', { name: 'Add next 3 images' }).first()).toBeEnabled();
  expect(await cards.count()).toBeLessThan(60);
  await expect(pile.getByRole('group', { name: 'Card: image-0.png', exact: true })).toBeVisible();
  await choosePileOrder(page, 'semantic');
  await openBoardTools(page);
  await expect(page.getByRole('region', { name: 'CLIP indexing' })).toContainText('CLIP 3000 / 3000 indexed');
  expect(await cards.count()).toBeLessThan(60);
  expect(await page.evaluate(() => (window as unknown as { clipCounts: { models: number; embeds: number } }).clipCounts.models)).toBe(0);
  await openPileOptions(page); await page.getByRole('button', { name: 'Shuffle pile' }).click();
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

  await openPileOptions(page); await page.getByRole('button', { name: 'Shuffle pile' }).click();
  expect(await cards.count()).toBeLessThan(60);
  await page.getByRole('button', { name: 'Add 3 random images' }).first().click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(4);
  expect(await cards.count()).toBeLessThan(60);
});

test('explores the whole pile, preserves marks across views, and adds them without changing categories', async ({ page }) => {
  await seedOverviewImages(page, 30);
  const overview = page.getByRole('dialog', { name: 'Explore image pile', exact: true });
  const first = overview.getByRole('checkbox', { name: 'Select image-0000.jpg', exact: true });
  await first.click();
  await overview.getByRole('checkbox', { name: 'Select image-0002.jpg', exact: true }).click({ modifiers: ['Shift'] });
  await expect(overview.getByRole('button', { name: 'Add selected to board', exact: true })).toBeEnabled();
  await openBrowserFilters(page); await overview.getByRole('searchbox', { name: 'Find images' }).fill('0000');
  await expect(overview.getByRole('region', { name: 'Image overview' }).locator('[data-overview-image]')).toHaveCount(1);
  await expect(overview.getByText('2 outside this view')).toBeVisible();
  await overview.getByRole('button', { name: 'View image-0000.jpg', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview image-0000.jpg', exact: true });
  await expect(preview.locator('img')).toBeVisible();
  await expect(preview).toContainText('Scenes/Detail');
  await preview.getByRole('button', { name: 'Select for board' }).click();
  await expect(preview.getByRole('button', { name: 'Select for board' })).toBeVisible();
  await preview.getByRole('button', { name: 'Select for board' }).click();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(overview).toBeVisible();
  await expect(first).toBeFocused();
  await overview.getByRole('button', { name: 'Clear search' }).click();
  await browserOptions(page); await overview.getByRole('button', { name: 'Grid layout' }).click();
  await openBrowserFilters(page); await overview.getByRole('combobox', { name: 'Overview order' }).selectOption('modified');
  await overview.getByRole('button', { name: 'Back to sorting board' }).click();
  await expect(overview).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Explore image pile' })).toBeFocused();
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  await expect(overview.locator('.pile-overview__canvas')).toHaveClass(/canvas--grid/);
  await expect(overview.getByRole('button', { name: 'Add selected to board', exact: true })).toBeEnabled();
  await overview.getByRole('button', { name: 'Add selected to board', exact: true }).click();
  await expect(overview).toHaveCount(0);
  const board = page.getByRole('region', { name: 'Sorting board area' });
  await expect(board.locator('.card--sort')).toHaveCount(3);
  const placed = (await savedImages(page)).filter(image => image.placement === 'board');
  expect(placed.map(image => image.path).sort()).toEqual(['image-0000.jpg', 'image-0001.jpg', 'image-0002.jpg']);
  expect(placed.find(image => image.path === 'image-0000.jpg')!.categoryId).toBe('details');
  expect(placed.filter(image => image.path !== 'image-0000.jpg').every(image => image.categoryId === null)).toBe(true);
  await expectInsideBoard(board.getByRole('group', { name: 'Card: image-0000.jpg' }));
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  await openBrowserFilters(page); await overview.getByRole('combobox', { name: 'Overview image scope' }).selectOption('all');
  await expect(overview.getByRole('checkbox', { name: 'Select image-0000.jpg', exact: true })).toBeVisible();
  await expect(overview.locator('[data-overview-image=overview-0]')).toHaveClass(/is-on-board/);
  await openBrowserFilters(page); await overview.getByRole('combobox', { name: 'Overview stash filter' }).selectOption('scenes');
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
  await overview.getByRole('checkbox', { name: 'Select image-0000.jpg', exact: true }).click();
  await expect.poll(() => region.locator('img').count()).toBeGreaterThan(20);
  expect(await region.locator('img').first().evaluate((image: HTMLImageElement) => Math.max(image.naturalWidth, image.naturalHeight))).toBeLessThanOrEqual(512);
  await region.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await overview.getByRole('checkbox', { name: 'Select image-2999.jpg', exact: true }).click();
  await expect(overview.getByRole('button', { name: 'Add selected to board', exact: true })).toBeEnabled();
  expect(await tiles.count()).toBeLessThan(120);
  const top = await region.evaluate(element => element.scrollTop);
  await overview.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeCloseTo(top, 0);
  await expect(overview.getByRole('button', { name: 'Add selected to board', exact: true })).toBeEnabled();
  await browserImageSize(page, 184);
  await expect(overview.getByRole('checkbox', { name: 'Select image-2999.jpg', exact: true })).toBeInViewport();
  await browserSelectAll(page);
  await expect(overview.getByRole('button', { name: 'Add selected to board', exact: true })).toBeEnabled();
  await overview.getByRole('button', { name: 'Add selected to board', exact: true }).click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  await expect.poll(async () => (await savedImages(page)).filter(image => image.placement === 'board').length).toBe(3000);
  expect(await board.locator('.card--sort').count()).toBeLessThan(100);
  await openBoardActions(page);
  await expect(page.getByRole('button', { name: 'Clear board', exact: true })).toBeEnabled();
  const cache = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction('assets');
    const keys = await new Promise<IDBValidKey[]>(resolve => { const request = transaction.objectStore('assets').getAllKeys(); request.onsuccess = () => resolve(request.result); });
    db.close(); return keys.filter(key => String(key).startsWith('thumbnail:v1:')).length;
  });
  expect(cache).toBeGreaterThan(20); expect(cache).toBeLessThan(320);
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  await openBrowserFilters(page); await overview.getByRole('combobox',{name:'Overview image scope'}).selectOption('pile');
  await expect(overview.getByRole('heading', { name: 'The pile is empty' })).toBeVisible();
  await overview.getByRole('button', { name: 'Show all images' }).click();
  expect(await tiles.count()).toBeLessThan(120);
  await browserSelectAll(page);
  await overview.getByRole('button', { name: 'Move selected images to stash' }).click();
  const categories = overview.getByRole('dialog', { name: 'Move to stash', exact: true });
  await categories.getByRole('button', { name: 'Move 3000 images to Scenes', exact: true }).click();
  await expect.poll(async () => (await savedImages(page)).filter(image => image.categoryId === 'scenes').length).toBe(3000);
  expect(await tiles.count()).toBeLessThan(120);
  await overview.getByRole('button', { name: 'Back to sorting board' }).click();
  await expect(board.locator('.stash-tile')).toHaveCount(1);
  await expect(board.locator('.card--sort')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open stash Scenes', exact: true }).click();
  expect(await board.locator('.card--sort').count()).toBeLessThan(100);
  await openBoardActions(page);await page.getByRole('button',{name:'Clear board',exact:true}).click();
  await expect.poll(async()=> (await savedImages(page)).filter(image=>image.placement==='board').length).toBe(0);
  expect((await savedImages(page)).every(image=>image.categoryId==='scenes')).toBe(true);
  await page.getByRole('button',{name:'Undo clear'}).click();
  await expect.poll(async()=> (await savedImages(page)).filter(image=>image.placement==='board').length).toBe(3000);
  expect(await board.locator('.card--sort').count()).toBeLessThan(100);

});

test('supports keyboard marking, range selection, navigation and focus containment in the overview', async ({ page }) => {
  await seedOverviewImages(page, 80);
  const overview = page.getByRole('dialog', { name: 'Explore image pile', exact: true });
  const first = overview.getByRole('checkbox', { name: 'Select image-0000.jpg', exact: true });
  await first.focus();
  await page.keyboard.press('Space');
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(overview.getByRole('checkbox', { name: 'Select image-0001.jpg', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  const last = overview.getByRole('checkbox', { name: 'Select image-0079.jpg', exact: true });
  await expect(last).toBeFocused();
  await page.keyboard.press('Space');
  await expect(overview.getByRole('button', { name: 'Add selected to board', exact: true })).toBeEnabled();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('dialog', { name: 'Preview image-0079.jpg', exact: true });
  await expect(preview).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'Preview image-0078.jpg', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overview).toBeVisible();
  await openBrowserFilters(page); await overview.getByRole('searchbox', { name: 'Find images' }).fill('image-000');
  await browserSelectAll(page);
  await expect(overview.getByRole('button', { name: 'Add selected to board', exact: true })).toBeEnabled();
  await overview.getByRole('button', { name: 'Deselect images', exact: true }).click();
  await overview.getByRole('button', { name: 'Clear search' }).click();
  await expect(overview.getByRole('slider', { name: 'Browse image collection' })).toBeEnabled();
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
  await expect(overview.getByRole('button', { name: 'Back to sorting board' })).toBeInViewport({ ratio: 1 });
  await openBrowserFilters(page); await expect(overview.getByRole('combobox', { name: 'Overview order' })).toBeInViewport({ ratio: 1 });
  await hideBrowserFilters(page);
  expect(await overview.evaluate(element => element.scrollWidth)).toBe(390);
  await browserImageSize(page, 104);
  await browserOptions(page); await expect(overview.getByRole('slider', { name: 'Overview image size' })).toHaveValue('104'); await page.keyboard.press('Escape');
  await openBrowserFilters(page);
  await expect(overview.getByRole('searchbox', { name: 'Find images' })).toBeInViewport({ ratio: 1 });
  await hideBrowserFilters(page);
  await overview.getByRole('checkbox', { name: 'Select image-0000.jpg', exact: true }).click();
  await overview.getByRole('button', { name: 'View image-0000.jpg', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview image-0000.jpg', exact: true });
  await expect(preview.locator('img')).toBeInViewport({ ratio: 1 });
  await preview.getByRole('button', { name: 'Close preview' }).click();
  const scroll = overview.getByRole('region', { name: 'Image overview' });
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await overview.getByRole('checkbox', { name: 'Select image-0079.jpg', exact: true }).click();
  await expect(overview.getByRole('button', { name: 'Add selected to board', exact: true })).toBeInViewport({ ratio: 1 });
  await overview.getByRole('button', { name: 'Add selected to board', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(2);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
});


test('assigns selected pile images and original previews directly with reversible batch placement', async ({ page }) => {
  await seedOverviewImages(page, 12);
  const overview = page.getByRole('dialog', { name: 'Explore image pile', exact: true });
  await overview.getByRole('checkbox', { name: 'Select image-0000.jpg', exact: true }).click();
  await overview.getByRole('checkbox', { name: 'Select image-0002.jpg', exact: true }).click({ modifiers: ['Shift'] });
  await overview.getByRole('button', { name: 'Move selected images to stash' }).click();
  const picker = overview.getByRole('dialog', { name: 'Move to stash', exact: true });
  await expect(picker.getByRole('button', { name: 'Close stash chooser' })).toBeFocused();
  await picker.getByRole('button', { name: 'Move 3 images to Scenes/Detail', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect.poll(async () => (await savedImages(page)).filter(image => image.placement === 'board').length).toBe(3);
  expect((await savedImages(page)).filter(image => image.placement === 'board').every(image => image.categoryId === 'details')).toBe(true);
  await overview.getByRole('button', { name: 'Undo stash move' }).click();
  await expect.poll(async () => (await savedImages(page)).find(image => image.id === 'overview-1')!.categoryId).toBe(null);
  expect((await savedImages(page)).filter(image => image.placement === 'board')).toHaveLength(3);
  await overview.getByRole('button', { name: 'View image-0004.jpg', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preview image-0004.jpg', exact: true }).getByRole('button', { name: 'Move image to stash' }).click();
  await picker.getByRole('textbox', { name: 'New stash name' }).fill('Nature');
  await picker.getByRole('textbox', { name: 'New stash name' }).press('Enter');
  await expect(picker).toHaveCount(0);
  const saved = (await savedImages(page)).find(image => image.id === 'overview-4')!;
  expect(saved.categoryId).toBeTruthy(); expect(saved.placement).toBe('board');
  await page.getByRole('button', { name: 'Close preview' }).click();
  await overview.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.getByRole('button',{name:'Open stash Nature',exact:true}).click();
  await expect(page.getByRole('region',{name:'Sorting board area'}).getByRole('group',{name:'Card: image-0004.jpg'})).toBeVisible();
});

test('drops a selected group on a category and selects a board area without moving images', async ({ page }) => {
  await seedOverviewImages(page, 8);
  await page.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.getByRole('button', { name: 'Add next 3 images' }).first().click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  const first = board.getByRole('group', { name: 'Card: image-0001.jpg' });
  const second = board.getByRole('group', { name: 'Card: image-0002.jpg' });
  await first.click(); await second.click({ modifiers: ['Shift'] });
  const category = page.locator('[data-stash-drop-id=scenes]');
  const from = (await first.boundingBox())!, to = (await category.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
  await expect(page.locator('.sorting-workspace__drag-count')).toHaveText('Move 2 into Scenes');
  await page.mouse.up();
  await expect.poll(async()=> (await savedImages(page)).filter(image=>image.categoryId==='scenes').length).toBe(2);
  await page.getByRole('button',{name:'Open stash Scenes',exact:true}).click();
  await page.keyboard.down('Shift');
  const bounds = [await first.boundingBox(), await second.boundingBox()].map(box => box!);
  await page.mouse.move(Math.min(...bounds.map(box => box.x)) - 15, Math.min(...bounds.map(box => box.y)) - 15);
  await page.mouse.down();
  await page.mouse.move(Math.max(...bounds.map(box => box.x + box.width)) + 15, Math.max(...bounds.map(box => box.y + box.height)) + 15, { steps: 12 });
  await expect(board.locator('.boardLasso')).toBeVisible();
  await page.mouse.up(); await page.keyboard.up('Shift');
  await expect(board.locator('.isSelected')).toHaveCount(2);
});

test('shared original review contains focus, navigates its collection and recovers from empty filters', async ({ page }) => {
  await seedOverviewImages(page, 72);
  const tile = page.getByRole('button', { name: 'View image-0000.jpg', exact: true });
  await tile.click();
  await expect(page.getByRole('button', { name: 'Close preview' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'Preview image-0001.jpg', exact: true })).toBeVisible();
  for (let index = 0; index < 10; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.library-viewer'))).toBe(true);
  }
  await moveReviewedImage(page, 'Scenes/Detail');
  await expect.poll(async () => (await savedImages(page)).find(image => image.path === 'image-0001.jpg')?.categoryId).toBe('details');
  await page.getByRole('button', { name: 'Close preview' }).focus(); await page.keyboard.press('Escape');
  await expect(page.locator('.library-viewer')).toHaveCount(0);
  await openBrowserFilters(page); await page.getByRole('searchbox', { name: 'Find images' }).fill('no-such-photo');
  await page.getByRole('button', { name: 'Show all images' }).click();
  await expect(page.getByRole('searchbox', { name: 'Find images' })).toHaveValue('');
  await expect(tile).toBeVisible();
});

test('workspace tools dismiss accessibly and sorted export keeps originals and CSV', async ({ page }) => {
  await seedOverviewImages(page, 6);
  await page.getByRole('button', { name: 'Back to sorting board' }).click();
  await expect(page.getByRole('button', { name: 'Add similar to board' })).toHaveCount(0);
  await openBoardTools(page);
  await expect(page.getByRole('combobox', { name: 'Similarity method' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Similarity method' }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.workspace-actions > summary')).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Similarity method' })).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await sortedExport(page);
  const archive = await downloading;
  expect(archive.suggestedFilename()).toBe('Overview-study-sorted.zip');
  const zip = await JSZip.loadAsync(await fs.readFile(await archive.path()));
  expect(zip.file('Scenes/Detail/image-0000.jpg')).not.toBeNull();
  expect(zip.file('_Unassigned/image-0001.jpg')).not.toBeNull();
  const csv = await zip.file('assignments.csv')!.async('string');
  expect(csv).toContain('"image-0000.jpg","Scenes/Detail","Scenes/Detail/image-0000.jpg"');
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
});

test('short landscape keeps the board and complete pile images accessible', async ({ page }) => {
  await seedOverviewImages(page, 30);
  await page.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(() => page.locator('.sorting-workspace').evaluate(element => element.getBoundingClientRect().height)).toBe(390);
  await expect(page.getByRole('region', { name: 'Sorting board area' })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Explore image pile' })).toBeInViewport({ ratio: 1 });
  await expect.poll(() => page.locator('.sorting-workspace__tray-scroll').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('.card')].every(card => {
      const rect = card.getBoundingClientRect();
      return rect.top >= bounds.top - .5 && rect.bottom <= bounds.bottom + .5;
    });
  })).toBe(true);
  await page.locator('.workspace-actions > summary').focus();
  await expect(page.locator('.workspace-actions > summary')).toBeInViewport({ ratio: 1 });
});

test('resizes a 3000-image pile, preserves browsing and selection, and remembers its size per project', async ({ page }) => {
  await seedOverviewImages(page, 3000);
  await page.getByRole('button', { name: 'Back to sorting board' }).click();
  const pile = page.getByRole('region', { name: 'Image pile' });
  const scroll = page.getByLabel('Scroll image pile', { exact: true });
  const grip = page.getByRole('separator', { name: 'Resize image pile' });
  await scroll.evaluate(element => { element.scrollLeft = 1360; });
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBe(1360);
  const before = (await pile.boundingBox())!.height;
  await grip.focus(); await page.keyboard.press('ArrowUp');
  await expect(grip).toHaveAttribute('aria-valuenow', String(before + 16));
  const gripBounds = (await grip.boundingBox())!;
  await page.mouse.move(gripBounds.x + gripBounds.width / 2, gripBounds.y + gripBounds.height / 2);
  await page.mouse.down(); await page.mouse.move(gripBounds.x + gripBounds.width / 2, gripBounds.y - 88, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await pile.boundingBox())!.height).toBeGreaterThan(before + 80);
  await page.getByLabel('Pile options', { exact: true }).click();
  const range = page.getByRole('slider', { name: 'Pile image size', exact: true });
  await range.focus(); await range.press('End');
  await expect(range).toHaveValue('240');
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(2600);
  expect(await pile.locator('.card--sort').count()).toBeLessThan(60);
  await range.press('Escape');
  await expect(page.getByLabel('Pile options', { exact: true })).toBeFocused();
  await expect(range).toBeHidden();
  const card = pile.locator('.card--sort').filter({ has: page.locator('img') }).first();
  // Choose a fully visible image after density changes and verify its image-fit
  // outline resizes too, rather than retaining the old square geometry.
  const id = await scroll.evaluate(element => {
    const viewport = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>('.card')].find(card => {
      const rect = card.getBoundingClientRect(); return rect.left >= viewport.left + 40 && rect.right <= viewport.right - 40;
    })!.dataset.testid!;
  });
  const chosen = pile.getByTestId(id);
  await stableCard(chosen); await chosen.click();
  await expect(chosen).toHaveClass(/isSelected/);
  await expect.poll(() => chosen.evaluate(element => {
    const outline = getComputedStyle(element, '::after'); return Math.max(parseFloat(outline.width), parseFloat(outline.height));
  })).toBe(240);
  // Shrinking the canvas at its far end must keep the same last images visible,
  // even though the browser clamps native scrollLeft during layout.
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(pile.getByTestId('card-overview-2999')).toBeInViewport({ ratio: 1 });
  await page.getByLabel('Pile options', { exact: true }).click();
  await range.focus(); await range.press('Home');
  await expect(range).toHaveValue('72');
  await expect(pile.getByTestId('card-overview-2999')).toBeInViewport({ ratio: 1 });
  await range.press('End'); await range.press('Escape');
  const desiredHeight = Number(await grip.getAttribute('aria-valuenow'));
  await backToProject(page);
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(grip).toHaveAttribute('aria-valuenow', String(desiredHeight));
  await expect.poll(() => card.evaluate(element => element.getBoundingClientRect().width)).toBe(240);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(grip).toHaveAttribute('aria-valuenow', String(desiredHeight));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByLabel('Pile options', { exact: true }).click();
  await range.scrollIntoViewIfNeeded();
  await expect(range).toBeInViewport({ ratio: 1 });
  await page.getByRole('slider', { name: 'Pile pane height', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('slider', { name: 'Pile pane height', exact: true })).toBeInViewport({ ratio: 1 });
  await range.focus(); await range.press('Escape');
  await expect.poll(() => scroll.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('.card')].every(card => {
      const rect = card.getBoundingClientRect(); return rect.top >= bounds.top - .5 && rect.bottom <= bounds.bottom + .5;
    });
  })).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(grip).toHaveAttribute('aria-valuenow', String(desiredHeight));
  await expect.poll(() => card.evaluate(element => element.getBoundingClientRect().width)).toBe(240);
  await backToProject(page);
  await page.locator('.library-project-management summary').click();
  await page.getByRole('textbox', { name: 'New project name' }).fill('Fresh sizes');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Project created' })).toBeVisible();
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(grip).toHaveAttribute('aria-valuenow', '235');
  await expect.poll(() => pile.locator('.card--sort').first().evaluate(element => element.getBoundingClientRect().width)).toBe(112);
});

test('resizes pile images on mobile and preserves accurate drops at the new size', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedOverviewImages(page, 72);
  await page.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.getByLabel('Pile options', { exact: true }).click();
  const range = page.getByRole('slider', { name: 'Pile image size', exact: true });
  await expect(range).toBeInViewport({ ratio: 1 });
  await range.focus(); await range.press('ArrowRight'); await range.press('ArrowRight'); await range.press('ArrowRight'); await range.press('ArrowRight'); await range.press('ArrowRight'); await range.press('ArrowRight');
  await expect(range).toHaveValue('160');
  const pane = page.getByRole('slider', { name: 'Pile pane height', exact: true });
  await pane.focus(); await pane.press('End');
  await expect(page.getByRole('region', { name: 'Sorting board area' })).toBeInViewport({ ratio: 1 });
  await range.press('Escape');
  const pile = page.getByRole('region', { name: 'Image pile' });
  const card = pile.getByRole('group', { name: 'Card: image-0001.jpg', exact: true });
  await stableCard(card);
  const bounds = (await page.getByRole('region', { name: 'Sorting board area' }).boundingBox())!;
  await dragKeepingGrabPoint(page, card, page.getByRole('region', { name: 'Sorting board area' }).getByTestId('card-overview-1'),
    { x: bounds.x + bounds.width * .87, y: bounds.y + bounds.height * .55 });
  await expect.poll(async () => (await savedImages(page)).find(image => image.id === 'overview-1')?.placement).toBe('board');
  await page.getByLabel('Pile options', { exact: true }).click();
  await page.getByRole('button', { name: 'Reset size', exact: true }).click();
  await expect(range).toHaveValue('112');
  await expect(page.getByRole('separator', { name: 'Resize image pile' })).toHaveAttribute('aria-valuenow', '239');
});

test('exports stash structure from the board and project, including empty branches and literal names',async({page})=>{
 await seedOverviewImages(page,6);await page.getByRole('button',{name:'Back to sorting board'}).click();
 await createBoardStash(page);const input=page.getByRole('textbox',{name:'Stash name',exact:true});await input.fill('Empty [notes]');await input.press('Enter');
 await openWorkspaceExport(page);const markdownDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Markdown'}).click();const markdown=await markdownDownload;
 expect(markdown.suggestedFilename()).toBe('Overview-study-stashes.md');const content=await fs.readFile(await markdown.path(),'utf8');expect(content).toContain('Empty');expect(content).toContain('- Scenes — 0 images\n  - Detail — 2 images');
 await backToProject(page);await openProjectStashes(page); await page.getByRole('button', { name: 'Export stash hierarchy' }).click();const jsonDownload=page.waitForEvent('download');await page.getByRole('button',{name:'JSON',exact:false}).click();const json=await jsonDownload;
 expect(json.suggestedFilename()).toBe('Overview-study-stashes.json');const system=JSON.parse(await fs.readFile(await json.path(),'utf8'));expect(system).toMatchObject({format:'folder-sort-categories',version:1,imageCount:6,unassignedImageCount:4});expect(system.categories.find((node:{name:string})=>node.name==='Scenes')).toMatchObject({imageCount:0,totalImageCount:2});
});

test('saves clean visible and whole-board PNGs, including virtualized images and image-fit category edges', async ({ page }) => {
  await seedOverviewImages(page, 5);
  await page.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.evaluate(async () => {
    const request = indexedDB.open('sortboard-image-library-minimal', 2);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction('images', 'readwrite');
    for (const [index, x, y] of [[0, 100, 180], [1, 375, 180], [2, 2400, 600]]) {
      const id = `overview-${index}`, store = tx.objectStore('images');
      const request = store.get(id);
      request.onsuccess = () => store.put({ ...request.result, placement: 'board', boardX: x, boardY: y, boardScope: null }, id);
    }
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(page.getByTestId('board-root').getByTestId('card-overview-2')).toHaveCount(0);
  const before = await savedImages(page);
  await openWorkspaceExport(page);
  const wholeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save whole board' }).click();
  const whole = await wholeDownload;
  expect(whole.suggestedFilename()).toBe('Overview-study-board-full.png');
  const wholeBuffer = await fs.readFile(await whole.path());
  expect([...wholeBuffer.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const rendered = await readPng(page, wholeBuffer, [
    { x: 216, y: 183 }, // Landscape photo, above its central motif.
    { x: 1200, y: 64 }, // Empty area above that landscape photo, no square card.
    { x: 4820, y: 1026 }, // Distant off-screen photo.
    { x: 196, y: 240 }, // Category edge along the actual landscape photo.
  ]);
  expect(rendered.width).toBeGreaterThanOrEqual(5072); expect(rendered.height).toBeGreaterThanOrEqual(1312);
  expect(rendered.pixels[0][0]).toBeGreaterThan(210);
  expect(rendered.pixels[1].slice(0, 3)).toEqual([24, 34, 30]);
  expect(rendered.pixels[2][0]).toBeGreaterThan(160);
  expect(Math.min(...rendered.pixels[3].slice(0, 3))).toBeGreaterThan(130);
  await expect(page.locator('.workspace-actions > summary')).toBeFocused();
  await zoomBoard(page, 'out');
  const board = page.getByTestId('board-root');
  await board.evaluate(element => element.scrollBy({ left: 40, top: 30 }));
  const size = await board.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
  await expect.poll(() => page.getByTestId('card-overview-0').locator('img').evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const photoPoint = await page.getByTestId('card-overview-0').locator('img').evaluate(element => {
    const image = element as HTMLImageElement, card = image.getBoundingClientRect(), board = image.closest('[data-testid="board-root"]')!.getBoundingClientRect();
    const scale = Math.min(card.width / image.naturalWidth, card.height / image.naturalHeight);
    const width = scale * image.naturalWidth, height = scale * image.naturalHeight;
    return { x: Math.round((card.left - board.left + (card.width - width) / 2 + width * .05) * 2),
      y: Math.round((card.top - board.top + (card.height - height) / 2 + height * .05) * 2) };
  });
  await openWorkspaceExport(page);
  const viewDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save visible board' }).click();
  const visible = await viewDownload;
  expect(visible.suggestedFilename()).toBe('Overview-study-board-view.png');
  const view = await readPng(page, await fs.readFile(await visible.path()), [{ x: 10, y: 10 }, photoPoint]);
  expect(Math.abs(view.width - size.width * 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(view.height - size.height * 2)).toBeLessThanOrEqual(1);
  expect(view.pixels[0].slice(0, 3)).toEqual([24, 34, 30]); // No close button.
  expect(view.pixels[1][0]).toBeGreaterThan(210); // Same camera and image position after zoom/pan.
  expect(await savedImages(page)).toEqual(before);
  await page.evaluate(async () => {
    const request = indexedDB.open('sortboard-image-library-minimal', 2);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction('assets', 'readwrite');
    tx.objectStore('assets').delete('overview-2'); tx.objectStore('assets').delete('thumbnail:v1:overview-2');
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  });
  await openWorkspaceExport(page);
  const missingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save whole board' }).click();
  const missing = await readPng(page, await fs.readFile(await (await missingDownload).path()));
  expect(missing.width).toBe(rendered.width);
  await expect(page.getByRole('status').filter({ hasText: '1 preview unavailable' })).toBeVisible();
});

test('keeps export actions reachable across workspace sections in a short landscape viewport', async ({ page }) => {
  await seedOverviewImages(page, 6);
  await page.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await openWorkspaceExport(page);
  const save = page.getByRole('button', { name: 'Save whole board' });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport({ ratio: 1 });
  const downloading = page.waitForEvent('download');
  await save.click();
  const exported = await readPng(page, await fs.readFile(await (await downloading).path()));
  expect(exported.width).toBeGreaterThan(0);
  await expect(page.locator('.workspace-actions > summary')).toBeFocused();
});

test('cancels a large board image export and keeps sorting and another export usable', async ({ page }) => {
  await seedOverviewImages(page, 3000);
  await browserSelectAll(page);
  await page.getByRole('button', { name: 'Add selected to board', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Explore image pile', exact: true })).toHaveCount(0);
  await openWorkspaceExport(page);
  await page.getByRole('button', { name: 'Save whole board' }).click();
  await openBoardActions(page, 'Activity');
  await page.getByRole('button', { name: 'Cancel export', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Board image export canceled' }).first()).toBeVisible();
  await zoomBoard(page, 'out');
  await openWorkspaceExport(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save visible board' }).click();
  const saved = await downloading;
  expect(saved.suggestedFilename()).toBe('Overview-study-board-view.png');
  expect((await readPng(page, await fs.readFile(await saved.path()))).width).toBeGreaterThan(0);
  expect(await page.locator('.sorting-workspace .card').count()).toBeLessThan(90);
  expect((await savedImages(page)).filter(image => image.placement === 'board')).toHaveLength(3000);
});

test('selected-image plus previews exact matches, adds colors directly and stays readable at zoom', async ({ page }) => {
  await page.goto('/');
  const colors = await page.evaluate(() => ['#e32244', '#2355d9', '#e02648', '#e4c733'].map((color, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 160;
    const context = canvas.getContext('2d')!;
    context.fillStyle = color; context.fillRect(0, 0, 240, 160);
    return { name: ['a-red.png', 'b-blue.png', 'c-red-variant.png', 'd-yellow.png'][index], data: canvas.toDataURL('image/png').split(',')[1] };
  }));
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(colors.map(file => ({ name: file.name, mimeType: 'image/png', buffer: Buffer.from(file.data, 'base64') })));
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  await choosePileOrder(page, 'name');
  await page.getByRole('combobox', { name: 'Images per add' }).selectOption('1');
  await page.getByRole('button', { name: 'Add next 1 image' }).first().click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  const source = board.getByRole('group', { name: 'Card: a-red.png' });
  await source.click();
  const before = (await savedImages(page)).find(image => image.path === 'a-red.png')!;
  const plus = page.getByRole('button', { name: 'Add similar to selected image' });
  await expect(plus).toBeInViewport();
  await plus.hover();
  const preview = page.getByRole('region', { name: 'Similar image suggestions' });
  await expect(preview).toBeVisible();
  const byColor = preview.getByRole('button', { name: 'Add similar images by color' });
  await byColor.hover();
  await expect(preview.getByRole('img', { name: 'c-red-variant.png' })).toBeVisible();
  await expect(board.locator('.card--sort')).toHaveCount(1);
  await page.screenshot({ path: '/tmp/foldersort-similar-preview.png' });
  await byColor.click();
  await expectInsideBoard(board.getByRole('group', { name: 'Card: c-red-variant.png' }));
  await expect(board.locator('.card--sort')).toHaveCount(2);
  const after = (await savedImages(page)).find(image => image.path === 'a-red.png')!;
  expect([after.boardX, after.boardY, after.categoryId]).toEqual([before.boardX, before.boardY, before.categoryId]);
  expect((await savedImages(page)).every(image => image.categoryId === null)).toBe(true);
  const width = (await plus.boundingBox())!.width;
  await zoomBoard(page, 'out');
  await expect.poll(async () => Math.abs((await plus.boundingBox())!.width - width)).toBeLessThan(1);
  await plus.focus();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(plus).toBeFocused();
  await plus.hover();
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Add similar images by color' }).hover();
  const expected = await preview.locator('img').evaluateAll(images => images.map(image => image.getAttribute('alt')));
  await plus.click();
  await expect(board.locator('.card--sort')).toHaveCount(3);
  for (const name of expected) await expect(board.getByRole('group', { name: `Card: ${name}` })).toBeVisible();
});

test('touch suggestions expose direct CLIP addition without downloading a model on hover', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await mockClipInference(page);
    await page.goto('/');
    await importSimilarityFixtures(page);
    await choosePileOrder(page, 'name');
    await page.getByRole('combobox', { name: 'Images per add' }).selectOption('1');
    await page.getByRole('button', { name: 'Add next 1 image' }).first().click();
    const board = page.getByRole('region', { name: 'Sorting board area' });
    await board.getByRole('group', { name: 'Card: a-source.png' }).click();
    const plus = page.getByRole('button', { name: 'Add similar to selected image' });
    await plus.hover();
    const preview = page.getByRole('region', { name: 'Similar image suggestions' });
    await preview.getByRole('button', { name: 'Add similar images with CLIP' }).hover();
    expect(await page.evaluate(() => (window as unknown as { clipCounts: { models: number } }).clipCounts.models)).toBe(0);
    await preview.getByRole('button', { name: 'Add similar images with CLIP' }).tap();
    await expectInsideBoard(board.getByRole('group', { name: 'Card: z-variant.png' }));
    await expect(board.locator('.card--sort')).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => (window as unknown as { clipCounts: { models: number } }).clipCounts.models)).toBe(1);
    await openBoardActions(page, 'Board view'); await page.getByRole('button', { name: 'Zoom out' }).tap();
    await plus.tap();
    await expect(preview).toBeVisible();
    await expect(board.locator('.card--sort')).toHaveCount(2);
    const rect = (await preview.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: '/tmp/foldersort-similar-mobile.png' });
    // A second tap adds the shown batch, instead of requiring drag-and-drop.
    await plus.tap();
    await expect(board.locator('.card--sort')).toHaveCount(3);
  } finally { await context.close(); }
});

test('can choose color while the contextual CLIP add is still downloading', async ({ page }) => {
  await mockClipInference(page, false, 2000);
  await page.goto('/');
  await importSimilarityFixtures(page);
  await choosePileOrder(page, 'name');
  await page.getByRole('combobox', { name: 'Images per add' }).selectOption('1');
  await page.getByRole('button', { name: 'Add next 1 image' }).first().click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  await board.getByRole('group', { name: 'Card: a-source.png' }).click();
  await page.getByRole('button', { name: 'Add similar to selected image' }).hover();
  const preview = page.getByRole('region', { name: 'Similar image suggestions' });
  await preview.getByRole('button', { name: 'Add similar images with CLIP' }).click();
  await expect(preview.locator('.similar-image-popover__previews')).toHaveAttribute('aria-busy', 'true');
  await preview.getByRole('button', { name: 'Add similar images by color' }).click();
  await expect(board.locator('.card--sort')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Add similar to selected image' })).toHaveAttribute('title', /color/i);
  await expect(page.getByRole('region', { name: 'CLIP indexing' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { clipCounts: { embeds: number } }).clipCounts.embeds)).toBe(0);
});

test('clear and restore keep exact layout and categories, including after leaving the workspace', async ({ page }) => {
  await seedOverviewImages(page, 12);
  for (const i of [0,1,2]) await page.getByRole('checkbox', {name:`Select image-${String(i).padStart(4,'0')}.jpg`,exact:true}).click();
  await page.getByRole('button', {name: 'Add selected to board', exact: true}).click();
  const board = page.getByRole('region', { name: 'Sorting board area' });
  await expect(board.locator('.card--sort')).toHaveCount(3);
  await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
  const state = async () => (await savedImages(page)).map(image => [image.id, image.categoryId, image.placement, image.boardX ?? null, image.boardY ?? null]);
  const before = await state();
  const notice = page.locator('.app-bar .undo-control').first();
  await openBoardActions(page);
  await page.getByRole('button', { name: 'Clear board', exact: true }).click();
  await expect(board.locator('.card--sort')).toHaveCount(0);
  await expect(notice).toContainText('Board cleared.');
  await expect(notice.getByRole('button', {name:'Undo clear'})).toHaveAttribute('title', /Images and stashes are kept/);
  await expect(notice.getByRole('button', { name: 'Undo clear' })).toBeEnabled();
  expect((await savedImages(page)).map(image => image.categoryId)).toEqual(before.map(image => image[1]));
  // Ordinary notifications expire. Recovery remains available without a timer.
  await page.clock.install();
  await page.clock.fastForward(15_000);
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '/tmp/foldersort-undo-clear-desktop.png' });
  await notice.getByRole('button', { name: 'Undo clear' }).click();
  await expect.poll(state).toEqual(before);
  await expect(notice.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await openBoardActions(page);
  await page.getByRole('button', { name: 'Clear sorted images' }).click();
  await expect(board.locator('.card--sort')).toHaveCount(2);
  await expect(notice.getByRole('button', { name: 'Undo clear' })).toBeEnabled();
  await page.locator('.workspace-actions > summary').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(state).toEqual(before);
  await openBoardActions(page);
  await page.getByRole('button', { name: 'Clear board', exact: true }).click();
  await expect(notice.getByRole('button', { name: 'Undo clear' })).toBeEnabled();
  await backToProject(page);
  await notice.getByRole('button', { name: 'Undo clear' }).click();
  await expect.poll(state).toEqual(before);
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(board.locator('.card--sort')).toHaveCount(3);
  await expect.poll(state).toEqual(before);
  await expect(notice.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('move to Unsorted and delete from project offer visible undo and restore the original',async({page})=>{
 await seedOverviewImages(page,4);const overview=page.getByRole('dialog',{name:'Explore image pile',exact:true});await overview.getByRole('checkbox',{name:'Select image-0000.jpg',exact:true}).click();await overview.getByRole('button',{name: 'Add selected to board', exact: true}).click();
 const image=page.getByTestId('card-overview-0');await image.click();await page.getByRole('button',{name:'Move to stash…'}).click();await page.getByRole('dialog',{name:'Move to stash',exact:true}).getByRole('button',{name:/Unsorted/}).click();expect((await savedImages(page)).find(image=>image.id==='overview-0')!.categoryId).toBeNull();
 await page.getByRole('button',{name:'Undo removal'}).click();await expect(image.locator('.card__categoryLabel')).toHaveText('Scenes/Detail');
 await image.dblclick();const viewer=page.getByRole('dialog',{name:'image-0000.jpg'});await expect(viewer.locator('img')).toBeVisible();await viewer.getByRole('button',{name:'Image actions'}).click();await viewer.getByRole('button',{name:'Delete image from project'}).click();await expect(image).toHaveCount(0);await page.getByRole('button',{name:'Undo delete'}).click();await expect(image).toBeVisible();await image.dblclick();await expect(viewer.locator('img')).toBeVisible();
 await moveReviewedImage(page, null);await viewer.getByRole('button',{name:'Undo removal'}).click();await expect(viewer.locator('.image-review__title small')).toHaveText('Scenes/Detail');await viewer.getByRole('button',{name:'Close image'}).click();await page.reload();await page.getByRole('button',{name:'Open sorting workspace'}).click();await expect(image).toBeVisible();
});

test('mobile clear highlights a reachable undo button without changing categories', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedOverviewImages(page, 8);
  await page.getByRole('button', { name: 'Back to sorting board' }).click();
  await page.getByRole('button', { name: 'Add next 3 images' }).first().click();
  await openBoardActions(page);
  await page.getByRole('button', { name: 'Clear board', exact: true }).click();
  const notice = page.locator('.app-bar .undo-control').first();
  const undo = notice.getByRole('button', { name: 'Undo clear' });
  await expect(undo).toBeInViewport({ ratio: 1 });
  await expect(undo).toBeEnabled();
  await expect(notice).toHaveCSS('opacity', '1');
  const undoBounds = (await notice.boundingBox())!, boardBounds = (await page.locator('.sorting-workspace__board').boundingBox())!;
  expect(undoBounds.y + undoBounds.height).toBeLessThanOrEqual(boardBounds.y);
  await page.screenshot({ path: '/tmp/foldersort-undo-clear-mobile.png' });
  await undo.click();
  await expect(page.getByRole('region', { name: 'Sorting board area' }).locator('.card--sort')).toHaveCount(3);
  expect((await savedImages(page)).find(image => image.id === 'overview-0')!.categoryId).toBe('details');
});
