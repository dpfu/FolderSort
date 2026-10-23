import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import { mockClipInference } from './clipFixtures';
import { backToProject, createBoardStash, openBoardActions, openBoardTools, openBrowserFilters, openProjectActions } from './menuBar';
import { addBrowserImages, choosePileOrder, openPileOptions } from './pileDock';

async function fixture(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').evaluate((input: HTMLInputElement) => {
    const transfer = new DataTransfer();
    for (let index = 0; index < 12; index++) {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = ['#bc8268', '#86aab4', '#bed194'][index % 3]; ctx.fillRect(0, 0, 320, 240);
      const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), c => c.charCodeAt(0));
      transfer.items.add(new File([bytes], `image-${index}.png`, { type: 'image/png' }));
    }
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
}
const setting = (page: Page) => page.getByRole('switch', { name: 'CLIP content matching', exact: true });
const workers = (page: Page) => page.evaluate(() => (window as unknown as { clipCounts: { workers: number; models: number; embeds: number } }).clipCounts);

const saved = (page: Page) => page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
  const images = await new Promise<Array<{ id: string; path: string; clip?: { model: string; vector: string }; placement?: string; boardX?: number }>>(resolve => { const request = db.transaction('images').objectStore('images').getAll(); request.onsuccess = () => resolve(request.result); });
  db.close(); return images;
});
const addMore = (page: Page, count: number, prefix: string) => page.locator('input[accept="image/*"]').evaluate((input: HTMLInputElement, { count, prefix }) => {
  const transfer = new DataTransfer(), canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
  canvas.getContext('2d')!.fillRect(0, 0, 320, 240);
  const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), c => c.charCodeAt(0));
  for (let index = 0; index < count; index++) transfer.items.add(new File([bytes], `${prefix}-${index}.png`, { type: 'image/png' }));
  input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
}, { count, prefix });

test('automatically indexes across screens, reuses saved features, adds only new files and rebuilds safely', async ({ page }) => {
  await mockClipInference(page); await fixture(page);
  await expect.poll(async () => (await workers(page)).models).toBe(1);
  await addBrowserImages(page, 3);
  await backToProject(page);
  const status = page.getByRole('region', { name: 'CLIP indexing' });
  await expect(status).toContainText('CLIP 12 / 12 indexed');
  expect(await workers(page)).toEqual({ workers: 1, models: 1, embeds: 12 });
  const before = await saved(page); expect(before.every(image => image.clip)).toBe(true);
  await page.getByRole('button', { name: 'Explore project images' }).click(); await page.getByRole('button', { name: 'Return to sorting board', exact: true }).click(); await backToProject(page);
  expect((await workers(page)).models).toBe(1);
  await page.reload(); await expect(status).toContainText('CLIP 12 / 12 indexed');
  expect(await workers(page)).toEqual({ workers: 0, models: 0, embeds: 0 });
  await addMore(page, 2, 'new'); await expect(status).toContainText('CLIP 14 / 14 indexed');
  expect(await workers(page)).toEqual({ workers: 1, models: 1, embeds: 2 });
  const after = await saved(page); for (const image of before) expect(after.find(item => item.id === image.id)).toEqual(image);
  await page.getByRole('button', { name: 'Rebuild CLIP index' }).click();
  await expect.poll(async () => (await workers(page)).embeds).toBe(16); await expect(status).toContainText('CLIP 14 / 14 indexed');
  expect((await workers(page)).models).toBe(2);
  const rebuilt = await saved(page); for (const image of after) expect(rebuilt.find(item => item.id === image.id)).toEqual(image);
  await page.screenshot({ path: '/tmp/foldersort-auto-index-project.png', fullPage: true });
});

test('pause holds across navigation and imports; disabling keeps saved features until re-enabled', async ({ page }) => {
  await mockClipInference(page, false, 1500); await fixture(page); await backToProject(page);
  const status = page.getByRole('region', { name: 'CLIP indexing' }); await expect(status).toContainText('Loading CLIP');
  await page.getByRole('button', { name: 'Pause CLIP indexing' }).click(); await expect(status).toContainText('paused');
  await addMore(page, 2, 'paused'); await expect(status).toContainText('CLIP 0 / 14 indexed · paused'); expect((await workers(page)).embeds).toBe(0);
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  const badge = page.getByRole('button', { name: /Content index:.*paused/ }); await expect(badge).toBeInViewport(); await badge.click();
  await expect(page.getByRole('dialog', { name: 'Project settings', exact: true })).toContainText('paused'); await page.getByRole('button', { name: 'Close project settings' }).click();
  await backToProject(page); await expect(status).toContainText('paused');
  await page.getByRole('button', { name: 'Resume CLIP indexing' }).click(); await expect(status).toContainText('CLIP 14 / 14 indexed');
  await setting(page).uncheck(); await addMore(page, 1, 'disabled'); await expect(status).toContainText('Off · 14 saved'); await expect(status).toContainText('1 waiting');
  const stopped = await workers(page); await setting(page).check(); await expect(status).toContainText('CLIP 15 / 15 indexed'); expect((await workers(page)).embeds).toBe(stopped.embeds + 1);
});

test('project settings default on, persist per project and round-trip in a backup', async ({ page }) => {
  await mockClipInference(page); await fixture(page); await backToProject(page);
  await expect(setting(page)).toBeChecked(); await expect.poll(async () => (await workers(page)).models).toBe(1);
  // Keep the project store occupied to reproduce a reload before settings commit.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sortboard-image-library-minimal', 2);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const store = db.transaction('projects', 'readwrite').objectStore('projects');
    const hold = () => { store.get('pending-settings-test').onsuccess = hold; };
    hold();
  });
  await setting(page).uncheck(); await page.reload(); await expect(setting(page)).not.toBeChecked();
  const firstId = await page.getByRole('combobox', { name: 'Project', exact: true }).inputValue();
  await openProjectActions(page); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Backup ZIP' }).click();
  const backup = await downloading; const zip = await JSZip.loadAsync(await fs.readFile(await backup.path()));
  expect(JSON.parse(await zip.file('project.json')!.async('string')).settings).toEqual({ clipEnabled: false });
  await page.locator('.library-project-management summary').click(); await page.getByRole('textbox', { name: 'New project name' }).fill('Second project'); await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Second project', exact: true })).toBeVisible(); await expect(setting(page)).toBeChecked();
  await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption(firstId); await expect(setting(page)).not.toBeChecked();
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(await backup.path()); await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await expect(setting(page)).not.toBeChecked(); await page.reload(); await expect(setting(page)).not.toBeChecked();
  expect(await workers(page)).toEqual({ workers: 0, models: 0, embeds: 0 });
});

test('turning CLIP off removes every content action; color matching still works', async ({ page }) => {
  await mockClipInference(page); await fixture(page); await backToProject(page); await setting(page).uncheck(); const stopped = await workers(page); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await openPileOptions(page); await expect(page.getByRole('combobox', { name: 'Image browser order' }).locator('option[value=semantic]')).toHaveCount(0); await page.keyboard.press('Escape');
  await choosePileOrder(page, 'name');
  const cards = page.locator('.image-browser .card'); for (let i = 0; i < 3; i++) await cards.nth(i).click(i ? { modifiers: ['Shift'] } : {});
  await createBoardStash(page); const name = page.getByRole('textbox', { name: 'Stash name', exact: true }); await name.fill('Color'); await name.press('Enter');
  await page.getByRole('button', { name: 'Open stash Color', exact: true }).click(); await page.locator('.sorting-workspace__board .card').first().click();
  await page.getByRole('button', { name: 'Find similar to selected image' }).hover();
  await expect(page.getByRole('button', { name: 'Move similar images with CLIP' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Move similar images by color' }).click(); await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(6);
  await openBoardTools(page); await expect(page.getByRole('combobox', { name: 'Similarity method' }).locator('option[value=clip]')).toHaveCount(0); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Expand image browser' }).click(); await openBrowserFilters(page); await expect(page.getByRole('combobox', { name: 'Image browser order' }).locator('option[value=semantic]')).toHaveCount(0);
  expect(await workers(page)).toEqual(stopped);
});

test('mobile CLIP status uses the badge and Project settings without a duplicate Activity page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockClipInference(page, false, 10000); await fixture(page);
  await openBoardActions(page);
  const badge = page.getByRole('button', { name: /Content index: loading model/ });
  await expect(badge).toBeInViewport({ ratio: 1 }); await badge.click();
  const dialog = page.getByRole('dialog', { name: 'Project settings', exact: true });
  await expect(dialog.getByRole('region', { name: 'CLIP indexing' })).toContainText('Loading CLIP');
  await dialog.getByRole('button', { name: 'Pause CLIP indexing' }).click();
  await expect(dialog.getByRole('region', { name: 'CLIP indexing' })).toContainText('paused');
  await page.getByRole('button', { name: 'Close project settings' }).click();
  await openBoardActions(page);
  await expect(page.getByRole('button', { name: 'Activity', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'CLIP indexing' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Project settings', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Resume CLIP indexing' })).toBeVisible();
  await setting(page).uncheck(); await page.getByRole('button', { name: 'Close project settings' }).click();
  await expect(page.locator('.content-index-badge')).toHaveCount(0);
});

test('disabling content matching from the board cancels a download and allows an explicit restart', async ({ page }) => {
  await mockClipInference(page, false, 2000); await fixture(page); await choosePileOrder(page, 'semantic');
  await expect.poll(async () => (await workers(page)).models).toBe(1);
  await openBoardActions(page); await page.getByRole('button', { name: 'Project settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project settings', exact: true }); await setting(page).uncheck();
  await expect.poll(() => page.evaluate(() => (window as unknown as { clipTerminations: number }).clipTerminations)).toBe(1);
  await page.getByRole('button', { name: 'Close project settings' }).click(); await expect(dialog).toHaveCount(0);
  await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(12); expect((await workers(page)).embeds).toBe(0);
  await openBoardActions(page); await page.getByRole('button', { name: 'Project settings', exact: true }).click(); await setting(page).check(); await page.getByRole('button', { name: 'Close project settings' }).click();
  await choosePileOrder(page, 'semantic'); await expect.poll(async () => (await workers(page)).models).toBe(2); await expect.poll(async () => (await workers(page)).embeds).toBeGreaterThan(0);
});

for (const width of [320, 390, 1440]) {
  test(`project screen exposes its main actions without marketing copy at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 700 ? 900 : 844 }); await fixture(page);
    await addBrowserImages(page, 3); await backToProject(page);
    for (const name of ['Open sorting workspace', 'Explore project images', 'Export project', 'Add files', 'Add folder']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(setting(page)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.project-screen__counts')).toContainText('12 images');
    await expect(page.locator('.library-view-choices, .project-collection')).toHaveCount(0);
    await expect(page.getByText('Board saved.', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: `/tmp/foldersort-project-screen-${width}.png`, fullPage: true });
  });
}
