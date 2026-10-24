import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { choosePileOrder, addBrowserImages, openPileOptions } from './pileDock';
import { fitBoard, createBoardStash, navigateOverview, backToProject, browserSelectAll } from './menuBar';

async function seed(page: Page, count: number) {
  await page.goto('/');
  await expect(page.locator('input[accept="image/*"]')).toHaveCount(1);
  await page.evaluate(async count => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#a3c6b7'; ctx.fillRect(0, 0, 320, 200); ctx.fillStyle = '#183a2d'; ctx.fillRect(40, 60, 140, 85);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    const tx = db.transaction(['projects', 'images', 'assets', 'meta'], 'readwrite');
    tx.objectStore('projects').put({ id: 'browser', name: 'Browser study', createdAt: 1, updatedAt: 1, settings: { clipEnabled: false } }, 'browser');
    tx.objectStore('meta').put('browser', 'activeProjectId');
    for (let i = 0; i < count; i++) {
      const id = `browser-${i}`;
      tx.objectStore('images').put({ id, projectId: 'browser', path: `image-${String(i).padStart(4, '0')}.png`, mime: 'image/png', size: blob.size, addedAt: i, categoryId: null, placement: 'tray' }, id);
      tx.objectStore('assets').put(blob, id);
    }
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  }, count);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await choosePileOrder(page, 'name');
}
const browser = (page: Page) => page.getByRole('region', { name: 'Image browser', exact: true });
const board = (page: Page) => page.getByRole('region', { name: 'Sorting board area' });
const boardCards = (page: Page) => board(page).locator('.card');
async function images(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const values = await new Promise<any[]>(resolve => { const r = db.transaction('images').objectStore('images').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return values;
  });
}
async function name(page: Page, value: string) { const input = page.getByRole('textbox', { name: 'Stash name', exact: true }); await input.fill(value); await input.press('Enter'); await expect(input).toHaveCount(0); }

test('browser remains project-wide through stash navigation, assignment filters and folder intake', async ({ page }) => {
  await seed(page, 12); await addBrowserImages(page, 2); await expect(boardCards(page)).toHaveCount(12);
  await boardCards(page).first().click(); await boardCards(page).nth(1).click({ modifiers: ['Shift'] });
  await createBoardStash(page); await name(page, 'Travel');
  await expect(browser(page).getByRole('button', { name: 'Unsorted 10', exact: true })).toBeVisible();
  await browser(page).getByRole('button', { name: 'Sorted 2', exact: true }).click();
  await expect(browser(page).locator('.card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Open stash Travel', exact: true }).click();
  await expect(browser(page).getByRole('button', { name: 'Sorted 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(boardCards(page)).toHaveCount(2);
  await browser(page).getByRole('button', { name: 'Unsorted 10', exact: true }).click();
  await browser(page).getByRole('group', { name: /^Card: image-0002\.png/ }).click();
  // Selection keeps the current stash and return action visible.
  await expect(page.locator('[data-current-location]')).toHaveText('Travel');
  await expect(page.getByRole('button', { name: 'Back to overview', exact: true })).toBeVisible();
  await browser(page).getByRole('button', { name: 'Move here', exact: true }).click();
  await expect(boardCards(page)).toHaveCount(3);
  await expect(browser(page).getByRole('button', { name: 'Unsorted 9', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click();
  await expect(boardCards(page)).toHaveCount(2);
  await navigateOverview(page); await expect(browser(page).locator('.card')).toHaveCount(10);
  await browser(page).getByRole('group', { name: /^Card: image-0002\.png/ }).click();
  await page.getByRole('group', { name: 'Image actions', exact: true }).getByRole('button', { name: 'Move to stash…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Move to stash', exact: true }).getByRole('button', { name: 'Move image-0002.png to Travel', exact: true }).click();
  await expect(browser(page).getByRole('button', { name: 'Unsorted 9', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Stash Travel', exact: true }).locator('.stash-tile__open')).toContainText('3 images');
  await expect(page.getByRole('button', { name: 'Top image image-0002.png in stash Travel', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/foldersort-image-browser-desktop.png' });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(browser(page).getByRole('button', { name: 'Unsorted 9', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Stash Travel', exact: true }).locator('.stash-tile__open')).toContainText('3 images');
});

test('an ordinary move is the next Undo; folder moves restore membership and placement across project navigation', async ({ page }) => {
  await seed(page, 6);
  const card = boardCards(page).first(); await card.click(); await createBoardStash(page); await name(page, 'Keep');
  const loose = boardCards(page).first(); await loose.focus();
  const before = (await images(page)).find(image => image.path === 'image-0001.png'); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Undo image move', exact: true })).toBeEnabled(); await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await images(page)).find(image => image.id === before.id)).toMatchObject({ boardX: before.boardX, boardY: before.boardY, categoryId: null });
  const savedLayout = await images(page);
  const moveRemaining = async () => {
    await browser(page).getByRole('button', { name: 'Unsorted 5', exact: true }).click(); await browserSelectAll(page);
    await page.getByRole('button', { name: 'Move to stash…', exact: true }).click();
    await page.getByRole('dialog', { name: 'Move to stash', exact: true }).getByRole('button', { name: 'Move 5 images to Keep', exact: true }).click();
  };
  await moveRemaining(); await expect(boardCards(page)).toHaveCount(0); await expect(page.locator('.undo-control')).toHaveClass(/is-fresh/);
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click(); await expect.poll(() => images(page)).toEqual(savedLayout);
  await moveRemaining(); await backToProject(page); await page.getByRole('button', { name: 'Undo stash move', exact: true }).click();
  await expect.poll(() => images(page)).toEqual(savedLayout);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(boardCards(page)).toHaveCount(5); await expect.poll(() => images(page)).toEqual(savedLayout);
});

test('3000 images stay virtualized through scroll, filtering, focus layout and resizing', async ({ page }) => {
  await seed(page, 3000);
  const region = browser(page), scroller = page.getByRole('region', { name: 'Browse project images' });
  expect(await region.locator('.card').count()).toBeLessThan(70);
  await expect(region.getByRole('button', { name: 'All 3,000', exact: true })).toBeVisible();
  await scroller.evaluate(element => element.scrollTop = element.scrollHeight);
  await expect(region.getByRole('group', { name: /^Card: image-2999\.png/ })).toBeVisible();
  expect(await region.locator('.card').count()).toBeLessThan(70);
  await openPileOptions(page); await page.getByRole('searchbox', { name: 'Find images' }).fill('image-2999');
  await expect(region.locator('.card')).toHaveCount(1);
  await region.getByRole('group', { name: /^Card: image-2999\.png/ }).click();
  await page.getByRole('searchbox', { name: 'Find images' }).fill('image-0000');
  await expect(region.locator('.image-browser__selection')).toContainText('1 selected on board');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('combobox', { name: 'Focus images' }).selectOption('3');
  await expect(region.locator('.image-browser__focus-heading')).toContainText('Next up');
  await page.getByRole('button', { name: 'Show next focus images', exact: true }).click();
  await page.getByRole('slider', { name: 'Browser thumbnail size', exact: true }).fill('144');
  expect(await region.locator('.card').count()).toBeLessThan(70);
  await page.getByRole('separator', { name: 'Resize image browser' }).focus(); await page.keyboard.press('End');
  await expect(page.getByRole('separator', { name: 'Resize image browser' })).toHaveAttribute('aria-valuenow', '560');
  await page.getByRole('button', { name: 'Filters & view' }).click();
  await page.getByRole('button', { name: 'Expand image browser', exact: true }).click();
  await expect(region).toHaveClass(/is-expanded/);
  await page.getByRole('button', { name: 'Return to sorting board', exact: true }).click();
  await page.getByRole('button', { name: 'Collapse image browser', exact: true }).click();
  await expect(region).toHaveClass(/is-collapsed/);
  await page.getByRole('button', { name: 'Show image browser', exact: true }).first().click();
  await expect(region).not.toHaveClass(/is-collapsed/);
});

test('browser, stash actions and undo remain reachable on narrow and short screens', async ({ page }) => {
  await seed(page, 12);
  for (const viewport of [{ width: 390, height: 844 }, { width: 736, height: 414 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    await expect(browser(page)).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Create stash', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Board actions', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Collapse image browser', exact: true }).click();
    await expect(browser(page)).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Show image browser', exact: true }).first().click();
    await expect(browser(page).locator('.card').first()).toBeInViewport();
    await expect.poll(() => browser(page).locator('.card img').first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await page.screenshot({ path: '/tmp/foldersort-image-browser-mobile.png' });
});

test('bulk intake moves membership once and keeps the collection and board virtualized', async ({ page }) => {
  await seed(page, 3000); await createBoardStash(page); await name(page, 'Bulk');
  await page.getByRole('button', { name: 'Open stash Bulk', exact: true }).click(); await expect(page.locator('[data-current-location]')).toHaveText('Bulk'); await expect(board(page)).not.toHaveAttribute('data-stash-navigation'); await browserSelectAll(page);
  const add = browser(page).getByRole('button', { name: 'Move here', exact: true });
  await expect(add).toBeEnabled();
  await add.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(async () => (await images(page)).filter(image => image.categoryId !== null).length).toBe(3000);
  expect(await boardCards(page).count()).toBeLessThan(100);
  expect(await browser(page).locator('.card').count()).toBeLessThan(70);
  const saved = await images(page);
  expect(new Set(saved.map(image => `${image.boardX}:${image.boardY}`)).size).toBe(3000);
  expect(saved.every(image => image.categoryId && image.categoryId === image.boardScope)).toBe(true);
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click();
  await expect(boardCards(page)).toHaveCount(0);
  await expect.poll(async () => (await images(page)).filter(image => image.categoryId === null).length).toBe(3000);
});

test('an empty Unsorted filter shows completion while stashes and all project images stay accessible', async ({ page }) => {
  await seed(page, 6); await browserSelectAll(page); await createBoardStash(page); await name(page, 'Everything');
  await browser(page).getByRole('button', { name: 'Unsorted 0', exact: true }).click();
  await expect(browser(page).locator('.image-browser__empty')).toContainText('All images sorted');
  await expect(page.getByRole('region', { name: 'Stash Everything', exact: true }).locator('.stash-tile__open')).toContainText('6 images');
  await browser(page).getByRole('button', { name: 'Sorted 6', exact: true }).click();
  await expect(browser(page).locator('.card')).toHaveCount(6);
  await browser(page).getByRole('group', { name: /^Card: image-0000\.png/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(browser(page).getByRole('group', { name: /^Card: image-0001\.png/ })).toBeFocused();
  await page.keyboard.press('Enter');
  const viewer = page.getByRole('dialog', { name: 'image-0001.png', exact: true });
  await expect(viewer.locator('.image-preview__nav')).toContainText('2 / 6');
  await page.keyboard.press('ArrowRight'); await expect(page.getByRole('dialog', { name: 'image-0002.png', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(browser(page).getByRole('group', { name: /^Card: image-0001\.png/ })).toBeFocused();
});

test('Fit board reveals a distant image without rearranging it and saves the camera on reload', async ({ page }) => {
  await seed(page, 6); await addBrowserImages(page, 2);
  await boardCards(page).first().focus();
  await page.keyboard.press('ArrowRight');
  // Drag to a distant world position by panning the actual camera first.
  await page.getByTestId('board-root').evaluate(element => element.scrollLeft += 3000);
  const before = await images(page);
  await fitBoard(page);
  await expect(boardCards(page).first()).toBeInViewport({ ratio: .99 });
  await expect(boardCards(page).nth(1)).toBeInViewport({ ratio: .99 });
  expect(await images(page)).toEqual(before);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(boardCards(page).first()).toBeInViewport({ ratio: .99 });
});

test('Undo restores a moved stash after returning from the project screen', async ({ page }) => {
  await seed(page, 6); await addBrowserImages(page, 1);
  await boardCards(page).first().click(); await createBoardStash(page); await name(page, 'Travel');
  const tile = page.getByRole('region', { name: 'Stash Travel', exact: true });
  const anchor = () => tile.evaluate(element => ({ x: (element as HTMLElement).style.left, y: (element as HTMLElement).style.top }));
  const before = await anchor();
  await page.getByRole('button', { name: 'Move stash Travel', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(anchor).not.toEqual(before);
  const moved = await anchor();
  await backToProject(page); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect.poll(anchor).toEqual(moved);
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click();
  await expect.poll(anchor).toEqual(before);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect.poll(anchor).toEqual(before);
});

test('keyboard navigation crosses focus images and the continuous thumbnail grid', async ({ page }) => {
  await seed(page, 12); await openPileOptions(page);
  await page.getByRole('combobox', { name: 'Focus images' }).selectOption('3');
  await page.getByRole('button', { name: 'Filters & view', exact: true }).click();
  const card = (index: number) => browser(page).getByRole('group', { name: new RegExp(`^Card: image-${String(index).padStart(4, '0')}\\.png`) });
  await card(0).focus(); await page.keyboard.press('ArrowRight'); await expect(card(1)).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(card(2)).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(card(3)).toBeFocused();
  await page.keyboard.press('ArrowUp'); await expect(card(2)).toBeFocused();
  await page.getByRole('button', { name: 'Show next focus images', exact: true }).click();
  await card(3).focus(); await page.keyboard.press('ArrowRight'); await expect(card(4)).toBeFocused();
});
