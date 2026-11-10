import { test, expect } from './persistentFixtures';
import type { Page } from '@playwright/test';
import { showImageBrowser, openBrowserFilters, openWorkspaceExport } from './menuBar';
import JSZip from 'jszip';
import fs from 'node:fs/promises';

const viewer = (page: Page) => page.locator('.image-review');
const key = (page: Page, id: string) => viewer(page).locator(`[data-review-shortcut="${id}"]`);
const destination = (page: Page, id: string) => viewer(page).locator(`[data-review-destination="${id}"]`);
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const read = (name: string) => new Promise<any[]>(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const [images, folders] = await Promise.all([read('images'), read('categories')]); db.close(); return { images, folders };
  });
}
async function seed(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: 10 }, (_, i) => ({ name: `image-${i}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="${i % 2 ? '#b9aa89' : '#97bbaa'}"/><text x="30" y="80">Image ${i}</text></svg>`) })));
  await page.getByRole('button', { name: 'Add 3 images', exact: true }).click();
  await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['projects', 'images', 'categories'], 'readwrite');
    const read = (name: string) => new Promise<any[]>(resolve => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const [project] = await read('projects'), images = await read('images');
    tx.objectStore('projects').put({ ...project, settings: { clipEnabled: false } }, project.id);
    for (const [id, name] of [['people', 'People'], ['hands', 'People/Handshakes'], ['detail', 'People/Handshakes/Details'], ['places', 'Places']]) tx.objectStore('categories').put({ id, name, projectId: project.id, createdAt: 1, layoutInitialized: true }, id);
    images.sort((a, b) => a.path.localeCompare(b.path)).forEach((image, i) => {
      const categoryId = i === 3 ? 'people' : i === 4 ? 'hands' : null;
      tx.objectStore('images').put({ ...image, categoryId, boardScope: categoryId, rootOnBoard: categoryId ? undefined : i < 3, placement: 'board', boardX: i < 5 ? 130 + i * 190 : undefined, boardY: i < 5 ? 250 : undefined }, image.id);
    });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await showImageBrowser(page);
  await page.getByRole('region', { name: 'Image browser', exact: true }).getByRole('combobox', { name: 'Image browser order' }).selectOption('name');
}
async function open(page: Page, path = 'image-5.svg') {
  const image = (await records(page)).images.find(image => image.path === path)!;
  await page.getByTestId('browser-card-' + image.id).dblclick(); await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).locator('img')).toBeVisible(); return image;
}
async function bind(page: Page, id: string, value: string) { await key(page, id).click(); await page.keyboard.press(value); }
async function expand(page: Page) { await viewer(page).getByRole('button', { name: 'Expand folder People', exact: true }).click(); }

test('full-screen destinations count direct members and move only the reviewed image with exact Undo', async ({ page }, info) => {
  await seed(page); const before = await records(page), image = await open(page);
  await expect(viewer(page).getByRole('checkbox', { name: 'Keyboard shortcuts', exact: true })).toHaveCount(0);
  await expect(viewer(page).locator('.image-review__title small')).toHaveText('Waiting');
  const bounds = (await viewer(page).boundingBox())!, viewport = page.viewportSize()!;
  expect(bounds.width).toBe(viewport.width); expect(bounds.height).toBe(viewport.height);
  await viewer(page).getByRole('button', { name: 'Hide folders', exact: true }).click();
  await expect(viewer(page).getByRole('button', { name: 'Show folders', exact: true })).toBeFocused();
  await viewer(page).getByRole('button', { name: 'Show folders', exact: true }).click();
  await expect(viewer(page).getByRole('button', { name: 'Hide folders', exact: true })).toBeFocused();
  await expect(viewer(page).locator('[data-review-folder="staging"] .image-review-folders__count')).toHaveText('3');
  await expect(viewer(page).locator('[data-review-folder="folder:people"] .image-review-folders__count')).toHaveText('1');
  const photo = await viewer(page).locator('img').boundingBox();
  await expand(page); await destination(page, 'folder:hands').click();
  await expect(viewer(page).locator('.image-review__title small')).toHaveText('People/Handshakes');
  await expect(viewer(page).locator('[data-review-folder="folder:hands"] .image-review-folders__count')).toHaveText('2');
  expect(await viewer(page).locator('img').boundingBox()).toEqual(photo);
  expect((await records(page)).images.filter(item => item.id !== image.id)).toEqual(before.images.filter(item => item.id !== image.id));
  await viewer(page).getByRole('button', { name: 'Undo image move', exact: true }).click();
  await expect(viewer(page).locator('.image-review__title small')).toHaveText('Waiting');
  expect((await records(page)).images).toEqual(before.images);
  await destination(page, 'staging').click(); await expect(viewer(page).locator('.image-review__title small')).toHaveText('Staging');
  await expect(viewer(page).locator('[data-review-folder="staging"] .image-review-folders__count')).toHaveText('4');
  expect(await viewer(page).locator('img').evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))).toBe(true);
  await page.screenshot({ path: info.outputPath('full-screen-sorting.png') });
});

test('editable keycaps support letters, symbols, conflicts, clearing, cancellation, Undo and persistence', async ({ page }) => {
  await seed(page); await open(page); await expand(page);
  await expect(key(page, 'folder:hands').locator('.image-review-add-key')).toBeVisible();
  await bind(page, 'folder:hands', 'h'); await expect(key(page, 'folder:hands')).toContainText('H');
  await expect(viewer(page).locator('.image-review__title small')).toHaveText('Waiting');
  await bind(page, 'folder:places', 'h'); await expect(viewer(page).getByRole('status').filter({ hasText: 'H is used by People/Handshakes' })).toBeVisible();
  await page.keyboard.press('p'); await expect(key(page, 'folder:places')).toContainText('P');
  await key(page, 'folder:hands').click(); await page.keyboard.press('ArrowRight'); await expect(key(page, 'folder:hands')).toContainText('H');
  await page.keyboard.press('Tab'); await expect(key(page, 'folder:hands')).toHaveAttribute('aria-pressed', 'false');
  await bind(page, 'staging', '+'); await expect(key(page, 'staging').locator('kbd')).toHaveText('+'); await expect(key(page, 'staging').locator('.image-review-add-key')).toHaveCount(0);
  await bind(page, 'staging', 'Escape'); await expect(viewer(page)).toBeVisible(); await expect(key(page, 'staging').locator('.image-review-add-key')).toBeVisible();
  await viewer(page).getByRole('button', { name: 'Undo shortcut change', exact: true }).click(); await expect(key(page, 'staging').locator('kbd')).toHaveText('+');
  await bind(page, 'staging', 'Escape');
  await viewer(page).getByRole('searchbox', { name: 'Search folders' }).fill('hands'); await page.keyboard.press('h');
  await expect(viewer(page).locator('.image-review__title small')).toHaveText('Waiting');
  await viewer(page).getByRole('searchbox', { name: 'Search folders' }).fill('');
  await key(page, 'folder:hands').focus(); await page.keyboard.press('h');
  await expect(viewer(page).locator('.image-review__title small')).toHaveText('People/Handshakes');
  await bind(page, 'folder:hands', 'Escape'); await expect(key(page, 'folder:hands').locator('.image-review-add-key')).toBeVisible();
  await viewer(page).getByRole('button', { name: 'Close image', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await open(page);
  await expect(key(page, 'folder:hands').locator('.image-review-add-key')).toBeVisible(); await expect(key(page, 'folder:places')).toContainText('P');
  await key(page, 'folder:places').focus(); await page.keyboard.press('p'); await expect(viewer(page).locator('.image-review__title small')).toHaveText('Places');
});

test('auto-next follows a filtered reverse queue and Undo returns to the image and original location', async ({ page }) => {
  await seed(page);
  const browser = page.getByRole('region', { name: 'Image browser', exact: true });
  await browser.getByRole('button', { name: /Unsorted \d+/, exact: true }).click();
  await browser.getByRole('button', { name: 'Reverse image order', exact: true }).click();
  await openBrowserFilters(page); await browser.getByRole('searchbox', { name: 'Find images' }).fill('image-');
  const cards = browser.locator('.card'), saved = (await records(page)).images;
  const ids = await cards.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.testid!.slice('browser-card-'.length)));
  const sequence = ids.map(id => saved.find(image => image.id === id)!.path);
  await cards.first().dblclick(); await expect(viewer(page).locator('.image-review__title strong')).toHaveText(sequence[0]!);
  await bind(page, 'folder:places', 'p'); await viewer(page).getByRole('checkbox', { name: 'Next after move' }).check();
  await page.keyboard.press('p'); await expect(viewer(page).locator('.image-review__title strong')).toHaveText(sequence[1]!);
  await page.keyboard.press('p'); await expect(viewer(page).locator('.image-review__title strong')).toHaveText(sequence[2]!);
  await viewer(page).getByRole('button', { name: 'Undo image move', exact: true }).click();
  await expect(viewer(page).locator('.image-review__title strong')).toHaveText(sequence[1]!); await expect(viewer(page).locator('.image-review__title small')).toHaveText('Waiting');
  await page.keyboard.press('ControlOrMeta+z'); await expect(viewer(page).locator('.image-review__title strong')).toHaveText(sequence[0]!);
});

test('tree keys navigate folders, capture reserves navigation keys, new folders assign and shortcut scope ends on close', async ({ page }) => {
  await seed(page); await open(page);
  const title = await viewer(page).locator('.image-review__title strong').textContent();
  await destination(page, 'folder:people').focus(); await page.keyboard.press('ArrowRight'); await expect(destination(page, 'folder:hands')).toBeVisible();
  await page.keyboard.press('ArrowRight'); await expect(destination(page, 'folder:hands')).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(destination(page, 'folder:people')).toBeFocused();
  await expect(viewer(page).locator('.image-review__title strong')).toHaveText(title!);
  await bind(page, 'folder:places', 'p');
  await viewer(page).getByRole('button', { name: 'New folder', exact: true }).click(); await viewer(page).getByRole('textbox', { name: 'New folder name' }).fill('Portraits');
  await viewer(page).getByRole('button', { name: 'Create & move', exact: true }).click();
  await expect(viewer(page).locator('.image-review__title small')).toHaveText('Portraits');
  await viewer(page).getByRole('button', { name: 'Undo create folder', exact: true }).click(); await expect(viewer(page).locator('.image-review__title small')).toHaveText('Waiting');
  await viewer(page).getByRole('button', { name: 'Close image', exact: true }).click();
  const before = await records(page); await page.keyboard.press('p'); expect((await records(page)).images).toEqual(before.images);
});

test('a failed durable assignment stays on the same image and reports the failure inside the viewer', async ({ page }) => {
  await seed(page); const image = await open(page);
  await viewer(page).getByRole('checkbox', { name: 'Next after move' }).check();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: any, ...args: any[]) { if (this.name === 'images' && value.categoryId === 'places') throw new DOMException('Test storage failure', 'QuotaExceededError'); return put.call(this, value, ...args); };
  });
  await destination(page, 'folder:places').click(); await expect(viewer(page).getByRole('alert')).toContainText('Test storage failure');
  await expect(viewer(page).locator('.image-review__title strong')).toHaveText(image.path); await expect(viewer(page).locator('.image-review__title small')).toHaveText('Waiting');
  expect((await records(page)).images.find(item => item.id === image.id).categoryId).toBeNull();
});

test('compact viewport keeps destinations, keycap focus and reduced-motion feedback usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); await seed(page); await open(page);
  await key(page, 'folder:places').scrollIntoViewIfNeeded(); await key(page, 'folder:places').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('p');
  await expect(key(page, 'folder:places')).toContainText('P');
  expect(await key(page, 'folder:places').locator('kbd').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  const overflow = await viewer(page).evaluate(el => el.scrollWidth - el.clientWidth); expect(overflow).toBeLessThanOrEqual(1);
});

test('folder renaming preserves its shortcut and deleted folders do not reclaim a reused key', async ({ page }) => {
  await seed(page); await open(page); await bind(page, 'folder:places', 'p');
  await viewer(page).getByRole('button', { name: 'Close image', exact: true }).click();
  await page.getByRole('button', { name: 'Show folders', exact: true }).click();
  await page.locator('[data-sidebar-folder="places"] .folder-sidebar__name').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename folder…', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename folder', exact: true });
  await rename.getByRole('textbox', { name: 'Folder name', exact: true }).fill('Landscapes'); await rename.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rename).toHaveCount(0); await open(page); await expect(key(page, 'folder:places')).toContainText('P');
  await expect(destination(page, 'folder:places')).toHaveText('Landscapes');
  await viewer(page).getByRole('button', { name: 'Close image', exact: true }).click();
  await page.locator('[data-sidebar-folder="places"] .folder-sidebar__name').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete empty folder', exact: true }).click();
  await expect.poll(async () => (await records(page)).folders.some(folder => folder.id === 'places')).toBe(false);
  await open(page); await bind(page, 'folder:people', 'p'); await expect(key(page, 'folder:people')).toContainText('P');
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await open(page);
  await expect(key(page, 'folder:people')).toContainText('P'); await key(page, 'folder:people').focus(); await page.keyboard.press('p');
  await expect(viewer(page).locator('.image-review__title small')).toHaveText('People');
});

test('fresh import can be sorted entirely in the reviewer and exported as original files', async ({ page }) => {
  await page.goto('/');
  const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#a6baa6"/></svg>');
  await page.locator('input[accept="image/*"]').setInputFiles(['alpha.svg', 'beta.svg', 'gamma.svg'].map(name => ({ name, mimeType: 'image/svg+xml', buffer: source })));
  await page.getByRole('button', { name: 'Skip starter', exact: true }).click(); await showImageBrowser(page);
  await page.getByRole('region', { name: 'Image browser', exact: true }).getByRole('combobox', { name: 'Image browser order' }).selectOption('name');
  const image = (await records(page)).images.find(image => image.path === 'alpha.svg')!;
  await page.getByTestId('browser-card-' + image.id).dblclick();
  await viewer(page).getByRole('checkbox', { name: 'Next after move' }).check();
  await viewer(page).getByRole('button', { name: 'New folder', exact: true }).click();
  await viewer(page).getByRole('textbox', { name: 'New folder name', exact: true }).fill('Keep');
  await viewer(page).getByRole('button', { name: 'Create & move', exact: true }).click();
  await expect(viewer(page).locator('.image-review__title strong')).toHaveText('beta.svg');
  const folder = (await records(page)).folders.find(folder => folder.name === 'Keep')!;
  await bind(page, `folder:${folder.id}`, 'k'); await page.keyboard.press('k');
  await expect(viewer(page).locator('.image-review__title strong')).toHaveText('gamma.svg');
  await destination(page, 'staging').click(); await expect(viewer(page).locator('.image-review__title small')).toHaveText('Staging');
  await expect(viewer(page).locator('.image-review__title strong')).toHaveText('gamma.svg');
  await viewer(page).getByRole('button', { name: 'Close image', exact: true }).click(); await openWorkspaceExport(page);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export sorted ZIP', exact: true }).click();
  const zip = await JSZip.loadAsync(await fs.readFile((await (await downloading).path())!));
  expect(await zip.file('Keep/alpha.svg')!.async('nodebuffer')).toEqual(source);
  expect(await zip.file('Keep/beta.svg')!.async('nodebuffer')).toEqual(source);
  expect(Object.keys(zip.files).some(path => path.endsWith('/gamma.svg'))).toBe(true);
});
