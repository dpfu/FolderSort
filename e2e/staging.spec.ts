import { showImageBrowser } from './menuBar';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { createBoardStash, navigateOverview, openWorkspaceExport } from './menuBar';

const board = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const browser = (page: Page) => page.getByRole('region', { name: 'Image browser', exact: true });
const intake = (page: Page) => page.getByRole('group', { name: 'Add images to staging', exact: true });
const idle = async (page: Page) => { await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved'); };
async function seed(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: 8 }, (_, index) => ({
    name: `image-${index}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="${['#a4c6cc','#c1cc9b','#d2ad96'][index % 3]}"/><circle cx="${index * 20 + 40}" cy="80" r="30" fill="#456553"/></svg>`),
  })));
  await page.getByRole('button', { name: 'Add 3 images', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(3);
  await expect(browser(page)).toHaveClass(/is-collapsed/);
  await showImageBrowser(page);
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<any[]>(resolve => { const r = db.transaction('images').objectStore('images').getAll(); r.onsuccess = () => resolve(r.result); }); db.close(); return rows;
  });
}
async function selectPair(page: Page) {
  await board(page).locator('.card').nth(0).click(); await board(page).locator('.card').nth(1).click({ modifiers: ['Shift'] });
}

async function addWaiting(page: Page, count: number) {
  await showImageBrowser(page);
  const waiting = (await records(page)).filter(image => image.categoryId === null && image.rootOnBoard === false).slice(0, count);
  for (const [index, image] of waiting.entries()) await browser(page).getByRole('group', { name: `Card: ${image.path}. Current area: Image browser`, exact: true }).click(index ? { modifiers: ['Shift'] } : {});
  await browser(page).getByRole('button', { name: 'Add to staging', exact: true }).click(); await idle(page);
}

test('bulk removal and browser drop return images to waiting; Undo, reload and export retain every original', async ({ page }) => {
  await seed(page); await selectPair(page);
  const before = (await records(page)).filter(image => image.rootOnBoard);
  await expect(intake(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove from staging', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(1);
  expect((await records(page)).filter(image => image.rootOnBoard === false)).toHaveLength(7);
  await expect(page.getByRole('button', { name: 'Undo remove from staging', exact: true })).toBeFocused();
  await expect(page.locator('.undo-control')).toHaveClass(/is-fresh/);
  await page.getByRole('button', { name: 'Undo remove from staging', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(3);
  const after = await records(page);
  for (const image of before) expect(after.find(row => row.id === image.id)).toMatchObject({ boardX: image.boardX, boardY: image.boardY, rootOnBoard: true, categoryId: null });
  await selectPair(page);
  const box = (await board(page).locator('.card').first().boundingBox())!, destination = (await browser(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2, { steps: 2 });
  await page.mouse.move(destination.x + 40, destination.y + 25, { steps: 15 }); await page.mouse.up(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(1);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(1);
  await expect(page.locator('[data-current-location]')).toHaveText('Staging');
  await board(page).locator('.card').first().click(); await createBoardStash(page);
  const name = page.getByRole('textbox', { name: 'Folder name', exact: true }); await name.fill('Reference'); await name.press('Enter'); await idle(page);
  await expect(board(page).getByRole('region', { name: 'Folder Reference', exact: true })).toBeVisible();
  await addWaiting(page, 3);
  await expect(board(page).locator('.card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Open folder Reference', exact: true }).click(); await idle(page);
  await board(page).locator('.card').first().click(); await expect(page.getByRole('button', { name: 'Remove from staging', exact: true })).toHaveCount(0);
  await navigateOverview(page); await idle(page);
  await openWorkspaceExport(page); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export sorted ZIP', exact: true }).click();
  const zip = await JSZip.loadAsync(await fs.readFile((await (await downloading).path())!));
  const originals = Object.keys(zip.files).filter(path => path.endsWith('.svg'));
  expect(originals).toHaveLength(8); expect(originals.filter(path => path.startsWith('_Unsorted/'))).toHaveLength(4);
  expect(originals.filter(path => path.startsWith('_Staging/'))).toHaveLength(3); expect(originals.filter(path => path.startsWith('Reference/'))).toHaveLength(1);
  expect((await zip.file('assignments.csv')!.async('string')).trim().split('\r\n')).toHaveLength(9);
});

for (const width of [1440, 390]) test(`quiet Staging can restart from empty without a persistent batch control at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await seed(page);
  await expect(intake(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse image browser', exact: true }).click();
  await expect(intake(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove from staging', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(0);
  const starter = page.getByRole('region', { name: 'Start with random images', exact: true });
  await expect(starter).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo remove from staging', exact: true })).toBeFocused();
  await starter.getByRole('spinbutton').fill('2');
  await starter.getByRole('button', { name: 'Add 2 images', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(2);
  await expect(starter).toHaveCount(0); await expect(intake(page)).toHaveCount(0);
});

for (const width of [1440, 390]) test(`paired minus removes from Staging and a named folder with Undo at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await seed(page);
  await page.getByRole('button', { name: 'Deselect images', exact: true }).click();
  const staged = (await records(page)).find(image => image.rootOnBoard === true);
  const card = board(page).getByRole('group', { name: `Card: ${staged.path}`, exact: true }); await card.click();
  await expect(board(page).locator('.board')).toHaveCSS('background-color', 'rgb(25, 25, 25)');
  const pair = card.getByRole('group', { name: 'Selected image actions', exact: true });
  await expect(pair.getByRole('button', { name: /^(Add|Find) images like selected image$/ })).toBeVisible();
  const minus = pair.getByRole('button', { name: 'Remove image from staging', exact: true }); await expect(minus).toBeVisible();
  await minus.click(); await idle(page); await expect(card).toHaveCount(0);
  expect((await records(page)).find(image => image.id === staged.id)).toMatchObject({ categoryId: null, rootOnBoard: false });
  await page.getByRole('button', { name: 'Undo remove from staging', exact: true }).click(); await idle(page);
  expect((await records(page)).find(image => image.id === staged.id)).toMatchObject({ rootOnBoard: true, boardX: staged.boardX, boardY: staged.boardY });
  await card.click(); await createBoardStash(page);
  const name = page.getByRole('textbox', { name: 'Folder name', exact: true }); await name.fill('Research'); await name.press('Enter'); await idle(page);
  await page.getByRole('button', { name: 'Open folder Research', exact: true }).click(); await idle(page);
  await card.click(); const member = (await records(page)).find(image => image.id === staged.id);
  await expect(board(page).locator('.board')).toHaveCSS('background-color', 'rgb(20, 35, 29)');
  await expect(pair.locator('button.similar-image-add svg.lucide-plus')).toBeVisible();
  await expect(intake(page)).toHaveCount(0);
  await pair.getByRole('button', { name: 'Remove image from “Research”', exact: true }).click(); await idle(page);
  await expect(card).toHaveCount(0); await expect(board(page).getByText('This folder is empty.', { exact: false })).toBeVisible();
  expect((await records(page)).find(image => image.id === staged.id)).toMatchObject({ categoryId: null, rootOnBoard: false });
  await expect(page.getByRole('button', { name: 'Undo remove from folder', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Undo remove from folder', exact: true }).click(); await idle(page);
  await expect(card).toBeVisible();
  expect((await records(page)).find(image => image.id === staged.id)).toMatchObject({ categoryId: member.categoryId, stashOrder: member.stashOrder, boardX: member.boardX, boardY: member.boardY });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await idle(page);
  await expect(card).toBeVisible(); expect(await records(page)).toHaveLength(8);
});

test('folder toolbar removal returns a selected batch to waiting without affecting siblings', async ({ page }) => {
  await seed(page); await createBoardStash(page);
  const name = page.getByRole('textbox', { name: 'Folder name', exact: true }); await name.fill('Batch'); await name.press('Enter'); await idle(page);
  await page.getByRole('button', { name: 'Open folder Batch', exact: true }).click(); await idle(page); await selectPair(page);
  const before = (await records(page)).filter(image => image.categoryId);
  const actions = page.getByRole('group', { name: 'Image actions', exact: true });
  await expect(actions.locator('.workspace-selection__count')).toHaveText('2 selected');
  const remove = actions.getByRole('button', { name: 'Remove from “Batch”', exact: true });
  await expect(remove.locator('svg.lucide-image-minus')).toHaveCount(1); await remove.click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(1);
  expect((await records(page)).filter(image => image.rootOnBoard === false)).toHaveLength(7);
  await page.getByRole('button', { name: 'Undo remove from folder', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(3);
  expect((await records(page)).filter(image => image.categoryId)).toEqual(before);
});
