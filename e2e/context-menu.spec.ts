import { test, expect } from './persistentFixtures';
import type { Page, Locator } from '@playwright/test';

const menu = (page: Page) => page.getByRole('menu');
const action = (page: Page, name: string) => menu(page).getByRole('menuitem', { name, exact: true });
const pane = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const idle = (page: Page) => expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const read = (store: string) => new Promise<any[]>(resolve => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); });
    const [images, folders] = await Promise.all([read('images'), read('categories')]); db.close();
    return { images: images.map(({ id, path, categoryId, boardScope, rootOnBoard, boardX, boardY }) => ({ id, path, categoryId, boardScope, rootOnBoard, boardX, boardY })), folders };
  });
}
async function seed(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: 24 }, (_, i) => ({ name: `image-${String(i).padStart(2, '0')}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="${i % 2 ? '#bbaa88' : '#99bbaa'}"/></svg>`) })));
  await page.getByRole('button', { name: 'Add 3 images', exact: true }).click(); await idle(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['projects', 'categories', 'images'], 'readwrite');
    const read = (store: string) => new Promise<any[]>(resolve => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); });
    const [project] = await read('projects'), images = await read('images');
    tx.objectStore('projects').put({ ...project, settings: { clipEnabled: false } }, project.id);
    for (const [id, name] of [['street', 'Street'], ['child', 'Street/Child'], ['empty', 'Empty']]) tx.objectStore('categories').put({ id, name, projectId: project.id, createdAt: 1, layoutInitialized: true }, id);
    images.sort((a, b) => a.path.localeCompare(b.path)).forEach((image, i) => {
      const categoryId = i === 3 ? 'street' : null;
      tx.objectStore('images').put({ ...image, categoryId, boardScope: categoryId, rootOnBoard: categoryId ? undefined : i < 3, placement: 'board', boardX: i < 4 ? 130 + i % 3 * 245 : undefined, boardY: i < 3 ? 410 : i === 3 ? 200 : undefined }, image.id);
    });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    localStorage.setItem(`folder-sort-board:${project.id}`, JSON.stringify({ mode: 'free', anchors: { street: { x: 150, y: 100 }, empty: { x: 470, y: 100 }, child: { x: 470, y: 180 } } }));
    localStorage.setItem(`folder-sort-stash-view:${project.id}`, JSON.stringify({ active: null, cameras: { root: { x: 550, y: 380, zoom: 1 } } }));
  });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await idle(page);
}
async function right(target: Locator) { await target.click({ button: 'right' }); }
async function blank(page: Page) {
  return pane(page).evaluate(element => {
    const r = element.getBoundingClientRect();
    for (const x of [.9, .7, .4]) for (const y of [.78, .65, .5]) {
      const point = { x: r.left + r.width * x, y: r.top + r.height * y };
      if (document.elementFromPoint(point.x, point.y)?.hasAttribute('data-board-background')) return point;
    }
    throw new Error('No blank point');
  });
}
async function openBrowser(page: Page) { await page.getByRole('button', { name: 'Show image browser', exact: true }).first().click(); }
async function browserImage(page: Page, path: string) {
  await page.getByRole('button', { name: 'Filters & view', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find images', exact: true }).fill(path);
  await page.getByRole('button', { name: 'Filters & view', exact: true }).click();
  return page.getByTestId('browser-card-' + (await records(page)).images.find(image => image.path === path)!.id);
}

test('board right-click preserves group selection, z-order, positions and camera; commands and Undo reuse the selection', async ({ page }) => {
  await seed(page); const before = await records(page), staged = before.images.filter(image => image.rootOnBoard);
  const cards = staged.map(image => page.getByTestId('card-' + image.id));
  await cards[0].click(); await cards[1].click({ modifiers: ['Shift'] });
  const visuals = () => pane(page).locator('.card').evaluateAll(nodes => nodes.map(node => ({ id: (node as HTMLElement).dataset.testid, transform: (node as HTMLElement).style.transform, z: (node as HTMLElement).style.zIndex })));
  const layout = await visuals(), scroll = await pane(page).getByRole('region', { name: 'Sorting board', exact: true }).evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
  await right(cards[0]); await expect(menu(page)).toContainText('2 images selected'); await expect(action(page, 'View image')).toHaveCount(0);
  expect(await visuals()).toEqual(layout); expect((await records(page)).images).toEqual(before.images);
  await page.keyboard.press('Escape'); await expect(menu(page)).toHaveCount(0); await expect(cards[0]).toBeFocused();
  await right(cards[0]); await action(page, 'Move to folder…').click();
  await page.getByRole('dialog', { name: 'Move to folder', exact: true }).getByRole('button', { name: 'Move 2 images to Street', exact: true }).click();
  await expect.poll(async () => (await records(page)).images.filter(image => image.categoryId === 'street').length).toBe(3);
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await idle(page); expect((await records(page)).images).toEqual(before.images);
  await right(cards[2]); await expect(action(page, 'View image')).toBeVisible(); await expect(menu(page)).not.toContainText('2 images selected');
  await action(page, 'Remove from staging').click(); await expect(cards[2]).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo remove from staging', exact: true }).click(); await idle(page); expect((await records(page)).images).toEqual(before.images);
  expect(scroll).not.toBeUndefined();
});

test('keyboard menus clamp at viewport edges and dismiss without clearing selection; editable controls and Shift-right-click stay native', async ({ page }, info) => {
  await seed(page); const staged = (await records(page)).images.filter(image => image.rootOnBoard), card = page.getByTestId('card-' + staged[0].id);
  await card.focus(); await card.press('Shift+F10'); await expect(action(page, 'View image')).toBeFocused();
  await page.keyboard.press('End'); await expect(action(page, 'Remove from staging')).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('p'); await expect(action(page, 'Preview related images')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(card).toBeFocused();
  const point = await blank(page); await page.mouse.click(point.x, point.y, { button: 'right' });
  const bounds = (await menu(page).boundingBox())!, size = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width); expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
  await page.screenshot({ path: info.outputPath('context-menu.png') });
  await page.keyboard.press('Escape'); await openBrowser(page); await page.getByRole('button', { name: 'Filters & view', exact: true }).click();
  const input = page.getByRole('searchbox', { name: 'Find images', exact: true });
  expect(await input.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
  await card.click({ button: 'right', modifiers: ['Shift'] }); await expect(menu(page)).toHaveCount(0); await page.keyboard.press('Escape');
});

test('folder cover and sidebar menus target the whole folder: rename, nesting, disabled deletion, new subfolder, navigation and Undo', async ({ page }) => {
  await seed(page); const before = await records(page);
  const tile = page.locator('[data-stash-drop-id="street"]'); await right(tile.locator('img').first());
  await expect(action(page, 'View image')).toHaveCount(0); await expect(action(page, 'Delete empty folder')).toHaveAttribute('aria-disabled', 'true');
  await expect(menu(page)).toContainText('Remove its images and subfolders first.'); await action(page, 'Rename folder…').click();
  const rename = page.getByRole('dialog', { name: 'Rename folder', exact: true }); await rename.getByRole('textbox', { name: 'Folder name' }).fill('Road'); await rename.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await records(page)).folders.find(folder => folder.id === 'child')?.name).toBe('Road/Child');
  await page.getByRole('button', { name: 'Undo rename', exact: true }).click(); await idle(page);
  await page.getByRole('button', { name: 'Show folders', exact: true }).click();
  const row = page.locator('[data-sidebar-folder="street"] .folder-sidebar__name'); await right(row); await action(page, 'New subfolder').click(); await idle(page);
  await expect.poll(async () => (await records(page)).folders.length).toBe(before.folders.length + 1); await expect(page.locator('[data-current-location]')).toHaveText('Staging');
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('[data-stash-drop-id] input')).toHaveCount(0);
  await page.getByRole('button', { name: /Undo create folder/ }).click(); await idle(page);
  await right(row); await action(page, 'Move folder…').click(); await page.getByRole('dialog', { name: 'Move folder', exact: true }).getByRole('button', { name: 'Move folder Street into Empty', exact: true }).click();
  await expect.poll(async () => (await records(page)).folders.find(folder => folder.id === 'child')?.name).toBe('Empty/Street/Child');
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click(); await idle(page);
  await right(page.locator('[data-sidebar-folder="empty"] .folder-sidebar__name')); await action(page, 'Delete empty folder').click(); await idle(page);
  await expect.poll(async () => (await records(page)).folders.some(folder => folder.id === 'empty')).toBe(false);
  await page.getByRole('button', { name: /Undo delete folder/ }).click(); await idle(page);
  expect((await records(page)).images).toEqual(before.images);
  await right(row); await action(page, 'Open folder').click(); await expect(page.locator('[data-current-location]')).toHaveText('Street');
});

for (const random of [false, true]) test(`${random ? 'random' : 'related'} preview menu excludes, views, adds at exact slot, moves to folder, refills only that slot and Undo restores draft`, async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await seed(page); const before = await records(page), staged = before.images.find(image => image.rootOnBoard)!;
  if (random) await page.getByRole('button', { name: 'Preview 3 random images', exact: true }).click();
  else { await right(page.getByTestId('card-' + staged.id)); await action(page, 'Preview related images').click(); }
  const previews = page.locator('[data-suggestion-preview]'); await expect(previews).toHaveCount(3);
  const slots = () => previews.evaluateAll(nodes => nodes.map(el => ({ id: (el as HTMLElement).dataset.suggestionPreview!, x: parseFloat((el as HTMLElement).style.left), y: parseFloat((el as HTMLElement).style.top), included: el.querySelector('input')!.checked })));
  const original = await slots(); const first = () => page.getByTestId('suggestion-' + original[0].id);
  await right(first()); await action(page, 'Exclude from batch').click(); await expect(first().getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Add 2', exact: true })).toBeVisible();
  const excluded = await slots(); await right(first()); await action(page, 'View image').click();
  const viewer = page.getByRole('dialog'); await expect(viewer).toBeVisible();
  const native = await viewer.locator('img').first().evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))); expect(native).toBe(true);
  await viewer.getByRole('button', { name: 'Close image', exact: true }).click(); await expect.poll(slots).toEqual(excluded);
  await right(first()); await action(page, 'Add here').click();
  await expect.poll(async () => (await slots())[0]?.id).not.toBe(original[0].id); expect((await slots()).slice(1)).toEqual(excluded.slice(1));
  const placed = (await records(page)).images.find(image => image.id === original[0].id)!;
  expect(placed.boardX).toBe(original[0].x); expect(placed.boardY).toBe(original[0].y); expect(placed.rootOnBoard).toBe(true);
  await page.getByRole('button', { name: /Undo (add images|image move)/ }).click(); await expect.poll(slots).toEqual(excluded);
  await right(first()); await action(page, 'Move to folder…').click();
  await page.getByRole('dialog', { name: 'Move to folder', exact: true }).getByRole('button', { name: `Move ${placed.path} to Street`, exact: true }).click();
  await expect.poll(async () => (await records(page)).images.find(image => image.id === placed.id)?.categoryId).toBe('street');
  await expect.poll(async () => (await slots())[0]?.id).not.toBe(original[0].id); expect((await slots()).slice(1)).toEqual(excluded.slice(1));
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await expect.poll(slots).toEqual(excluded);
  expect((await records(page)).images).toEqual(before.images);
});

test('browser labels follow actual membership, filtered selection and mixed selections preserve existing positions', async ({ page }) => {
  await seed(page); const before = await records(page), staged = before.images.filter(image => image.rootOnBoard), waiting = before.images.find(image => image.rootOnBoard === false)!, filed = before.images.find(image => image.categoryId === 'street')!;
  await openBrowser(page);
  const waitingCard = await browserImage(page, waiting.path); await right(waitingCard); await expect(action(page, 'Add to staging')).toBeVisible(); await page.keyboard.press('Escape');
  const filedCard = await browserImage(page, filed.path); await right(filedCard); await expect(action(page, 'Move to staging')).toBeVisible(); await page.keyboard.press('Escape');
  const stagedCard = await browserImage(page, staged[0].path); await right(stagedCard); await action(page, 'Locate on board').click(); await idle(page);
  expect((await records(page)).images).toEqual(before.images);
  await page.getByRole('button', { name: 'Filters & view', exact: true }).click(); await page.getByRole('searchbox', { name: 'Find images', exact: true }).fill('image-0'); await page.getByRole('button', { name: 'Filters & view', exact: true }).click();
  const scroll = page.locator('.image-browser__scroll'); await scroll.focus(); await scroll.press('Shift+F10'); await action(page, 'Select all displayed images').click();
  await right(page.getByTestId('browser-card-' + staged[0].id)); await expect(menu(page)).toContainText('10 images selected'); await expect(action(page, 'Remove from staging')).toHaveCount(0); await action(page, 'Move to staging').click(); await idle(page);
  const after = await records(page); for (const image of staged) expect(after.images.find(item => item.id === image.id)).toEqual(image);
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await idle(page); expect((await records(page)).images).toEqual(before.images);
});

test('blank board and hierarchy menus create empty folders, select direct board images, expand/collapse and Undo', async ({ page }) => {
  await seed(page); const before = await records(page); await page.getByTestId('card-' + before.images.find(image => image.rootOnBoard)!.id).click(); const point = await blank(page);
  const world = await pane(page).locator('[data-testid="board-canvas"]').evaluate((el, point) => { const r = el.getBoundingClientRect(), scale = r.width / (el as HTMLElement).offsetWidth; return { x: Math.round((point.x - r.left) / scale), y: Math.round((point.y - r.top) / scale) }; }, point);
  await page.mouse.click(point.x, point.y, { button: 'right' }); await action(page, 'New folder').click(); await idle(page);
  await expect.poll(async () => (await records(page)).folders.length).toBe(before.folders.length + 1);
  const added = (await records(page)).folders.find(folder => !before.folders.some(item => item.id === folder.id));
  const anchor = await page.evaluate(({ id, projectId }) => JSON.parse(localStorage.getItem(`folder-sort-board:${projectId}`)!).anchors[id], added);
  expect(Math.abs(anchor.x - world.x)).toBeLessThanOrEqual(1); expect(Math.abs(anchor.y - world.y)).toBeLessThanOrEqual(1); expect((await records(page)).images).toEqual(before.images);
  await page.getByRole('button', { name: /Undo create folder/ }).click(); await idle(page);
  await page.getByRole('button', { name: 'Show folders', exact: true }).click(); const tree = page.getByRole('navigation', { name: 'Folder hierarchy', exact: true });
  await tree.focus(); await tree.press('Shift+F10'); await action(page, 'Expand all').click(); await expect(page.locator('[data-sidebar-folder="child"]')).toBeVisible();
  await tree.focus(); await tree.press('Shift+F10'); await action(page, 'Collapse all').click(); await expect(page.locator('[data-sidebar-folder="child"]')).toHaveCount(0);
  await right(page.locator('[data-sidebar-folder="root"]')); await expect(action(page, 'Rename folder…')).toHaveCount(0); await action(page, 'New folder').click(); await idle(page);
  await expect.poll(async () => (await records(page)).folders.length).toBe(before.folders.length + 1);
  expect((await records(page)).images).toEqual(before.images);
});


test('browser folder placement, range anchors and clearing filters use the displayed images', async ({ page }) => {
  await seed(page); const before = await records(page);
  await right(page.locator('[data-stash-drop-id="street"]')); await action(page, 'Open folder').click(); await expect(page.locator('[data-current-location]')).toHaveText('Street');
  await openBrowser(page); const waiting = before.images.find(image => image.rootOnBoard === false)!;
  await right(await browserImage(page, waiting.path)); await action(page, 'Move to “Street”').click(); await idle(page);
  await expect.poll(async () => (await records(page)).images.find(image => image.id === waiting.id)?.categoryId).toBe('street');
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await idle(page);
  const scroll = page.locator('.image-browser__scroll'); await scroll.focus(); await scroll.press('Shift+F10'); await action(page, 'Clear filters').click();
  await page.getByRole('combobox', { name: 'Image browser order', exact: true }).selectOption('name');
  const byName = [...before.images].sort((a, b) => a.path.localeCompare(b.path));
  await right(page.getByTestId('browser-card-' + byName[1].id)); await page.keyboard.press('Escape');
  await page.getByTestId('browser-card-' + byName[3].id).click({ modifiers: ['Shift'] });
  await right(page.getByTestId('browser-card-' + byName[2].id)); await expect(menu(page)).toContainText('3 images selected');
  await action(page, 'New folder').click(); await idle(page);
  const after = await records(page), created = after.folders.find(folder => !before.folders.some(item => item.id === folder.id));
  expect(after.images.filter(image => image.categoryId === created.id).map(image => image.id).sort()).toEqual(byName.slice(1, 4).map(image => image.id).sort());
  await expect(page.locator('[data-current-location]')).toHaveText('Street');
  await page.getByRole('button', { name: 'Undo create folder', exact: true }).click(); await idle(page); expect((await records(page)).images).toEqual(before.images);
});


test('moving a folder preview to Staging refills only its slot and Undo restores its exclusion', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await seed(page); const before = await records(page);
  await right(page.locator('[data-stash-drop-id="street"]')); await action(page, 'Open folder').click(); await expect(page.locator('[data-current-location]')).toHaveText('Street');
  const reference = before.images.find(image => image.categoryId === 'street')!;
  await right(page.getByTestId('card-' + reference.id)); await action(page, 'Preview related images').click();
  const previews = page.locator('[data-suggestion-preview]'); await expect(previews).toHaveCount(3);
  const slots = () => previews.evaluateAll(nodes => nodes.map(el => ({ id: (el as HTMLElement).dataset.suggestionPreview!, x: (el as HTMLElement).style.left, y: (el as HTMLElement).style.top, included: el.querySelector('input')!.checked })));
  const original = await slots(), index = original.findIndex(slot => before.images.find(image => image.id === slot.id)?.rootOnBoard === false);
  expect(index).toBeGreaterThanOrEqual(0); const id = original[index].id, cell = page.getByTestId('suggestion-' + id);
  await right(cell); await action(page, 'Exclude from batch').click(); const excluded = await slots();
  await right(cell); await action(page, 'Move to folder…').click();
  await page.getByRole('dialog', { name: 'Move to folder', exact: true }).getByRole('button', { name: /^Staging/ }).click();
  await expect.poll(async () => (await records(page)).images.find(image => image.id === id)?.rootOnBoard).toBe(true);
  await expect.poll(async () => (await slots())[index]?.id).not.toBe(id);
  for (let i = 0; i < 3; i++) if (i !== index) expect((await slots())[i]).toEqual(excluded[i]);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await expect.poll(slots).toEqual(excluded);
  expect((await records(page)).images).toEqual(before.images);
});
