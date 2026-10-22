import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { openBoardActions, navigateOverview } from './menuBar';

async function seedVisualStudy(page: Page) {
  await page.goto('/');
  await expect(page.locator('input[accept="image/*"]')).toHaveCount(1);
  await page.evaluate(async () => {
    const request = indexedDB.open('sortboard-image-library-minimal', 2);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['projects', 'categories', 'images', 'assets', 'meta'], 'readwrite');
    tx.objectStore('projects').put({ id: 'visual', name: 'Visual study', createdAt: 1, updatedAt: 1, settings: { clipEnabled: false } }, 'visual');
    tx.objectStore('meta').put('visual', 'activeProjectId');
    const names = ['Travel', 'Plants', 'Street', 'Travel/Coast'];
    names.forEach((name, index) => tx.objectStore('categories').put({ id: `stash-${index}`, projectId: 'visual', name, createdAt: 1, layoutInitialized: true }, `stash-${index}`));
    for (let index = 0; index < 12; index++) {
      const kind = index % 3;
      const width = index === 9 ? 480 : index === 10 ? 180 : 320;
      const height = index === 9 ? 100 : index === 10 ? 380 : 224;
      const art = kind === 0 ? '<path d="M0 160 85 45 180 150 260 60 320 160Z" fill="#718b83"/><path d="M0 190Q90 125 170 175T320 180V224H0" fill="#a1c9c7"/><circle cx="250" cy="37" r="20" fill="#f5e3b2"/>'
        : kind === 1 ? '<path d="m155 200 8-145" stroke="#5b7938" stroke-width="8"/><ellipse cx="130" cy="85" rx="22" ry="60" transform="rotate(-30 130 85)" fill="#698344"/><ellipse cx="210" cy="125" rx="58" ry="23" transform="rotate(-35 210 125)" fill="#8ca16a"/><ellipse cx="115" cy="158" rx="55" ry="22" transform="rotate(25 115 158)" fill="#91a971"/>'
        : '<path d="M0 190V90H50V20H95V145H140V65H190V175H230V45H285V125H320V224H0" fill="#9b8970"/><path d="M60 38V122M80 38V122M150 80V170M170 80V170M244 60V180M268 60V180" stroke="#e7d4a7" stroke-width="9"/>';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 320 224" preserveAspectRatio="none"><rect width="320" height="224" fill="${kind === 2 ? '#dfd5bc' : '#c7dfe2'}"/>${art}</svg>`;
      const blob = new Blob([svg], { type: 'image/svg+xml' }), id = `visual-${index}`;
      const onBoard = index < 3;
      tx.objectStore('images').put({ id, projectId: 'visual', path: `image-${String(index).padStart(2, '0')}.svg`, mime: 'image/svg+xml', size: blob.size, addedAt: index,
        categoryId: index === 0 ? 'stash-0' : index < 7 ? null : `stash-${index % 4}`, placement: onBoard ? 'board' : 'tray',
        ...(onBoard ? { boardScope: 'stash-2', boardX: [100, 430, 120][index], boardY: [120, 140, 380][index] } : {}) }, id);
      tx.objectStore('assets').put(blob, id);
    }
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
    localStorage.setItem('folder-sort-stash-view:visual', JSON.stringify({ active: 'stash-2', cameras: { 'stash-2': { x: 350, y: 330, zoom: 1 } } }));
  });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await page.getByRole('combobox', { name: 'Image browser order' }).selectOption('name');
}

test('visual reference: clear hierarchy, quiet mixed-shape thumbnails and compact stash stacks', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await seedVisualStudy(page);
  const browser = page.getByRole('region', { name: 'Image browser', exact: true });
  const nav = page.getByRole('navigation', { name: 'Stash navigation' });
  await expect(nav.getByRole('button', { name: 'Back to overview', exact: true })).toBeVisible();
  await expect(page.locator('[data-current-location]')).toHaveText('Street');
  const controls = page.getByRole('toolbar', { name: 'Board controls' });
  await expect(controls).toContainText('100%'); await expect(controls.getByRole('button', { name: 'Fit board' })).toHaveText('Fit');
  const pane = (await browser.boundingBox())!; expect(pane.width / 1440).toBeCloseTo(.34, 1);
  const order = browser.getByRole('combobox', { name: 'Image browser order' });
  await expect(order).toHaveCSS('appearance', 'none');
  expect(await order.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('data:image/svg+xml');
  const assigned = browser.locator('.card.isCategorized').first();
  await expect(assigned.locator('.card__categoryLabel')).not.toContainText('/');
  await expect(assigned.locator('.card__categoryLabel')).toHaveCSS('background-color', 'rgb(20, 35, 29)');
  await expect(assigned.locator('.card__categoryLabel')).toHaveAttribute('title', /.+/);
  expect(await assigned.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none');
  const boardAssigned = page.getByRole('region', { name: 'Sorting board area' }).locator('.card.isCategorized').first();
  await expect(boardAssigned.locator('.card__categoryLabel')).toHaveCSS('color', 'rgb(226, 237, 229)');
  expect(await boardAssigned.evaluate(element => getComputedStyle(element, '::before').content)).toBe('none');
  await expect(browser.locator('.card img')).toHaveCount(12);
  await expect.poll(() => browser.locator('.card img').evaluateAll(elements => elements.every(element => (element as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.screenshot({ path: '/tmp/foldersort-visual-spec-desktop.png' });
  await navigateOverview(page);
  await expect(page.getByRole('region', { name: 'Stash Travel', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Stash Plants', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Stash Street', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/foldersort-visual-spec-stashes.png' });
  await page.getByRole('button', { name: 'Open stash Travel', exact: true }).click();
  await page.getByRole('button', { name: 'Open stash Travel/Coast', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Back to Travel', exact: true })).toBeVisible();
  await expect(page.locator('[data-current-location]')).toHaveText('Coast');
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('button', { name: 'Back to Travel', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(controls.getByRole('button', { name: 'Create stash' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Board actions', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await openBoardActions(page, 'Board view'); await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.workspace-actions')).not.toHaveAttribute('open', '');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/foldersort-visual-spec-mobile.png' });
});
