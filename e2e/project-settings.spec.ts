import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';
import fs from 'node:fs/promises';
import { mockClipInference } from './clipFixtures';
import { backToProject, openBoardActions, openBoardTools, openBrowserFilters, openProjectActions } from './menuBar';
import { choosePileOrder, openPileOptions } from './pileDock';

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

test('project settings default on, persist per project and round-trip in a backup', async ({ page }) => {
  await mockClipInference(page); await fixture(page); await backToProject(page);
  await expect(setting(page)).toBeChecked(); expect(await workers(page)).toEqual({ workers: 0, models: 0, embeds: 0 });
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

test('turning CLIP off removes every content action; shape and color matching still work', async ({ page }) => {
  await mockClipInference(page); await fixture(page); await backToProject(page); await setting(page).uncheck(); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await openPileOptions(page); await expect(page.getByRole('combobox', { name: 'Pile order' }).locator('option[value=semantic]')).toHaveCount(0); await page.keyboard.press('Escape');
  await choosePileOrder(page, 'name'); await page.getByRole('button', { name: 'Add next 3 images' }).click(); await page.locator('.sorting-workspace__board .card').first().click();
  await page.getByRole('button', { name: 'Add similar to selected image' }).hover();
  await expect(page.getByRole('button', { name: 'Add similar images with CLIP' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add similar images by color' }).click(); await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(6);
  await openBoardTools(page); await expect(page.getByRole('combobox', { name: 'Similarity method' }).locator('option[value=clip]')).toHaveCount(0); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Explore image pile' }).click(); await openBrowserFilters(page); await expect(page.getByRole('combobox', { name: 'Overview order' }).locator('option[value=semantic]')).toHaveCount(0);
  expect(await workers(page)).toEqual({ workers: 0, models: 0, embeds: 0 });
});

test('disabling content matching from the board cancels a download and allows an explicit restart', async ({ page }) => {
  await mockClipInference(page, false, 2000); await fixture(page); await choosePileOrder(page, 'semantic');
  await expect.poll(async () => (await workers(page)).models).toBe(1);
  await openBoardActions(page); await page.getByRole('button', { name: 'Project settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project settings', exact: true }); await setting(page).uncheck();
  await expect.poll(() => page.evaluate(() => (window as unknown as { clipTerminations: number }).clipTerminations)).toBe(1);
  await page.getByRole('button', { name: 'Close project settings' }).click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Add 3 random images' }).click(); await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(3); expect((await workers(page)).embeds).toBe(0);
  await openBoardActions(page); await page.getByRole('button', { name: 'Project settings', exact: true }).click(); await setting(page).check(); await page.getByRole('button', { name: 'Close project settings' }).click();
  await choosePileOrder(page, 'semantic'); await expect.poll(async () => (await workers(page)).models).toBe(2); await expect.poll(async () => (await workers(page)).embeds).toBeGreaterThan(0);
});

for (const width of [320, 390, 1440]) {
  test(`project screen exposes its main actions without marketing copy at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 700 ? 900 : 844 }); await fixture(page);
    await page.getByRole('button', { name: 'Add 3 random images' }).click(); await backToProject(page);
    for (const name of ['Open sorting workspace', 'Explore project images', 'Export project', 'Add files', 'Add folder']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(setting(page)).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.project-screen__counts')).toContainText('12 images');
    await expect(page.locator('.library-view-choices, .project-collection')).toHaveCount(0);
    await expect(page.getByText('Board saved.', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: `/tmp/foldersort-project-screen-${width}.png`, fullPage: true });
  });
}
