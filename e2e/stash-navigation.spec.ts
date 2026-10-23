import { fitBoard } from './menuBar';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const pane = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const scene = (page: Page) => page.locator('.workspace-board-scene');
const idle = async (page: Page) => {
  await expect(pane(page)).not.toHaveAttribute('data-stash-navigation');
  await expect(scene(page)).not.toHaveAttribute('inert');
};

async function seed(page: Page) {
  await page.goto('/');
  await expect(page.locator('input[accept="image/*"]')).toHaveCount(1);
  await page.evaluate(async () => {
    const request = indexedDB.open('sortboard-image-library-minimal', 2);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['projects', 'categories', 'images', 'meta'], 'readwrite');
    tx.objectStore('projects').put({ id: 'navigation', name: 'Navigation', createdAt: 1, updatedAt: 1, settings: { clipEnabled: false } }, 'navigation');
    tx.objectStore('meta').put('navigation', 'activeProjectId');
    for (const [id, name] of [['parent', 'Parent'], ['child', 'Parent/Child'], ['empty', 'Empty']]) {
      tx.objectStore('categories').put({ id, name, projectId: 'navigation', layoutInitialized: true }, id);
    }
    for (const [index, scope] of [null, 'parent', 'child'].entries()) {
      const id = `image-${index}`;
      // Missing originals are supported by the app and keep this fixture free
      // of WebKit's private-profile Blob-storage limitation.
      tx.objectStore('images').put({ id, projectId: 'navigation', path: `${id}.png`, mime: 'image/png', size: 1, addedAt: index,
        categoryId: scope, boardScope: scope, placement: 'board', boardX: 80, boardY: 90 }, id);
    }
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
    localStorage.setItem('folder-sort-board-appearance:navigation', '2');
    localStorage.setItem('folder-sort-board:navigation', JSON.stringify({ anchors: { parent: { x: 330, y: 100 }, child: { x: 300, y: 100 }, empty: { x: 650, y: 100 } } }));
  });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open stash Parent', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    (window as unknown as { navigationFrames: Keyframe[][] }).navigationFrames = [];
    Element.prototype.animate = function (frames, options) {
      if (this.classList.contains('workspace-board-scene')) (window as unknown as { navigationFrames: Keyframe[][] }).navigationFrames.push(frames as Keyframe[]);
      return original.call(this, frames, options);
    };
  });
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('sortboard-image-library-minimal', 2);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const values = await Promise.all(['images', 'categories'].map(store => new Promise<unknown[]>(resolve => {
      const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result);
    })));
    db.close(); return values;
  });
}

test('stash zoom navigation preserves nested layouts, saved cameras, browser filters and keyboard focus', async ({ page }) => {
  await seed(page); const original = await records(page);
  const board = page.getByTestId('board-root');
  await board.evaluate(node => { node.scrollLeft += 16; node.scrollTop += 12; node.dispatchEvent(new Event('scroll')); });
  const camera = await board.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }));
  const header = await page.getByRole('toolbar', { name: 'Board menu bar' }).boundingBox();
  const browser = page.getByRole('region', { name: 'Image browser', exact: true }); const browserBox = await browser.boundingBox();
  await browser.getByRole('button', { name: 'Sorted 2', exact: true }).click();
  await page.getByRole('button', { name: 'Open stash Parent', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-current-location]')).toHaveText('Parent'); await idle(page);
  await expect(page.getByRole('button', { name: 'Back to overview', exact: true })).toBeFocused();
  await expect(browser.getByRole('button', { name: 'Sorted 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Open stash Parent/Child', exact: true }).click(); await idle(page);
  await expect(pane(page).locator('.card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to Parent', exact: true }).focus(); await page.keyboard.press('Enter'); await idle(page);
  await expect(page.getByRole('button', { name: 'Open stash Parent/Child', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Back to overview', exact: true }).click(); await idle(page);
  const restored = await board.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }));
  expect(Math.abs(restored.x - camera.x)).toBeLessThan(1); expect(Math.abs(restored.y - camera.y)).toBeLessThan(1);
  expect(await page.getByRole('toolbar', { name: 'Board menu bar' }).boundingBox()).toEqual(header);
  expect(await browser.boundingBox()).toEqual(browserBox); expect(await records(page)).toEqual(original);
  const frames = await page.evaluate(() => (window as unknown as { navigationFrames: Keyframe[][] }).navigationFrames);
  expect(frames.some(sequence => sequence.at(-1)?.transform?.toString().includes('scale(1.32)'))).toBe(true);
  expect(frames.some(sequence => sequence[0]?.transform?.toString().includes('scale(1.32)'))).toBe(true);
});

test('phone taps support empty stashes, interrupted navigation, reduced motion and reload without magnifying the interface', async ({ browser, baseURL, browserName }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: browserName !== 'firefox' });
  await context.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, route => route.abort());
  try {
    const page = await context.newPage(); await seed(page); const original = await records(page);
    // A return during the outgoing half cancels the pending entry.
    await page.getByRole('button', { name: 'Open stash Parent', exact: true }).tap();
    await page.getByRole('button', { name: /^(Go to|Back to) overview$/ }).tap(); await idle(page);
    await expect(page.locator('[data-current-location]')).toHaveText('Board');
    await page.getByRole('button', { name: 'Open stash Parent', exact: true }).tap();
    await expect(page.locator('[data-current-location]')).toHaveText('Parent');
    await page.getByRole('button', { name: 'Back to overview', exact: true }).tap(); await idle(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { (window as unknown as { navigationFrames: Keyframe[][] }).navigationFrames = []; });
    // Bring the empty stash into the phone viewport.
    await fitBoard(page);
    await page.getByRole('button', { name: 'Open stash Empty', exact: true }).tap(); await idle(page);
    await expect(page.locator('[data-current-location]')).toHaveText('Empty');
    expect(await page.evaluate(() => (window as unknown as { navigationFrames: Keyframe[][] }).navigationFrames.flat().some(frame => !!frame.transform))).toBe(false);
    expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
    await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).tap();
    await expect(page.locator('[data-current-location]')).toHaveText('Empty');
    await page.getByRole('button', { name: 'Back to overview', exact: true }).tap(); await idle(page);
    expect(await records(page)).toEqual(original);
  } finally { await context.close(); }
});
