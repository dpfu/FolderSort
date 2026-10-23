import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { test, expect } from './fixtures';
import { createBoardStash, fitBoard, navigateOverview, openBoardActions, openWorkspaceExport } from './menuBar';

const board = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const browser = (page: Page) => page.getByRole('region', { name: 'Image browser', exact: true });
const browserImage = (page: Page, index: number) => browser(page).getByRole('group', { name: new RegExp(`^Card: photo-${index}\\.png\\.`) });
const boardImage = (page: Page, index: number) => board(page).getByRole('group', { name: `Card: photo-${index}.png`, exact: true });
const idle = async (page: Page) => {
  await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
  await expect(board(page)).not.toHaveAttribute('data-stash-navigation');
};
async function records(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('sortboard-image-library-minimal', 2);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const read = (name: string) => new Promise<any[]>(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const [images, stashes] = await Promise.all([read('images'), read('categories')]); db.close(); images.sort((a, b) => a.path.localeCompare(b.path)); return { images, stashes };
  });
}
async function fixture(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').evaluate((input: HTMLInputElement) => {
    const transfer = new DataTransfer();
    for (let i = 0; i < 8; i++) {
      const canvas = document.createElement('canvas'); canvas.width = i % 2 ? 240 : 320; canvas.height = i % 2 ? 320 : 200;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = ['#9eb8a8', '#a6b7a4', '#94b6a3'][i % 3]; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), c => c.charCodeAt(0));
      transfer.items.add(new File([bytes], `photo-${i}.png`, { type: 'image/png' }));
    }
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(browser(page)).toBeVisible(); await idle(page);
  await browser(page).getByRole('combobox', { name: 'Image browser order' }).selectOption('name');
  await expect.poll(async () => (await records(page)).images.every(image => image.boardX !== undefined)).toBe(true);
}
async function nameStash(page: Page, name: string) {
  const input = page.getByRole('textbox', { name: 'Stash name', exact: true }); await input.fill(name); await input.press('Enter'); await expect(input).toHaveCount(0); await idle(page);
}
async function create(page: Page, name: string, indices: number[] = []) {
  for (const [i, index] of indices.entries()) await browserImage(page, index).click(i ? { modifiers: ['Shift'] } : {});
  await createBoardStash(page); await nameStash(page, name);
}
async function enter(page: Page, name: string) { await page.getByRole('button', { name: `Open stash ${name}`, exact: true }).click(); await idle(page); }
async function drag(page: Page, source: Locator, point: { x: number; y: number }, hold = 0) {
  const box = (await source.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2, { steps: 2 });
  await page.mouse.move(point.x, point.y, { steps: 14 }); if (hold) await page.waitForTimeout(hold); await page.mouse.up(); await idle(page);
}
async function assertFolders(page: Page) {
  const data = await records(page);
  expect(data.images.every(image => image.categoryId === image.boardScope && image.placement === 'board')).toBe(true);
  return data;
}

test('root shows every unsorted image and the browser has no separate hiding or clearing state', async ({ page }) => {
  await fixture(page); const data = await assertFolders(page);
  expect(data.images).toHaveLength(8); expect(data.images.every(image => image.categoryId === null)).toBe(true);
  await expect(page.locator('[data-current-location]')).toHaveText('Root');
  await expect(board(page).locator('.card')).toHaveCount(8);
  await browserImage(page, 0).click(); await expect(browser(page).getByRole('button', { name: 'Move here', exact: true })).toBeDisabled();
  await openBoardActions(page);
  await expect(page.getByRole('button', { name: /^(Clear board|Clear sorted images|Remove selected images from board)$/ })).toHaveCount(0);
});

test('button and browser drag intake move into the open folder, undo membership, move to root and export correctly', async ({ page }) => {
  await fixture(page); await create(page, 'Travel', [0, 1]); await enter(page, 'Travel');
  await browserImage(page, 2).click(); await browser(page).getByRole('button', { name: 'Move here', exact: true }).click(); await idle(page);
  let data = await assertFolders(page), stash = data.stashes.find(stash => stash.name === 'Travel');
  expect(data.images.find(image => image.path === 'photo-2.png').categoryId).toBe(stash.id);
  await expect(boardImage(page, 2)).toBeVisible();
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click(); await idle(page); await expect(boardImage(page, 2)).toHaveCount(0);
  expect((await records(page)).images.find(image => image.path === 'photo-2.png').categoryId).toBeNull();
  const bounds = (await board(page).boundingBox())!;
  await drag(page, browserImage(page, 2), { x: bounds.x + bounds.width * .8, y: bounds.y + bounds.height * .72 });
  data = await assertFolders(page); expect(data.images.find(image => image.path === 'photo-2.png').categoryId).toBe(stash.id);
  await navigateOverview(page); await idle(page); await browserImage(page, 2).click(); await browser(page).getByRole('button', { name: 'Move here', exact: true }).click(); await idle(page);
  data = await assertFolders(page); expect(data.images.find(image => image.path === 'photo-2.png').categoryId).toBeNull();
  await expect(page.getByRole('region', { name: 'Stash Travel', exact: true })).toContainText('2 images');
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click(); await idle(page);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await idle(page);
  data = await assertFolders(page); expect(data.images.find(image => image.path === 'photo-2.png').categoryId).toBe(stash.id);
  await openWorkspaceExport(page); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export sorted ZIP', exact: true }).click();
  const zip = await JSZip.loadAsync(await fs.readFile((await (await downloading).path())!));
  expect(zip.file('Travel/photo-2.png')).toBeTruthy(); expect(zip.file('_Unassigned/photo-2.png')).toBeNull();
  expect(await zip.file('assignments.csv')!.async('string')).toContain('"photo-2.png","Travel","Travel/photo-2.png"');
  await page.screenshot({ path: '/tmp/foldersort-folder-boards.png' });
});

test('nested boards contain direct members; dragging onto the parent breadcrumb moves them there and undo restores the child', async ({ page }) => {
  await fixture(page); await create(page, 'Parent', [0, 1]); await enter(page, 'Parent'); await create(page, 'Child', [0]); await enter(page, 'Parent/Child');
  await browserImage(page, 1).click(); await browser(page).getByRole('button', { name: 'Move here', exact: true }).click(); await idle(page);
  let data = await assertFolders(page), child = data.stashes.find(stash => stash.name === 'Parent/Child'), parent = data.stashes.find(stash => stash.name === 'Parent');
  expect(data.images.filter(image => image.categoryId === child.id)).toHaveLength(2);
  const back = (await page.getByRole('button', { name: 'Back to Parent', exact: true }).boundingBox())!;
  await drag(page, boardImage(page, 0), { x: back.x + back.width / 2, y: back.y + back.height / 2 });
  await expect(page.locator('[data-current-location]')).toHaveText('Parent');
  data = await assertFolders(page); expect(data.images.find(image => image.path === 'photo-0.png').categoryId).toBe(parent.id);
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click(); await idle(page);
  data = await assertFolders(page); expect(data.images.find(image => image.path === 'photo-0.png').categoryId).toBe(child.id);
  await enter(page, 'Parent/Child'); await expect(boardImage(page, 0)).toBeVisible();
});

test('similar-image intake assigns matches to the current folder and one undo restores their former folders', async ({ page }) => {
  await fixture(page); await create(page, 'Matches', [0]); await enter(page, 'Matches');
  await boardImage(page, 0).click(); await page.getByRole('button', { name: 'Add similar to selected image', exact: true }).hover();
  await page.getByRole('button', { name: 'Add similar images by color', exact: true }).click();
  await expect.poll(async () => { const data = await records(page); return data.images.filter(image => image.categoryId === data.stashes[0].id).length; }).toBe(4);
  await idle(page); await assertFolders(page);
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click(); await idle(page);
  const data = await assertFolders(page); expect(data.images.filter(image => image.categoryId === data.stashes[0].id)).toHaveLength(1);
  expect(data.images.filter(image => image.categoryId === null)).toHaveLength(7);
});

test('keyboard nudging only rearranges members of the open folder', async ({ page }) => {
  await fixture(page); await create(page, 'Nudge', [0, 1]); await enter(page, 'Nudge');
  await browserImage(page, 0).click(); await browserImage(page, 2).click({ modifiers: ['Shift'] });
  const before = (await records(page)).images;
  await boardImage(page, 0).focus(); await boardImage(page, 0).press('ArrowRight'); await idle(page);
  const after = await assertFolders(page);
  expect(after.images.find(image => image.path === 'photo-0.png').boardX).toBe(before.find(image => image.path === 'photo-0.png').boardX + 32);
  expect(after.images.find(image => image.path === 'photo-2.png')).toEqual(before.find(image => image.path === 'photo-2.png'));
});

test('dragging into the image browser cancels the move and keeps folder contents visible', async ({ page }) => {
  await fixture(page); await create(page, 'Keep', [0]); await enter(page, 'Keep'); const before = (await records(page)).images;
  const rect = (await browser(page).boundingBox())!;
  await drag(page, boardImage(page, 0), { x: rect.x + 150, y: rect.y + rect.height - 120 });
  expect((await records(page)).images).toEqual(before); await expect(boardImage(page, 0)).toBeVisible();
  await navigateOverview(page); await idle(page); const tile = page.getByRole('region', { name: 'Stash Keep', exact: true });
  await drag(page, tile.locator('.stash-tile__top'), { x: rect.x + 150, y: rect.y + rect.height - 120 });
  expect((await records(page)).images).toEqual(before); await expect(tile).toContainText('1 image');
});

test('legacy mismatched locations are repaired by membership without hiding images', async ({ page }) => {
  await fixture(page); const data = await records(page), projectId = data.images[0].projectId;
  await page.evaluate(async ({ projectId, images }) => {
    const request = indexedDB.open('sortboard-image-library-minimal', 2); const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['images', 'categories', 'meta'], 'readwrite');
    for (const id of ['A', 'B']) tx.objectStore('categories').put({ id, projectId, name: id, createdAt: 1, layoutInitialized: true }, id);
    tx.objectStore('images').put({ ...images[0], categoryId: 'A', boardScope: 'B', placement: 'board' }, images[0].id);
    tx.objectStore('images').put({ ...images[1], categoryId: 'A', boardScope: 'A', placement: 'tray' }, images[1].id);
    tx.objectStore('meta').delete(`folder-boards:v1:${projectId}`);
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  }, { projectId, images: data.images });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await idle(page);
  await expect(boardImage(page, 0)).toHaveCount(0); await expect(boardImage(page, 1)).toHaveCount(0);
  await enter(page, 'A'); await expect(boardImage(page, 0)).toBeVisible(); await expect(boardImage(page, 1)).toBeVisible(); await assertFolders(page);
  await navigateOverview(page); await idle(page); await enter(page, 'B'); await expect(board(page).locator('.card')).toHaveCount(0);
});

test('a large root folder keeps every member while mounting only the visible images', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const request = indexedDB.open('sortboard-image-library-minimal', 2); const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['projects', 'images', 'meta'], 'readwrite');
    tx.objectStore('projects').put({ id: 'large-root', name: 'Large root', createdAt: 1, updatedAt: 1, settings: { clipEnabled: false } }, 'large-root'); tx.objectStore('meta').put('large-root', 'activeProjectId');
    for (let i = 0; i < 3000; i++) tx.objectStore('images').put({ id: `large-${i}`, projectId: 'large-root', path: `${String(i).padStart(4, '0')}.png`, mime: 'image/png', size: 1, addedAt: 1, categoryId: null, placement: 'tray' }, `large-${i}`);
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await idle(page);
  const data = await assertFolders(page); expect(data.images).toHaveLength(3000);
  expect(data.images.every(image => image.boardY < 100000)).toBe(true);
  expect(await board(page).locator('.card').count()).toBeLessThan(120);
  expect(await browser(page).locator('.card').count()).toBeLessThan(60);
});

test('a selected browser batch moves together and the Root breadcrumb is a destination from a nested folder', async ({ page }) => {
  await fixture(page); await create(page, 'Parent', [0]); await enter(page, 'Parent'); await create(page, 'Child', [0]); await enter(page, 'Parent/Child');
  await browserImage(page, 2).click(); await browserImage(page, 3).click({ modifiers: ['Shift'] });
  const rect = (await board(page).boundingBox())!;
  await drag(page, browserImage(page, 2), { x: rect.x + rect.width * .8, y: rect.y + rect.height * .7 });
  let data = await assertFolders(page); const child = data.stashes.find(stash => stash.name === 'Parent/Child');
  expect(data.images.filter(image => [2, 3].some(index => image.path === `photo-${index}.png`)).every(image => image.categoryId === child.id)).toBe(true);
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click(); await idle(page);
  data = await assertFolders(page); expect(data.images.filter(image => [2, 3].some(index => image.path === `photo-${index}.png`)).every(image => image.categoryId === null)).toBe(true);
  const root = (await page.getByRole('button', { name: 'Go to overview', exact: true }).boundingBox())!;
  await drag(page, boardImage(page, 0), { x: root.x + root.width / 2, y: root.y + root.height / 2 });
  await expect(page.locator('[data-current-location]')).toHaveText('Root');
  data = await assertFolders(page); expect(data.images.find(image => image.path === 'photo-0.png').categoryId).toBeNull();
});
