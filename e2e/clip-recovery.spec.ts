import { test, expect } from './persistentFixtures';
import { mockClipInference } from './clipFixtures';
import { backToProject } from './menuBar';

test('restored model interruption keeps sorting available and retries only on request', async ({ page }) => {
  await mockClipInference(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('recovery-fixture')) {
      sessionStorage.setItem('recovery-fixture', '1');
      sessionStorage.setItem('foldersort:clip-active', '1');
    }
  });
  await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: 5 }, (_, index) => ({
    name: `image-${index}.svg`, mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#c49871"/></svg>'),
  })));
  const starter = page.getByRole('region', { name: 'Start with random images', exact: true });
  await starter.getByRole('button', { name: 'Add 3 images', exact: true }).click();
  await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(3);
  await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
  const geometry = () => page.locator('.sorting-workspace__board .card').evaluateAll(cards => cards.map(card => ({ id: card.getAttribute('data-image-id'), left: (card as HTMLElement).style.left, top: (card as HTMLElement).style.top })));
  const before = await geometry();
  expect(await page.evaluate(() => (window as any).clipCounts.models)).toBe(0);
  await backToProject(page);
  const status = page.getByRole('region', { name: 'CLIP indexing' });
  await expect(status).toContainText('CLIP was interrupted');
  await page.getByRole('button', { name: 'Retry CLIP indexing' }).click();
  await expect(status).toContainText('CLIP 5 / 5 indexed');
  expect(await page.evaluate(() => (window as any).clipCounts.models)).toBe(1);
  await page.reload();
  await expect(status).toContainText('CLIP 5 / 5 indexed');
  expect(await page.evaluate(() => (window as any).clipCounts)).toMatchObject({ models: 1, embeds: 0 });
  await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(3);
  expect(await geometry()).toEqual(before);
});
