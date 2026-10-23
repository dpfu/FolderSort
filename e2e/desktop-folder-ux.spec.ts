import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import { backToProject, browserSelectAll, createBoardStash, fitBoard, navigateOverview, openBrowserFilters, openWorkspaceExport } from './menuBar';

const browser = (page: Page) => page.getByRole('region', { name: 'Image browser', exact: true });
const board = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const file = (i: number) => `image-${String(i).padStart(2, '0')}.svg`;
const svg = (i: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#98b9a5"/><text x="20" y="40">Image ${i}</text></svg>`;
async function idle(page: Page) { await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved'); await expect(board(page)).not.toHaveAttribute('data-stash-navigation'); }
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<any[]>(resolve => { const r = db.transaction('images').objectStore('images').getAll(); r.onsuccess = () => resolve(r.result); }); db.close();
    return rows.map(({ id, path, categoryId, boardX, boardY, stashOrder }) => ({ id, path, categoryId, boardX, boardY, stashOrder })).sort((a, b) => a.path.localeCompare(b.path));
  });
}
async function seed(page: Page, count = 18) {
  await page.goto('/'); await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: count }, (_, i) => ({ name: file(i), mimeType: 'image/svg+xml', buffer: Buffer.from(svg(i)) })));
  await expect(browser(page)).toBeVisible(); await idle(page);
  await expect.poll(async () => (await records(page)).every(image => image.boardX !== undefined)).toBe(true);
}
async function select(page: Page, ids: number[]) {
  await openBrowserFilters(page);
  for (const [i, id] of ids.entries()) {
    await page.getByRole('searchbox', { name: 'Find images', exact: true }).fill(file(id));
    await browser(page).getByRole('group', { name: new RegExp(`^Card: ${file(id)}\\.`) }).click(i ? { modifiers: ['Shift'] } : {});
  }
  await page.getByRole('searchbox', { name: 'Find images', exact: true }).fill('');
  await page.getByRole('button', { name: 'Filters & view', exact: true }).click();
}
async function create(page: Page, name: string, ids: number[]) {
  await select(page, ids); await createBoardStash(page);
  const input = page.getByRole('textbox', { name: 'Stash name', exact: true }); await input.fill(name); await input.press('Enter'); await idle(page);
}
async function enter(page: Page, name: string) { await page.getByRole('button', { name: `Open stash ${name}`, exact: true }).click(); await idle(page); }
async function suggestions(page: Page, id: number) {
  await board(page).getByRole('group', { name: `Card: ${file(id)}`, exact: true }).click();
  await page.getByRole('button', { name: 'Find similar to selected image', exact: true }).hover();
  return page.getByRole('region', { name: 'Similar image suggestions', exact: true });
}
async function camera(page: Page) {
  return page.getByTestId('board-root').evaluate(element => {
    const root = element.getBoundingClientRect(), canvas = element.querySelector('[data-testid="board-canvas"]')!.getBoundingClientRect();
    const scale = canvas.width / (element.querySelector('[data-testid="board-canvas"]') as HTMLElement).offsetWidth;
    return { x: (root.left + root.width / 2 - canvas.left) / scale, y: (root.top + root.height / 2 - canvas.top) / scale, scale };
  });
}

test('Root finds and reveals similar unsorted images without undoing existing stash assignments', async ({ page }) => {
  await seed(page); await create(page, 'Plants', [0, 1]); await create(page, 'Travel', [2]);
  await select(page, [3]); await browser(page).getByRole('button', { name: 'Show on board', exact: true }).click();
  const before = await records(page); const preview = await suggestions(page, 3);
  await preview.getByRole('button', { name: 'Find similar images by color', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '3 similar images found in Root' }).first()).toBeVisible();
  expect(await records(page)).toEqual(before);
  await expect(browser(page).getByRole('button', { name: 'Sorted 3', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo create stash', exact: true })).toBeEnabled();
  await expect(page.locator('.workspace-selection__count')).toHaveText('4 selected');
});

test('stash matching starts with unsorted images and other stashes require an explicit option', async ({ page }) => {
  await seed(page, 8); await create(page, 'Plants', [0]); await create(page, 'Travel', [1]); await enter(page, 'Plants');
  const before = await records(page), travel = before[1].categoryId;
  let preview = await suggestions(page, 0);
  await preview.getByRole('button', { name: 'Move similar images by color', exact: true }).click(); await idle(page);
  expect((await records(page))[1].categoryId).toBe(travel);
  await expect(browser(page).getByRole('button', { name: 'Sorted 5', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(before);
  await browser(page).getByRole('button', { name: 'Unsorted 6', exact: true }).click(); await browserSelectAll(page);
  await page.getByRole('button', { name: 'Move to stash…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Move to stash', exact: true }).getByRole('button', { name: 'Move 6 images to Travel', exact: true }).click(); await idle(page);
  const sorted = await records(page); preview = await suggestions(page, 0);
  await expect(preview.getByRole('checkbox', { name: 'Include other stashes' })).not.toBeChecked();
  await preview.getByRole('checkbox', { name: 'Include other stashes' }).check();
  await preview.getByRole('button', { name: 'Move similar images by color', exact: true }).hover();
  await expect(preview.locator('.similar-image-popover__previews small')).toHaveText(['Travel', 'Travel', 'Travel']);
  await preview.getByRole('button', { name: 'Move similar images by color', exact: true }).click(); await idle(page);
  expect((await records(page)).filter(image => image.categoryId === before[0].categoryId)).toHaveLength(4);
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(sorted);
});

test('Show on board reveals existing members without edits and browser-created stashes keep the camera steady', async ({ page }) => {
  await seed(page, 30); const original = await records(page);
  await select(page, [29]); await browser(page).getByRole('button', { name: 'Show on board', exact: true }).click();
  await expect(board(page).getByRole('group', { name: `Card: ${file(29)}`, exact: true })).toBeInViewport({ ratio: 1 });
  expect(await records(page)).toEqual(original); await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await select(page, [0, 1]); const before = await camera(page); await createBoardStash(page);
  await page.getByRole('textbox', { name: 'Stash name', exact: true }).fill('Nearby'); await page.getByRole('textbox', { name: 'Stash name', exact: true }).press('Enter'); await idle(page);
  const after = await camera(page); expect(Math.abs(before.x - after.x)).toBeLessThan(2); expect(Math.abs(before.y - after.y)).toBeLessThan(2);
  await expect(page.getByRole('region', { name: 'Stash Nearby', exact: true })).toBeInViewport({ ratio: 1 });
  expect((await records(page)).slice(2)).toEqual(original.slice(2));
});

test('Fit and folder cameras remain visually stable across navigation and reopening a tall desktop workspace', async ({ page }) => {
  await page.setViewportSize({ width: 989, height: 1459 }); await seed(page); await create(page, 'Plants', [0, 1]); await create(page, 'Travel', [16, 17]); await fitBoard(page);
  await expect(page.getByRole('region', { name: 'Stash Plants', exact: true })).toBeInViewport({ ratio: .99 });
  await expect(page.getByRole('region', { name: 'Stash Travel', exact: true })).toBeInViewport({ ratio: .99 });
  const before = await camera(page); await enter(page, 'Plants'); await navigateOverview(page); await idle(page);
  let after = await camera(page); expect(Math.abs(before.x - after.x)).toBeLessThan(2); expect(Math.abs(before.y - after.y)).toBeLessThan(2);
  await backToProject(page); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await idle(page);
  after = await camera(page); expect(Math.abs(before.x - after.x)).toBeLessThan(2); expect(Math.abs(before.y - after.y)).toBeLessThan(2);
});

test('export names the entire project and current board explicitly and preserves all originals and nested folders', async ({ page }) => {
  await seed(page); await create(page, 'Plants', [0, 1]); await enter(page, 'Plants'); await create(page, 'Details', [2]);
  await openWorkspaceExport(page);
  await expect(page.getByRole('heading', { name: 'Entire project · images + CSV', exact: true })).toBeVisible();
  await expect(page.locator('.workspace-export')).toContainText('18 images · 15 unsorted');
  await expect(page.getByRole('heading', { name: 'Current board · Plants', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export sorted ZIP', exact: true }).click();
  const zip = await JSZip.loadAsync(await fs.readFile((await (await downloading).path())!));
  expect(Object.keys(zip.files).filter(path => path.endsWith('.svg'))).toHaveLength(18);
  expect(await zip.file(`Plants/${file(0)}`)!.async('string')).toBe(svg(0));
  expect(await zip.file(`Plants/Details/${file(2)}`)!.async('string')).toBe(svg(2));
  expect(await zip.file('assignments.csv')!.async('string')).toContain(`"${file(3)}","","_Unassigned/${file(3)}"`);
});
