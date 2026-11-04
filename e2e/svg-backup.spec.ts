import { test, expect } from './persistentFixtures';
import { backToProject, createBoardStash, openProjectActions } from './menuBar';

// PNG decoding can hide missing MIME types by sniffing its bytes. SVG cannot.
test('SVG originals and regenerated previews remain readable after a ZIP backup round trip', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles([0, 1].map(index => ({
    name: `drawing-${index}.svg`, mimeType: 'image/svg+xml',
    buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${index ? 240 : 360}" height="${index ? 360 : 240}"><rect width="100%" height="100%" fill="${index ? '#b0c795' : '#b49e81'}"/></svg>`),
  })));
  await page.getByRole('button', { name: 'Add 2 images', exact: true }).click();
  const board = page.getByRole('region', { name: 'Sorting board area', exact: true });
  await expect(board.locator('.cardPreview__img')).toHaveCount(2);
  await backToProject(page); await openProjectActions(page);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Project backup (ZIP)', exact: true }).click();
  const path = (await (await download).path())!;
  await page.locator('.library-project-management summary').click();
  await page.locator('input[accept=".zip,application/zip"]').setInputFiles(path);
  await expect(page.getByRole('status').filter({ hasText: 'Project imported' })).toBeVisible();
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(board.locator('.cardPreview__img')).toHaveCount(2);
  await expect.poll(() => board.locator('.cardPreview__img').evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await board.locator('.card').first().click(); await createBoardStash(page);
  await page.getByRole('textbox', { name: 'Folder name', exact: true }).fill('Restored SVG');
  await page.getByRole('textbox', { name: 'Folder name', exact: true }).press('Enter');
  const tile = page.getByRole('region', { name: 'Folder Restored SVG', exact: true });
  await expect(tile.locator('img')).toHaveCount(1);
  await expect.poll(() => tile.locator('img').evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: 'Open folder Restored SVG', exact: true }).click();
  await expect(board.locator('.cardPreview__img')).toHaveCount(1);
  await expect.poll(() => board.locator('.cardPreview__img').evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)).toBe(true);
});
