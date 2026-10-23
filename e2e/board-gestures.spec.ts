import type { CDPSession, Page } from '@playwright/test';
import { createBoardStash } from './menuBar';
import { test, expect } from './fixtures';
import { addBrowserImages, choosePileOrder } from './pileDock';

type Point = { x: number; y: number; id: number };
const board = (page: Page) => page.getByRole('region', { name: 'Sorting board', exact: true });
async function setup(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: 20 }, (_, i) => ({ name: `image-${String(i).padStart(2, '0')}.svg`, mimeType: 'image/svg+xml',
    buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="100%" height="100%" fill="${i % 2 ? '#a6bfa1' : '#9caecc'}"/></svg>`) })));
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  await choosePileOrder(page, 'name'); await addBrowserImages(page, 2);
  await expect.poll(() => board(page).locator('.card').count()).toBeGreaterThanOrEqual(2);
  await expect(board(page).locator('.card[data-arriving]')).toHaveCount(0);
  await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('sortboard-image-library-minimal', 2);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['images', 'categories']);
    const [images, stashes] = await Promise.all(['images', 'categories'].map(store => new Promise<any[]>(resolve => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); })));
    db.close(); return { images: images.map(({ id, boardX, boardY, categoryId, boardScope, placement, stashOrder }) => ({ id, boardX, boardY, categoryId, boardScope, placement, stashOrder })), stashes };
  });
}
async function camera(page: Page, point: { x: number; y: number }) {
  return board(page).evaluate((element, point) => {
    const canvas = element.querySelector<HTMLElement>('[data-testid="board-canvas"]')!, rect = canvas.getBoundingClientRect();
    const scale = new DOMMatrix(getComputedStyle(canvas).transform).a;
    return { scale, worldX: (point.x - rect.left) / scale, worldY: (point.y - rect.top) / scale, pageScale: visualViewport!.scale };
  }, point);
}
async function touch(session: CDPSession, page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: Point[]) {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

test.describe('native board touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.beforeEach(({ browserName }) => { test.skip(browserName !== 'chromium', 'Native multi-touch is driven through CDP.'); });

  test('pinch anchors the board, keeps the interface stable, ignores a third finger and saves the camera', async ({ page, context }) => {
    await setup(page); const original = await records(page), session = await context.newCDPSession(page);
    const rect = (await board(page).boundingBox())!, midpoint = { x: rect.x + rect.width * .53, y: rect.y + rect.height * .55 };
    const before = await camera(page, midpoint), browser = page.getByRole('region', { name: 'Image browser', exact: true });
    const chrome = await page.getByRole('toolbar', { name: 'Board menu bar' }).boundingBox(), browserBox = await browser.boundingBox();
    await touch(session, page, 'touchStart', [{ x: midpoint.x - 40, y: midpoint.y, id: 1 }, { x: midpoint.x + 40, y: midpoint.y, id: 2 }]);
    for (let i = 1; i <= 8; i++) await touch(session, page, 'touchMove', [{ x: midpoint.x - 40 - i * 2.5, y: midpoint.y, id: 1 }, { x: midpoint.x + 40 + i * 2.5, y: midpoint.y, id: 2 }]);
    await expect.poll(async () => (await camera(page, midpoint)).scale).toBeCloseTo(Math.min(2, before.scale * 1.5), 2);
    const after = await camera(page, midpoint);
    expect(Math.abs(after.worldX - before.worldX)).toBeLessThan(3); expect(Math.abs(after.worldY - before.worldY)).toBeLessThan(3);
    expect(after.pageScale).toBeCloseTo(1, 5);
    expect(await page.getByRole('toolbar', { name: 'Board menu bar' }).boundingBox()).toEqual(chrome); expect(await browser.boundingBox()).toEqual(browserBox);
    const pair = [{ x: midpoint.x - 60, y: midpoint.y, id: 1 }, { x: midpoint.x + 60, y: midpoint.y, id: 2 }];
    await touch(session, page, 'touchStart', [...pair, { x: midpoint.x, y: midpoint.y + 50, id: 3 }]);
    // A partial native release names the ending contact, not the remaining pair.
    await touch(session, page, 'touchEnd', [{ x: midpoint.x, y: midpoint.y + 50, id: 3 }]);
    await touch(session, page, 'touchMove', pair.map(point => ({ ...point, x: point.x + 20, y: point.y + 10 })));
    const translated = await camera(page, { x: midpoint.x + 20, y: midpoint.y + 10 });
    expect(Math.abs(translated.worldX - before.worldX)).toBeLessThan(3); expect(Math.abs(translated.worldY - before.worldY)).toBeLessThan(3);
    await touch(session, page, 'touchEnd', [{ x: midpoint.x - 40, y: midpoint.y + 10, id: 1 }]);
    const frozen = await camera(page, midpoint);
    await touch(session, page, 'touchMove', [{ x: midpoint.x + 95, y: midpoint.y + 25, id: 2 }]);
    expect(await camera(page, midpoint)).toEqual(frozen);
    await touch(session, page, 'touchEnd', []);
    expect(await records(page)).toEqual(original);
    // Native one-finger panning still works on a clear part of the board.
    const blank = await board(page).evaluate(element => { const b = element.getBoundingClientRect(); for (let y = b.y + 25; y < b.bottom - 45; y += 25) for (let x = b.x + 25; x < b.right - 45; x += 25) { const hit = document.elementFromPoint(x, y); if (hit?.hasAttribute('data-board-background')) return { x, y, id: 5 }; } throw new Error('No blank canvas'); });
    const panBefore = await camera(page, blank);
    await touch(session, page, 'touchStart', [blank]); await touch(session, page, 'touchMove', [{ ...blank, x: blank.x + 20, y: blank.y + 20 }]); await touch(session, page, 'touchEnd', []);
    const panAfter = await camera(page, blank); expect(panAfter.scale).toBe(panBefore.scale); expect(Math.abs(panAfter.worldX - panBefore.worldX)).toBeGreaterThan(10);
    // A pinch on the browser header must not magnify the interface; its list
    // still uses native one-finger scrolling down the clear thumbnail gutter.
    const headerY = browserBox!.y + 20;
    await touch(session, page, 'touchStart', [{ x: 100, y: headerY, id: 6 }, { x: 240, y: headerY, id: 7 }]);
    await touch(session, page, 'touchMove', [{ x: 60, y: headerY, id: 6 }, { x: 280, y: headerY, id: 7 }]);
    await touch(session, page, 'touchEnd', []);
    expect((await camera(page, midpoint)).pageScale).toBeCloseTo(1, 5);
    const list = browser.locator('.image-browser__scroll'), listBox = (await list.boundingBox())!;
    const scrollPoint = { x: listBox.x + 6, y: listBox.y + listBox.height - 20, id: 8 };
    await touch(session, page, 'touchStart', [scrollPoint]);
    for (let i = 1; i <= 8; i++) await touch(session, page, 'touchMove', [{ ...scrollPoint, y: scrollPoint.y - i * 10 }]);
    await touch(session, page, 'touchEnd', []);
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(20);
    const saved = await camera(page, midpoint);
    await expect.poll(() => page.evaluate(() => { const key = Object.keys(localStorage).find(key => key.startsWith('folder-sort-stash-view:')); return key ? JSON.parse(localStorage.getItem(key)!).cameras.root.zoom : null; })).toBeCloseTo(saved.scale, 5);
    await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
    const restored = await camera(page, midpoint); expect(restored.scale).toBeCloseTo(saved.scale, 5); expect(Math.abs(restored.worldX - saved.worldX)).toBeLessThan(3); expect(Math.abs(restored.worldY - saved.worldY)).toBeLessThan(3);
  });

  test('a second finger cancels an active image drag and leaves assignments, positions and stashes intact', async ({ page, context }) => {
    await setup(page); const original = await records(page), session = await context.newCDPSession(page), image = board(page).locator('.card').first();
    const box = (await image.boundingBox())!, rect = (await board(page).boundingBox())!;
    const first = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
    await touch(session, page, 'touchStart', [first]); await touch(session, page, 'touchMove', [{ ...first, x: first.x + 12 }]);
    await expect(image).toHaveClass(/isDragging/);
    const second = { x: Math.min(rect.x + rect.width - 20, first.x + 90), y: Math.max(rect.y + 20, first.y - 25), id: 2 };
    await touch(session, page, 'touchStart', [{ ...first, x: first.x + 12 }, second]);
    await expect(image).not.toHaveClass(/isDragging/); await expect(page.locator('.sorting-workspace__drag-ghost,.stash-group-preview')).toHaveCount(0);
    await touch(session, page, 'touchMove', [{ ...first, x: first.x - 10 }, { ...second, x: Math.min(rect.x + rect.width - 10, second.x + 10) }]);
    await touch(session, page, 'touchEnd', []);
    await expect(board(page).locator('.card[data-arriving]')).toHaveCount(0); expect(await records(page)).toEqual(original);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
    expect((await camera(page, first)).pageScale).toBeCloseTo(1, 5);
    // The next normal one-finger drag must work again, with an ordinary Undo.
    const nextBox = (await image.boundingBox())!, nextPoint = { x: nextBox.x + nextBox.width / 2, y: nextBox.y + nextBox.height / 2, id: 3 };
    await touch(session, page, 'touchStart', [nextPoint]);
    for (let i = 1; i <= 5; i++) await touch(session, page, 'touchMove', [{ ...nextPoint, x: nextPoint.x + i * 4, y: nextPoint.y + i * 2 }]);
    await touch(session, page, 'touchEnd', []);
    const undo = page.getByRole('button', { name: 'Undo image move', exact: true }); await expect(undo).toBeEnabled();
    const undoBox = (await undo.boundingBox())!;
    await session.send('Input.synthesizeTapGesture', { x: undoBox.x + undoBox.width / 2, y: undoBox.y + undoBox.height / 2, duration: 60, gestureSourceType: 'touch' });
    await expect.poll(() => records(page)).toEqual(original);
  });

  test('pinching cancels stash movement and top-image extraction without changing saved stack anchors', async ({ page, context }) => {
    await setup(page); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Select multiple images' }).click();
    await board(page).locator('.card').nth(0).tap(); await board(page).locator('.card').nth(1).tap();
    await createBoardStash(page);
    const name = page.getByRole('textbox', { name: 'Stash name', exact: true }); await name.fill('Touch stack'); await name.press('Enter'); await expect(name).toHaveCount(0);
    const session = await context.newCDPSession(page), original = await records(page);
    const anchors = () => page.evaluate(() => { const key = Object.keys(localStorage).find(key => key.startsWith('folder-sort-board:')); return key ? JSON.parse(localStorage.getItem(key)!).anchors : null; });
    const savedAnchors = await anchors();
    for (const label of ['Move stash Touch stack', 'Top image image-01.svg in stash Touch stack']) {
      const source = board(page).getByRole('button', { name: label, exact: true }), box = (await source.boundingBox())!, rect = (await board(page).boundingBox())!;
      const first = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
      await touch(session, page, 'touchStart', [first]); await touch(session, page, 'touchMove', [{ ...first, x: first.x + 12 }]);
      if (label.startsWith('Move')) await expect(page.locator('[data-group-preview]')).toHaveCount(1);
      else await expect(page.locator('.sorting-workspace__drag-ghost')).toHaveCount(1);
      const second = { x: Math.min(rect.x + rect.width - 15, first.x + 70), y: first.y + 10, id: 2 };
      await touch(session, page, 'touchStart', [{ ...first, x: first.x + 12 }, second]);
      await expect(page.locator('[data-group-preview],.sorting-workspace__drag-ghost')).toHaveCount(0);
      await touch(session, page, 'touchMove', [{ ...first, x: first.x + 4 }, { ...second, x: Math.min(rect.x + rect.width - 5, second.x + 8) }]);
      await touch(session, page, 'touchEnd', []);
      expect(await records(page)).toEqual(original); expect(await anchors()).toEqual(savedAnchors);
      await expect(page.locator('[data-current-location]')).toHaveText('Root');
      await expect(page.getByRole('button', { name: 'Undo create stash', exact: true })).toBeEnabled();
    }
  });
});

test('trackpad pinch zooms around its cursor; normal wheel scrolling keeps its usual meaning', async ({ page }) => {
  await setup(page); const original = await records(page), rect = (await board(page).boundingBox())!;
  const point = { x: rect.x + rect.width * .7, y: rect.y + rect.height * .4 }, before = await camera(page, point);
  await page.mouse.move(point.x, point.y); await page.keyboard.down('Control'); await page.mouse.wheel(0, -30); await page.keyboard.up('Control');
  await expect.poll(async () => (await camera(page, point)).scale).toBeGreaterThan(before.scale);
  const zoomed = await camera(page, point); expect(Math.abs(zoomed.worldX - before.worldX)).toBeLessThan(2); expect(Math.abs(zoomed.worldY - before.worldY)).toBeLessThan(2);
  await page.mouse.wheel(0, 70); expect((await camera(page, point)).scale).toBe(zoomed.scale); expect(await records(page)).toEqual(original);
});

test('Safari gesture fallback anchors board zoom and blocks workspace magnification; leaving restores native page gestures', async ({ page }) => {
  await setup(page); const original = await records(page), rect = (await board(page).boundingBox())!;
  const point = { x: rect.x + rect.width * .6, y: rect.y + rect.height * .4 }, before = await camera(page, point);
  const dispatch = (selector: string, type: string, scale: number) => page.locator(selector).evaluate((element, args) => {
    const event = new Event(args.type, { bubbles: true, cancelable: true });
    Object.assign(event, { scale: args.scale, clientX: args.point.x, clientY: args.point.y });
    element.dispatchEvent(event); return event.defaultPrevented;
  }, { type, scale, point });
  expect(await dispatch('[data-testid=board-root]', 'gesturestart', 1)).toBe(true);
  expect(await dispatch('[data-testid=board-root]', 'gesturechange', 1.3)).toBe(true);
  await expect.poll(async () => (await camera(page, point)).scale).toBeCloseTo(before.scale * 1.3, 2);
  await dispatch('[data-testid=board-root]', 'gestureend', 1.3);
  const after = await camera(page, point); expect(Math.abs(after.worldX - before.worldX)).toBeLessThan(2); expect(Math.abs(after.worldY - before.worldY)).toBeLessThan(2);
  expect(await dispatch('.image-browser__header', 'gesturestart', 1)).toBe(true);
  expect(await dispatch('.image-browser__header', 'gesturechange', 1.8)).toBe(true);
  expect((await camera(page, point)).scale).toBe(after.scale); expect(await records(page)).toEqual(original);
  await page.getByRole('button', { name: 'Back to project', exact: true }).click();
  expect(await dispatch('body', 'gesturestart', 1)).toBe(false);
});
