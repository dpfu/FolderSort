import { test, expect } from './persistentFixtures';
import type { Page, Locator } from '@playwright/test';

const side = (page: Page) => page.getByRole('complementary', { name: 'Folders', exact: true });
const row = (page: Page, id: string) => side(page).locator(`[data-sidebar-folder="${id}"]`);
const name = (page: Page, id: string) => row(page, id).locator('.folder-sidebar__name');
const board = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const idle = (page: Page) => expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
    const read = (store: string) => new Promise<any[]>(resolve => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); });
    const [folders, images] = await Promise.all([read('categories'), read('images')]); db.close();
    const projectId = folders[0].projectId;
    const anchors = JSON.parse(localStorage.getItem(`folder-sort-board:${projectId}`) || '{}').anchors;
    const view = JSON.parse(localStorage.getItem(`folder-sort-stash-view:${projectId}`) || '{}');
    return { folders, images: images.map(({ id, path, categoryId, boardScope, rootOnBoard, placement, boardX, boardY, stashOrder }) => ({ id, path, categoryId, boardScope, rootOnBoard, placement, boardX, boardY, stashOrder })), anchors, view };
  });
}
async function seed(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: 20 }, (_, i) => ({ name: `image-${String(i).padStart(2, '0')}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="${i % 2 ? '#c8b58f' : '#a4c5b9'}"/></svg>`) })));
  await page.getByRole('button', { name: 'Add 3 images', exact: true }).click(); await idle(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['projects', 'categories', 'images'], 'readwrite');
    const read = (store: string) => new Promise<any[]>(resolve => { const request = tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); });
    const [project] = await read('projects'), images = await read('images');
    tx.objectStore('projects').put({ ...project, settings: { clipEnabled: false } }, project.id);
    for (const [id, name] of [['source', 'Source'], ['child', 'Source/Child'], ['deep', 'Source/Child/Deep'], ['empty', 'Source/Empty'], ['archive', 'Archive'], ['collision', 'Collision'], ['duplicate', 'Collision/Source']])
      tx.objectStore('categories').put({ id, name, projectId: project.id, createdAt: 1, layoutInitialized: true }, id);
    images.sort((a, b) => a.path.localeCompare(b.path)).forEach((image, i) => {
      const id = ['source', 'child', 'deep'][i] || null;
      tx.objectStore('images').put({ ...image, categoryId: id, boardScope: id, rootOnBoard: id ? undefined : i < 5, placement: 'board', boardX: i < 3 ? 130 + i * 40 : i < 5 ? 140 + (i - 3) * 250 : undefined, boardY: i < 3 ? 220 + i * 30 : i < 5 ? 460 : undefined }, image.id);
    });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    localStorage.setItem(`folder-sort-board:${project.id}`, JSON.stringify({ mode: 'free', anchors: { source: { x: 120, y: 160 }, archive: { x: 440, y: 140 }, collision: { x: 740, y: 180 }, child: { x: 200, y: 160 }, empty: { x: 480, y: 240 }, deep: { x: 160, y: 150 } } }));
    localStorage.setItem(`folder-sort-stash-view:${project.id}`, JSON.stringify({ active: null, cameras: { root: { x: 500, y: 330, zoom: 1 }, source: { x: 420, y: 320, zoom: 1 }, child: { x: 370, y: 290, zoom: .85 } } }));
  });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await idle(page);
}
async function open(page: Page) { await side(page).getByRole('button', { name: 'Show folders', exact: true }).click(); await expect(side(page).getByRole('button', { name: 'Hide folders', exact: true })).toBeVisible(); }
async function begin(page: Page, source: Locator) {
  await expect(source).toBeVisible(); const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 7);
}
async function over(page: Page, target: Locator) {
  await expect(target).toBeVisible(); const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(30, box.height / 2), { steps: 10 });
}
async function drag(page: Page, source: Locator, target: Locator) { await begin(page, source); await over(page, target); await page.mouse.up(); await idle(page); }
async function expectPath(page: Page, id: string, path: string) { await expect.poll(async () => (await records(page)).folders.find(folder => folder.id === id)?.name).toBe(path); }

test('starts collapsed; navigation, expansion and resizing preserve data, board cameras and project preferences', async ({ page }, info) => {
  await seed(page); const before = await records(page);
  await expect(side(page).getByRole('button', { name: 'Show folders', exact: true })).toBeVisible();
  await open(page); await side(page).getByRole('button', { name: 'Expand folder Source', exact: true }).click();
  await expect(name(page, 'empty')).toBeVisible(); await expect(page.locator('[data-current-location]')).toHaveText('Staging');
  const resize = side(page).getByRole('separator', { name: 'Resize folders sidebar' }); await resize.focus(); await resize.press('ArrowLeft');
  await expect(resize).toHaveAttribute('aria-valuenow', '270');
  const current = await records(page); expect(current.images).toEqual(before.images); expect(current.anchors).toEqual(before.anchors);
  await expect.poll(async () => (await records(page)).view.cameras.root).toEqual(before.view.cameras.root);
  await name(page, 'child').click(); await expect(page.locator('[data-current-location]')).toHaveText('Child');
  await expect(name(page, 'child')).toHaveAttribute('aria-current', 'page'); await expect(name(page, 'deep')).toBeVisible();
  await side(page).getByRole('button', { name: 'Collapse folder Source', exact: true }).click();
  await expect(page.locator('[data-current-location]')).toHaveText('Child');
  await side(page).getByRole('button', { name: 'Expand folder Source', exact: true }).click();
  await page.screenshot({ path: info.outputPath('folder-sidebar-open.png') });
  await name(page, 'root').click(); await expect(page.locator('[data-current-location]')).toHaveText('Staging');
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(side(page).getByRole('button', { name: 'Hide folders', exact: true })).toBeVisible();
  await expect(resize).toHaveAttribute('aria-valuenow', '270');
  expect((await records(page)).images).toEqual(before.images);
});

test('tree folder drops preserve descendants and positions, prevent cycles, cancel and support immediate Undo', async ({ page }) => {
  await seed(page); await open(page); const before = await records(page);
  await drag(page, name(page, 'source'), row(page, 'archive')); await expectPath(page, 'deep', 'Archive/Source/Child/Deep');
  await expect(name(page, 'source')).toBeVisible();
  expect((await records(page)).images).toEqual(before.images); expect((await records(page)).anchors).toEqual(before.anchors);
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click(); await expectPath(page, 'source', 'Source');
  await side(page).getByRole('button', { name: 'Expand folder Source', exact: true }).click();
  await side(page).getByRole('button', { name: 'Expand folder Source/Child', exact: true }).click();
  await begin(page, name(page, 'source')); await over(page, row(page, 'deep')); await expect(row(page, 'deep')).toHaveClass(/is-invalid-target/); await page.mouse.up();
  expect((await records(page)).folders).toEqual(before.folders); expect((await records(page)).anchors).toEqual(before.anchors);
  await begin(page, name(page, 'child')); await over(page, row(page, 'archive')); await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await records(page)).folders).toEqual(before.folders);
  await drag(page, name(page, 'child'), row(page, 'root')); await expectPath(page, 'deep', 'Child/Deep');
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click(); await expectPath(page, 'deep', 'Source/Child/Deep');
  expect((await records(page)).images).toEqual(before.images);
});

test('board folder headers drop into the tree; invalid hierarchy targets never rearrange the board', async ({ page }) => {
  await seed(page); await open(page); const before = await records(page);
  await side(page).getByRole('button', { name: 'Expand folder Source', exact: true }).click();
  const handle = board(page).getByRole('button', { name: 'Move folder Source', exact: true });
  await drag(page, handle, row(page, 'child')); expect((await records(page)).anchors).toEqual(before.anchors); expect((await records(page)).folders).toEqual(before.folders);
  await drag(page, handle, row(page, 'archive')); await expectPath(page, 'deep', 'Archive/Source/Child/Deep');
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click(); await expectPath(page, 'source', 'Source');
  expect((await records(page)).anchors).toEqual(before.anchors); expect((await records(page)).images).toEqual(before.images);
});

test('multiple board images and browser images sort through the tree without navigating; Undo restores them', async ({ page }) => {
  await seed(page); await open(page); const before = await records(page), staged = before.images.filter(image => image.rootOnBoard);
  const first = page.getByTestId('card-' + staged[0].id), second = page.getByTestId('card-' + staged[1].id);
  await first.click(); await second.click({ modifiers: ['Shift'] });
  await drag(page, first, row(page, 'archive'));
  await expect.poll(async () => (await records(page)).images.filter(image => image.categoryId === 'archive').length).toBe(2);
  await expect(page.locator('[data-current-location]')).toHaveText('Staging');
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await idle(page); expect((await records(page)).images).toEqual(before.images);
  await page.getByRole('button', { name: 'Show image browser', exact: true }).first().click();
  const waiting = before.images.find(image => image.rootOnBoard === false && image.categoryId === null)!;
  await page.getByRole('button', { name: 'Filters & view', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find images', exact: true }).fill(waiting.path);
  await page.getByRole('button', { name: 'Filters & view', exact: true }).click();
  const browserImage = page.getByTestId('browser-card-' + waiting.id); await browserImage.scrollIntoViewIfNeeded();
  await drag(page, browserImage, row(page, 'archive'));
  await expect.poll(async () => (await records(page)).images.find(image => image.id === waiting.id)?.categoryId).toBe('archive');
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await idle(page); expect((await records(page)).images).toEqual(before.images);
});

test('preview images drop into tree folders and refill in place; Undo restores their inclusion and slots', async ({ page }) => {
  await seed(page); await open(page); const before = await records(page), staged = before.images.find(image => image.rootOnBoard)!;
  await page.getByTestId('card-' + staged.id).click(); await page.getByRole('button', { name: 'Show related image suggestions', exact: true }).click();
  const previews = page.locator('[data-suggestion-preview]'); await expect(previews).toHaveCount(3);
  const slots = () => previews.evaluateAll(nodes => nodes.map(node => ({ id: (node as HTMLElement).dataset.suggestionPreview!, x: (node as HTMLElement).style.left, y: (node as HTMLElement).style.top, included: node.querySelector('input')!.checked })));
  const original = await slots(); await previews.first().getByRole('checkbox').uncheck(); const choices = await slots();
  await drag(page, previews.first(), row(page, 'archive'));
  await expect.poll(async () => (await slots())[0]?.id).not.toBe(original[0].id); expect((await slots()).slice(1)).toEqual(original.slice(1));
  await expect.poll(async () => (await records(page)).images.find(image => image.id === original[0].id)?.categoryId).toBe('archive');
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await expect.poll(slots).toEqual(choices);
  expect((await records(page)).images).toEqual(before.images);
});

test('dragging over the collapsed rail opens it, hovering a branch expands it, and keyboard Move uses the same commands', async ({ page }) => {
  await seed(page); const before = await records(page);
  await begin(page, board(page).getByRole('button', { name: 'Move folder Archive', exact: true })); await over(page, side(page));
  await expect(side(page).getByRole('button', { name: 'Hide folders', exact: true })).toBeVisible();
  await over(page, row(page, 'source')); await expect(name(page, 'child')).toBeVisible();
  await over(page, row(page, 'child')); await page.mouse.up(); await expectPath(page, 'archive', 'Source/Child/Archive');
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click(); await expectPath(page, 'archive', 'Archive');
  await row(page, 'archive').getByRole('button', { name: 'Move folder Archive', exact: true }).focus();
  await row(page, 'archive').getByRole('button', { name: 'Move folder Archive', exact: true }).press('Enter');
  const modal = page.getByRole('dialog', { name: 'Move folder', exact: true });
  await modal.getByRole('button', { name: 'Move folder Archive into Source/Empty', exact: true }).click(); await expectPath(page, 'archive', 'Source/Empty/Archive');
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click(); await expectPath(page, 'archive', 'Archive');
  expect((await records(page)).images).toEqual(before.images); expect((await records(page)).anchors).toEqual(before.anchors);
});

test('narrow screens keep the tree reachable and close it on navigation', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await seed(page); await open(page);
  await side(page).getByRole('button', { name: 'Expand folder Source', exact: true }).click();
  await name(page, 'child').click(); await expect(page.locator('[data-current-location]')).toHaveText('Child');
  await expect(side(page).getByRole('button', { name: 'Show folders', exact: true })).toBeVisible();
  await open(page); await expect(name(page, 'child')).toHaveAttribute('aria-current', 'page'); await expect(name(page, 'deep')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('folder-sidebar-mobile.png') });
});

test('a long tree reveals the active folder and scrolls during a folder drag without changing board data', async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['projects', 'categories'], 'readwrite');
    const project = await new Promise<any>(resolve => { const r = tx.objectStore('projects').getAll(); r.onsuccess = () => resolve(r.result[0]); });
    for (let i = 0; i < 80; i++) tx.objectStore('categories').put({ id: 'extra-' + i, name: 'Folder ' + String(i).padStart(2, '0'), projectId: project.id, createdAt: 1, layoutInitialized: true }, 'extra-' + i);
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await open(page);
  await name(page, 'extra-79').scrollIntoViewIfNeeded(); await name(page, 'extra-79').click();
  await expect(page.locator('[data-current-location]')).toHaveText('Folder 79');
  const tree = side(page).getByRole('navigation', { name: 'Folder hierarchy' });
  await tree.evaluate(node => { node.scrollTop = 0; });
  await side(page).getByRole('button', { name: 'Hide folders', exact: true }).click(); await open(page);
  await expect(name(page, 'extra-79')).toBeInViewport(); const before = await records(page);
  await name(page, 'source').scrollIntoViewIfNeeded(); await begin(page, name(page, 'source'));
  const bounds = (await tree.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 8, { steps: 10 });
  await expect.poll(() => tree.evaluate(node => node.scrollTop), { timeout: 10000 }).toBe(0);
  await over(page, row(page, 'archive')); await page.mouse.up(); await expectPath(page, 'source', 'Archive/Source');
  expect((await records(page)).images).toEqual(before.images); expect((await records(page)).anchors).toEqual(before.anchors);
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click(); await expectPath(page, 'source', 'Source');
});

test('native touch can move a folder through the tree and Undo restores its subtree', async ({ browser, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'CDP supplies native touch input.');
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, route => route.abort());
  try {
    const page = await context.newPage(); await seed(page); await open(page); const before = await records(page);
    const source = (await name(page, 'source').boundingBox())!, target = (await row(page, 'archive').boundingBox())!, cdp = await context.newCDPSession(page);
    const start = { x: source.x + source.width / 2, y: source.y + source.height / 2, id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, x: start.x + 10, y: start.y + 7 }] });
    await expect(side(page).locator('.folder-sidebar__ghost')).toBeVisible();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: target.x + target.width / 2, y: target.y + target.height / 2, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expectPath(page, 'deep', 'Archive/Source/Child/Deep');
    await page.getByRole('button', { name: 'Undo folder move', exact: true }).click(); await expectPath(page, 'source', 'Source');
    expect((await records(page)).images).toEqual(before.images); expect((await records(page)).anchors).toEqual(before.anchors);
  } finally { await context.close(); }
});
