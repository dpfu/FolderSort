import { test, expect } from './persistentFixtures';
import { mockClipInference } from './clipFixtures';
import { backToProject, navigateOverview, openBoardActions, openWorkspaceExport } from './menuBar';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import type { Page } from '@playwright/test';

const board = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const controls = (page: Page) => page.getByRole('region', { name: 'Similar image suggestions', exact: true });
const naming = (page: Page) => page.getByRole('region', { name: 'Name this folder', exact: true });
const idle = async (page: Page) => { await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved'); await expect(board(page)).not.toHaveAttribute('data-stash-navigation'); };
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['images', 'categories']);
    const read = (store: string) => new Promise<any[]>(resolve => { const request = tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); });
    const [images, categories] = await Promise.all([read('images'), read('categories')]); db.close();
    return { images: images.map(({ id, categoryId, rootOnBoard, boardX, boardY }) => ({ id, categoryId, rootOnBoard, boardX, boardY })), categories };
  });
}
async function seed(page: Page) {
  await mockClipInference(page); await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: 16 }, (_, index) => ({ name: `${index < 5 ? 'other' : 'hands'}-${index}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="${index < 5 ? '#bba475' : '#88bfa1'}"/></svg>`) })));
  const starter = page.getByRole('region', { name: 'Start with random images', exact: true });
  await starter.getByRole('spinbutton').fill('1'); await starter.getByRole('button', { name: 'Add 1 image', exact: true }).click();
  await idle(page); await expect(board(page).locator('.card[data-arriving]')).toHaveCount(0); await board(page).locator('.card').click();
}
test('text search keeps drafts temporary, accepts exact positions, and rejects late results', async ({ page }) => {
  await seed(page); const before = await records(page), camera = await page.getByTestId('board-canvas').boundingBox();
  await page.getByRole('button', { name: 'Show related image suggestions', exact: true }).click();
  await controls(page).getByRole('combobox', { name: 'Suggestion method' }).selectOption('text');
  const search = controls(page).getByRole('searchbox', { name: 'Search images by subject' });
  await expect(page.locator('[data-suggestion-preview]')).toHaveCount(0);
  await search.fill('slow handshakes'); await search.press('Enter'); await search.fill('other'); await search.press('Enter');
  await expect(page.locator('[data-suggestion-preview]')).toHaveCount(3); await expect(controls(page)).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('[data-suggestion-preview] img').first()).toHaveAttribute('alt', /^other-/);
  await controls(page).getByRole('combobox', { name: 'Number of suggestions' }).selectOption('2');
  await expect(page.locator('[data-suggestion-preview]')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => (window as any).clipSearches.every((search: any) => search.done))).toBe(true);
  await expect(page.locator('[data-suggestion-preview]')).toHaveCount(2);
  expect(await page.locator('[data-suggestion-preview] img').evaluateAll(elements => elements.every(element => element.getAttribute('alt')?.startsWith('other-')))).toBe(true);
  const planned = await page.locator('[data-suggestion-preview]').evaluateAll(elements => elements.map(element => ({ id: (element as HTMLElement).dataset.suggestionPreview, x: parseInt((element as HTMLElement).style.left), y: parseInt((element as HTMLElement).style.top) })));
  expect((await records(page)).images).toEqual(before.images);
  await controls(page).getByRole('button', { name: 'Add 2', exact: true }).click(); await idle(page);
  const after = await records(page);
  for (const item of planned) expect(after.images.find(image => image.id === item.id)).toMatchObject({ boardX: item.x, boardY: item.y, rootOnBoard: true });
  expect(await page.getByTestId('board-canvas').boundingBox()).toEqual(camera);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await idle(page); expect((await records(page)).images).toEqual(before.images);
});

test('untitled creation takes no focus; first entry offers names, keyboard saves, Undo and backup retain naming state', async ({ page }) => {
  await seed(page);
  await page.getByRole('group', { name: 'Image actions', exact: true }).getByRole('button', { name: /^Create folder/ }).click(); await idle(page);
  await expect(page.getByRole('textbox', { name: 'Folder name', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open folder Untitled folder', exact: true })).toBeVisible();
  expect((await records(page)).categories[0]).toMatchObject({ unnamed: true, namingPrompted: false });
  await page.getByRole('button', { name: 'Open folder Untitled folder', exact: true }).click(); await idle(page);
  await expect(naming(page).getByRole('button', { name: 'Handshakes', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const input = naming(page).getByRole('textbox', { name: 'Folder name' }); await expect(input).toBeFocused();
  await input.press('ArrowDown'); await expect(input).toHaveValue('Hands'); await input.fill('Handshakes study'); await input.press('Enter'); await idle(page);
  await expect(page.locator('[data-current-location]')).toHaveText('Handshakes study'); await expect(naming(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo rename', exact: true }).click(); await idle(page);
  await expect(page.locator('[data-current-location]')).toHaveText('Untitled folder'); await expect(naming(page)).toHaveCount(0);
  await navigateOverview(page); await page.getByRole('button', { name: 'Open folder Untitled folder', exact: true }).click(); await idle(page); await expect(naming(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Name this folder', exact: true }).click(); await expect(naming(page)).toBeVisible();
  await naming(page).getByRole('textbox', { name: 'Folder name' }).press('Escape'); await expect(naming(page)).toHaveCount(0);
  await openWorkspaceExport(page); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Project backup (ZIP)', exact: true }).click();
  const zip = await JSZip.loadAsync(await fs.readFile(await (await downloading).path()));
  expect(JSON.parse(await zip.file('project.json')!.async('string')).categories[0]).toMatchObject({ unnamed: true, namingPrompted: true });
});

test('disabled CLIP permits manual naming and hides text search; explicit names never prompt', async ({ page }) => {
  await seed(page); await backToProject(page); await page.getByRole('switch', { name: 'Subject similarity', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await board(page).locator('.card').click();
  await page.getByRole('group', { name: 'Image actions', exact: true }).getByRole('button', { name: /^Create folder/ }).click(); await idle(page);
  await page.getByRole('button', { name: 'Open folder Untitled folder', exact: true }).click(); await idle(page);
  const input = naming(page).getByRole('textbox', { name: 'Folder name' }); await input.fill('Untitled folder'); await input.press('Enter'); await idle(page);
  await expect(page.getByRole('button', { name: 'Name this folder', exact: true })).toHaveCount(0);
  await navigateOverview(page); await page.getByRole('button', { name: 'Open folder Untitled folder', exact: true }).click(); await idle(page); await expect(naming(page)).toHaveCount(0);
  await board(page).locator('.card').click(); await page.getByRole('button', { name: 'Show related image suggestions' }).click();
  await expect(controls(page).getByRole('combobox', { name: 'Suggestion method' }).locator('option[value=text]')).toHaveCount(0);
  await page.keyboard.press('Escape'); await openBoardActions(page); // Ordinary folder actions still work.
  await expect(page.getByRole('button', { name: 'Project settings', exact: true })).toBeVisible();
});
