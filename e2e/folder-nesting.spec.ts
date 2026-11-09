import { test, expect } from './persistentFixtures';
import type { Page, Locator } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { backToProject, openWorkspaceExport } from './menuBar';

const tile = (page: Page, name: string) => page.getByRole('region', { name: `Folder ${name}`, exact: true });
const chooser = (page: Page) => page.getByRole('dialog', { name: 'Move folder', exact: true });
const idle = (page: Page) => expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
async function state(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const all = (store: string) => new Promise<any[]>(resolve => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); });
    const folders = await all('categories'), images = await all('images'); db.close();
    const projectId = folders[0].projectId;
    const view = JSON.parse(localStorage.getItem(`folder-sort-stash-view:${projectId}`) || '{}');
    return { folders, images, anchors: JSON.parse(localStorage.getItem(`folder-sort-board:${projectId}`) || '{}').anchors,
      innerCameras: { source: view.cameras?.source, child: view.cameras?.child } };
  });
}
async function seed(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: 4 }, (_, i) => ({
    name: `${i}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="${i % 2 ? '#c8b58f' : '#a4c5b9'}"/></svg>`),
  })));
  await page.getByRole('button', { name: 'Add 3 images', exact: true }).click(); await idle(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction(['projects', 'categories', 'images'], 'readwrite');
    const getAll = (store: string) => new Promise<any[]>(resolve => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); });
    const [project] = await getAll('projects'), images = await getAll('images');
    tx.objectStore('projects').put({ ...project, settings: { clipEnabled: false } }, project.id);
    for (const [id, name] of [['source', 'Source'], ['child', 'Source/Child'], ['deep', 'Source/Child/Deep'], ['empty', 'Source/Empty'], ['archive', 'Archive'], ['collision', 'Collision'], ['duplicate', 'Collision/Source']])
      tx.objectStore('categories').put({ id, name, projectId: project.id, createdAt: 1, layoutInitialized: true }, id);
    images.sort((a, b) => a.path.localeCompare(b.path)).forEach((image, i) => {
      const id = ['source', 'child', 'deep', null][i];
      tx.objectStore('images').put({ ...image, categoryId: id, boardScope: id, rootOnBoard: false, boardX: 130 + i * 40, boardY: 220 + i * 30 }, image.id);
    });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
    localStorage.setItem(`folder-sort-board:${project.id}`, JSON.stringify({ mode: 'free', anchors: { source: { x: 120, y: 160 }, archive: { x: 440, y: 140 }, collision: { x: 740, y: 180 }, child: { x: 200, y: 160 }, empty: { x: 480, y: 240 }, deep: { x: 160, y: 150 } } }));
    localStorage.setItem(`folder-sort-stash-view:${project.id}`, JSON.stringify({ active: null, cameras: { root: { x: 500, y: 330, zoom: 1 }, source: { x: 420, y: 320, zoom: 1 }, child: { x: 370, y: 290, zoom: .85 } } }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(tile(page, 'Source')).toBeVisible(); await idle(page);
}
async function menuMove(page: Page, name: string) {
  await tile(page, name).getByRole('button', { name: `Folder actions for ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Move folder…', exact: true }).click();
  await expect(chooser(page)).toBeVisible();
}
async function choose(page: Page, source: string, destination: string) {
  await chooser(page).getByRole('button', { name: `Move folder ${source} ${destination === 'Staging' ? 'to' : 'into'} ${destination}`, exact: true }).click();
  await expect(chooser(page)).toHaveCount(0);
}
async function expectPath(page: Page, id: string, path: string) {
  await expect.poll(async () => (await state(page)).folders.find(item => item.id === id)?.name).toBe(path);
}
async function drag(page: Page, source: Locator, target: Locator, release = true) {
  await expect(source).toBeVisible();
  await expect(page.locator('.workspace-board-scene[inert]')).toHaveCount(0);
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down(); await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 6);
  await expect(source.locator('xpath=ancestor::section[1]')).toHaveAttribute('data-group-preview', 'true');
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(36, to.height / 2), { steps: 10 });
  if (release) await page.mouse.up();
}

test('folder menus move a whole subtree, moving the open folder keeps its board, and Undo restores both moves', async ({ page }, testInfo) => {
  await seed(page); const before = await state(page);
  await menuMove(page, 'Source');
  for (const name of ['Source', 'Source/Child', 'Source/Child/Deep', 'Source/Empty'])
    await expect(chooser(page).getByRole('button', { name: `Move folder Source into ${name}`, exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('folder-move-chooser.png') });
  await choose(page, 'Source', 'Archive');
  await expectPath(page, 'deep', 'Archive/Source/Child/Deep');
  expect((await state(page)).images).toEqual(before.images);
  expect((await state(page)).anchors).toEqual(before.anchors);
  expect((await state(page)).innerCameras).toEqual(before.innerCameras);
  await page.getByRole('button', { name: 'Open folder Archive', exact: true }).click();
  await page.getByRole('button', { name: 'Open folder Archive/Source', exact: true }).click();
  const content = await state(page);
  await page.getByRole('button', { name: 'Board actions', exact: true }).click(); await page.getByRole('button', { name: 'Move folder…', exact: true }).click();
  await choose(page, 'Archive/Source', 'Staging');
  await expectPath(page, 'deep', 'Source/Child/Deep');
  await expect(page.locator('[data-current-location]')).toHaveText('Source');
  await expect(tile(page, 'Source/Child')).toBeVisible();
  expect((await state(page)).images).toEqual(content.images);
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click();
  await expectPath(page, 'source', 'Archive/Source');
  await expect(page.getByRole('navigation', { name: 'Folder navigation' })).toContainText('Archive');
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click();
  await expectPath(page, 'source', 'Source');
  expect((await state(page)).folders).toEqual(before.folders);
  expect((await state(page)).images).toEqual(before.images);
  expect((await state(page)).anchors).toEqual(before.anchors);
});

test('folder header drops nest folders or move them out through Staging, and Escape cancels without history', async ({ page }) => {
  await seed(page); const before = await state(page);
  const handle = page.getByRole('button', { name: 'Move folder Source', exact: true });
  await drag(page, handle, tile(page, 'Archive'), false);
  await expect(tile(page, 'Archive')).toHaveClass(/is-drop-target/);
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await state(page)).toEqual(before);
  await drag(page, handle, tile(page, 'Archive'));
  await expectPath(page, 'deep', 'Archive/Source/Child/Deep');
  expect((await state(page)).images).toEqual(before.images);
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click();
  await expectPath(page, 'source', 'Source');
  await page.getByRole('button', { name: 'Open folder Source', exact: true }).click();
  const breadcrumbs = page.getByRole('navigation', { name: 'Folder navigation', exact: true });
  await drag(page, page.getByRole('button', { name: 'Move folder Source/Child', exact: true }), breadcrumbs.locator('[data-folder-destination="root"]'), false);
  await expect(breadcrumbs.locator('[data-folder-destination="root"]')).toHaveClass(/is-stash-exit-target/);
  await expect(breadcrumbs.locator('[data-folder-destination="root"]')).toHaveCSS('background-color', 'rgb(179, 229, 198)');
  await expect(breadcrumbs.locator('[data-folder-destination="root"]')).toHaveCSS('color', 'rgb(18, 51, 32)');
  await page.mouse.up();
  await expectPath(page, 'deep', 'Child/Deep');
  await expect(tile(page, 'Source/Child')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click();
  await expectPath(page, 'deep', 'Source/Child/Deep');
  await page.getByRole('button', { name: 'Open folder Source/Child', exact: true }).click();
  await drag(page, page.getByRole('button', { name: 'Move folder Source/Child/Deep', exact: true }), breadcrumbs.locator('[data-folder-destination="source"]'));
  await expectPath(page, 'deep', 'Source/Deep');
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click();
  await expectPath(page, 'deep', 'Source/Child/Deep');
  expect((await state(page)).images).toEqual(before.images);
  expect((await state(page)).anchors).toEqual(before.anchors);
});

test('collisions keep the chooser open; accepted nesting survives reload and preserves export paths and backup IDs', async ({ page }) => {
  await seed(page); const before = await state(page);
  await drag(page, page.getByRole('button', { name: 'Move folder Source', exact: true }), tile(page, 'Collision'));
  await expect(page.locator('.workspace-error')).toContainText('already exists');
  expect((await state(page)).folders).toEqual(before.folders);
  await page.getByRole('button', { name: 'Board actions', exact: true }).click();
  await menuMove(page, 'Source');
  await expect(page.locator('.workspace-error')).toHaveCount(0);
  await chooser(page).getByRole('button', { name: 'Move folder Source into Collision', exact: true }).click();
  await expect(chooser(page).getByRole('alert')).toContainText('already exists');
  expect((await state(page)).folders).toEqual(before.folders);
  await choose(page, 'Source', 'Archive');
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expectPath(page, 'deep', 'Archive/Source/Child/Deep');
  expect((await state(page)).images).toEqual(before.images);
  await openWorkspaceExport(page);
  const sortedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sorted ZIP', exact: true }).click();
  const sorted = await JSZip.loadAsync(await fs.readFile((await (await sortedDownload).path())!));
  const paths = Object.keys(sorted.files).filter(path => path.endsWith('.svg'));
  expect(paths).toEqual(expect.arrayContaining(['Archive/Source/0.svg', 'Archive/Source/Child/1.svg', 'Archive/Source/Child/Deep/2.svg', '_Unsorted/3.svg']));
  await openWorkspaceExport(page);
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Project backup (ZIP)', exact: true }).click();
  const backup = await JSZip.loadAsync(await fs.readFile((await (await backupDownload).path())!));
  const manifest = JSON.parse(await backup.file('project.json')!.async('string'));
  expect(manifest.categories).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'deep', name: 'Archive/Source/Child/Deep' })]));
  expect(manifest.images).toEqual(expect.arrayContaining([expect.objectContaining({ categoryId: 'deep', boardX: before.images.find(image => image.categoryId === 'deep').boardX })]));
});

test('the project folder list can move an empty folder out and Undo restores its nesting', async ({ page }) => {
  await seed(page); await backToProject(page);
  await page.locator('summary').filter({ hasText: /^Folders/ }).click();
  await page.getByRole('button', { name: 'Folder actions for Source/Empty', exact: true }).click();
  await page.getByRole('button', { name: 'Move folder…', exact: true }).click();
  await choose(page, 'Source/Empty', 'Staging');
  await expectPath(page, 'empty', 'Empty');
  await expect(page.getByRole('button', { name: 'Open folder Empty', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo folder move', exact: true }).click();
  await expectPath(page, 'empty', 'Source/Empty');
});
