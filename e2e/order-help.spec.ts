import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { mockClipInference } from './clipFixtures';

async function fixture(page: Page) {
  await mockClipInference(page);
  await page.goto('/');
  await expect(page.locator('input[accept="image/*"]')).toHaveCount(1);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result);
    });
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
    canvas.getContext('2d')!.fillRect(20, 30, 200, 100);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    const tx = db.transaction(['projects', 'images', 'assets', 'categories', 'meta'], 'readwrite');
    tx.objectStore('projects').put({ id: 'help', name: 'Help study', createdAt: 1, updatedAt: 1, settings: { clipEnabled: true } }, 'help');
    tx.objectStore('meta').put('help', 'activeProjectId');
    tx.objectStore('categories').put({ id: 'travel', projectId: 'help', name: 'Travel', createdAt: 1 }, 'travel');
    tx.objectStore('categories').put({ id: 'child', projectId: 'help', name: 'Travel/Child', createdAt: 2 }, 'child');
    [
      { id: 'two', path: 'z/image-2.png', categoryId: null, rootOnBoard: false },
      { id: 'ten', path: 'a/image-10.png', categoryId: null, rootOnBoard: false },
      { id: 'one', path: 'middle/image-1.png', categoryId: null, rootOnBoard: false },
      { id: 'direct', path: 'direct.png', categoryId: 'travel' },
      { id: 'nested-a', path: 'nested-a.png', categoryId: 'child' },
      { id: 'nested-b', path: 'nested-b.png', categoryId: 'child' },
    ].forEach((image, index) => {
      tx.objectStore('images').put({ ...image, projectId: 'help', mime: 'image/png', size: blob.size, addedAt: index,
        placement: 'board', boardScope: image.categoryId, boardX: index * 230, boardY: 40 }, image.id);
      tx.objectStore('assets').put(blob, image.id);
    });
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  });
  await page.reload();
  await expect(page.getByRole('region', { name: 'CLIP indexing' })).toContainText('6 / 6 indexed');
  await page.getByRole('button', { name: 'Open sorting workspace' }).click();
}

test('filename ordering ignores folders, reverses honestly, and linked method help is keyboard accessible', async ({ page }) => {
  await fixture(page);
  const browser = page.getByRole('region', { name: 'Image browser', exact: true });
  await browser.getByRole('button', { name: 'Unsorted 3', exact: true }).click();
  const order = browser.getByRole('combobox', { name: 'Image browser order' });
  await order.selectOption('name');
  await expect.poll(() => browser.locator('.card').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')))).toEqual(['browser-card-one', 'browser-card-two', 'browser-card-ten']);
  await browser.getByRole('button', { name: 'Reverse image order' }).click();
  await expect(order.locator('option:checked')).toHaveText('Filename · Z–A');
  await expect.poll(() => browser.locator('.card').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')))).toEqual(['browser-card-ten', 'browser-card-two', 'browser-card-one']);
  await order.selectOption('semantic');
  await expect(order.locator('option:checked')).toHaveText('Subject similarity');
  const help = browser.getByRole('button', { name: 'About image order', exact: true });
  await help.focus();
  const panel = page.getByRole('dialog', { name: 'About image order', exact: true });
  await expect(panel).toBeVisible(); await expect(panel).toContainText('Brings images with related subjects and scenes together.');
  await page.keyboard.press('Tab');
  const reference = panel.getByRole('link', { name: 'MobileCLIP-S0 reference (opens in a new tab)' });
  await expect(reference).toBeFocused();
  await expect(reference).toHaveAttribute('href', 'https://machinelearning.apple.com/research/mobileclip');
  await expect(reference).toHaveAttribute('target', '_blank');
  await page.keyboard.press('Escape'); await expect(panel).toBeHidden(); await expect(help).toBeFocused();
  await order.selectOption('similarity'); await help.click();
  await expect(panel).toContainText('Brings images with similar light-and-dark patterns together.');
  await expect(panel.getByRole('link')).toHaveAttribute('href', 'https://www.phash.org/docs/design.html');
});

test('every order has concise help, and opening help leaves memberships and board positions unchanged', async ({ page }) => {
  await fixture(page);
  const browser = page.getByRole('region', { name: 'Image browser', exact: true });
  const order = browser.getByRole('combobox', { name: 'Image browser order' });
  const help = browser.getByRole('button', { name: 'About image order', exact: true });
  const placements = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result);
    });
    const images = await new Promise<any[]>(resolve => {
      const request = db.transaction('images').objectStore('images').getAll(); request.onsuccess = () => resolve(request.result);
    });
    db.close(); return images.map(({ id, categoryId, boardX, boardY, rootOnBoard }) => ({ id, categoryId, boardX, boardY, rootOnBoard }));
  });
  const before = await placements();
  for (const [value, text] of [
    ['random', 'Shuffles the browser view.'],
    ['modified', "original file's last-modified date"],
    ['bytes', 'original file size'],
    ['resolution', 'width × height'],
    ['aspect', 'width divided by height'],
    ['name', 'Original folder names are ignored.'],
  ]) {
    await order.selectOption(value); await help.hover();
    const hint = page.getByRole('tooltip');
    await expect(hint).toContainText(text);
    expect(await hint.evaluate(node => node.matches(':popover-open'))).toBe(true);
    await page.keyboard.press('Escape'); await expect(hint).toBeHidden();
    await order.hover();
  }
  await order.selectOption('semantic'); await help.click();
  await expect(page.getByRole('dialog', { name: 'About image order', exact: true })).toBeVisible();
  await browser.getByRole('button', { name: 'All 6', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'About image order', exact: true })).toBeHidden();
  expect(await placements()).toEqual(before);
});

test.describe('touch help', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 760 } });
  test('tap toggles help without activating its control; references stay reachable', async ({ page }) => {
    await fixture(page);
    const browser = page.getByRole('region', { name: 'Image browser', exact: true });
    await browser.getByRole('combobox', { name: 'Image browser order' }).selectOption('semantic');
    const help = browser.getByRole('button', { name: 'About image order', exact: true });
    const panel = page.getByRole('dialog', { name: 'About image order', exact: true });
    await help.tap(); await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
    expect((await panel.getByRole('link').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await help.tap(); await expect(panel).toBeHidden();
    await help.tap(); await browser.getByRole('button', { name: 'All 6', exact: true }).tap(); await expect(panel).toBeHidden();
  });
});
