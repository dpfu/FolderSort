import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { backToProject, createBoardStash, navigateOverview, openWorkspaceExport } from './menuBar';

const starter = (page: Page) => page.getByRole('region', { name: 'Start with random images', exact: true });
const board = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const browser = (page: Page) => page.getByRole('region', { name: 'Image browser', exact: true });
async function idle(page: Page) { await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved'); }
async function seed(page: Page, count = 12) {
  await page.goto('/'); await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: count }, (_, i) => ({ name: `image-${i}.svg`, mimeType: 'image/svg+xml',
    buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${['#c1cc9b','#a4c6cc','#d2ad96'][i%3]}"/><circle cx="${80+i*10}" cy="120" r="50" fill="#55775b"/></svg>`) })));
  await expect(starter(page)).toBeVisible(); await idle(page);
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<any[]>(resolve => { const r = db.transaction('images').objectStore('images').getAll(); r.onsuccess = () => resolve(r.result); }); db.close(); return rows;
  });
}

for (const width of [1440, 390]) test(`one-time starter deals a distinct batch, remains centred and survives Undo/reload at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await seed(page);
  await expect(board(page).locator('.card')).toHaveCount(0); await expect(starter(page).getByRole('spinbutton')).toHaveValue('3');
  const pane = (await board(page).boundingBox())!, cue = (await starter(page).boundingBox())!;
  expect(Math.abs(cue.x + cue.width/2 - pane.x - pane.width/2)).toBeLessThan(2); expect(Math.abs(cue.y + cue.height/2 - pane.y - pane.height/2)).toBeLessThan(2);
  await expect(starter(page).locator('.board-starter__fan img')).toHaveCount(3);
  await page.screenshot({ path: `/tmp/foldersort-starter-${width === 390 ? 'mobile' : 'desktop'}.png` });
  await starter(page).getByRole('button', { name: 'Add 3 images', exact: true }).click();
  await expect(starter(page)).toHaveCount(0); await idle(page); await expect(board(page).locator('.card')).toHaveCount(3);
  let images = await records(page); expect(images.filter(image => image.rootOnBoard)).toHaveLength(3); expect(images.every(image => image.categoryId === null)).toBe(true);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(0); await expect(starter(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Deselect images', exact: true }).click();
  await browser(page).getByRole('button', { name: 'Add random', exact: true }).click(); await idle(page); await expect(board(page).locator('.card')).toHaveCount(3);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(3); await expect(starter(page)).toHaveCount(0);
  images = await records(page); expect(images.filter(image => image.rootOnBoard)).toHaveLength(3); expect(images).toHaveLength(12);
});

test('count picker clamps small collections; skipping allows manual intake without changing assignments', async ({ page }) => {
  await seed(page, 2); await expect(starter(page).getByRole('spinbutton')).toHaveValue('2');
  await expect(starter(page).getByRole('button', { name: 'More random images' })).toBeDisabled();
  await starter(page).getByRole('button', { name: 'Fewer random images' }).click(); await expect(starter(page).getByRole('spinbutton')).toHaveValue('1');
  await expect(starter(page).getByRole('button', { name: 'Fewer random images' })).toBeDisabled();
  await starter(page).getByRole('button', { name: 'Skip starter' }).click(); await expect(board(page).locator('.card')).toHaveCount(0);
  await browser(page).locator('.card').first().click(); await browser(page).getByRole('button', { name: 'Add to board', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(1);
  expect((await records(page)).every(image => image.categoryId === null)).toBe(true);
});

test('a batch can become a stash; the next batch never takes assigned images and exports include queued originals', async ({ page }) => {
  await seed(page); await starter(page).getByRole('spinbutton').fill('4'); await starter(page).getByRole('button', { name: 'Add 4 images', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(4); await createBoardStash(page);
  const name = page.getByRole('textbox', { name: 'Stash name', exact: true }); await name.fill('First'); await name.press('Enter'); await idle(page);
  await page.getByRole('button', { name: 'Open stash First', exact: true }).click(); await expect(board(page).locator('.card')).toHaveCount(4);
  await navigateOverview(page); await expect(board(page)).not.toHaveAttribute('data-stash-navigation');
  await browser(page).getByRole('button', { name: 'Add random', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(4); const images = await records(page);
  expect(images.filter(image => image.categoryId)).toHaveLength(4); expect(images.filter(image => image.rootOnBoard === false)).toHaveLength(4);
  await openWorkspaceExport(page); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export sorted ZIP', exact: true }).click();
  const zip = await JSZip.loadAsync(await fs.readFile((await (await downloading).path())!)); expect(Object.keys(zip.files).filter(path => path.endsWith('.svg'))).toHaveLength(12);
  await backToProject(page); await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await expect(starter(page)).toHaveCount(0);
});

test('reduced motion keeps the starter and intake usable without an animated welcome', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await seed(page, 1);
  await expect(starter(page)).toHaveCSS('animation-name', 'none'); await expect(starter(page).getByRole('spinbutton')).toHaveValue('1');
  await starter(page).getByRole('spinbutton').press('Enter'); await idle(page); await expect(board(page).locator('.card')).toHaveCount(1);
});

test('Root similarity adds queued matches with Undo and preserves assigned stash images', async ({ page }) => {
  await seed(page, 8); await starter(page).getByRole('spinbutton').fill('1'); await starter(page).getByRole('button', { name: 'Add 1 image', exact: true }).click();
  await expect(board(page).locator('.card')).toHaveCount(1); await idle(page);
  const queued = (await records(page)).find(image => image.rootOnBoard === false);
  await browser(page).getByRole('group', { name: `Card: ${queued.path}. Current area: Image browser`, exact: true }).click(); await createBoardStash(page);
  const name = page.getByRole('textbox', { name: 'Stash name', exact: true }); await name.fill('Keep'); await name.press('Enter'); await idle(page);
  await board(page).locator('.card').first().click(); await page.getByRole('button', { name: 'Find similar to selected image', exact: true }).hover();
  await page.getByRole('button', { name: 'Add similar images by color', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(4);
  let images = await records(page); expect(images.filter(image => image.categoryId)).toHaveLength(1); expect(images.filter(image => image.rootOnBoard === false)).toHaveLength(3);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await idle(page); await expect(board(page).locator('.card')).toHaveCount(1);
  images = await records(page); expect(images.filter(image => image.categoryId)).toHaveLength(1); expect(images.filter(image => image.rootOnBoard === false)).toHaveLength(6);
});
