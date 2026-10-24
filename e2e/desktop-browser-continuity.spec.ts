import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { backToProject, browserSelectAll, createBoardStash, fitBoard, navigateOverview, openBoardActions, openBrowserFilters, zoomBoard } from './menuBar';

const browser = (page: Page) => page.getByRole('region', { name: 'Image browser', exact: true });
const board = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const scroller = (page: Page) => page.getByRole('region', { name: 'Browse project images', exact: true });
const idle = (page: Page) => expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
async function seed(page: Page, count = 20) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: count }, (_, i) => ({
    name: `${i < count / 2 ? 'plants' : 'travel'}-${String(i).padStart(3, '0')}.svg`, mimeType: 'image/svg+xml',
    buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="${i < count / 2 ? '#aac393' : '#a2c6cf'}"/><text x="20" y="100">${i}</text></svg>`),
  })));
  await page.getByRole('button', { name: 'Skip starter', exact: true }).click(); await idle(page);
  await browser(page).getByRole('combobox', { name: 'Image browser order' }).selectOption('name');
}
async function nameStash(page: Page, name: string) {
  const input = page.getByRole('textbox', { name: 'Stash name', exact: true });
  await input.fill(name); await input.press('Enter'); await expect(input).toHaveCount(0); await idle(page);
}
async function makeStash(page: Page, name: string, count = 2) {
  for (let i = 0; i < count; i++) await browser(page).locator('.card').nth(i).click(i ? { modifiers: ['Shift'] } : {});
  await createBoardStash(page); await nameStash(page, name);
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const images = await new Promise<any[]>(resolve => { const r = db.transaction('images').objectStore('images').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return images;
  });
}

test('random intake respects search, assignment and stash filters without creating hidden selections', async ({ page }) => {
  await seed(page); await makeStash(page, 'Keep');
  await browser(page).getByRole('button', { name: 'Sorted 2', exact: true }).click();
  await expect(browser(page).getByRole('button', { name: 'Add random', exact: true })).toBeDisabled();
  await expect(browser(page).locator('.image-browser__selection')).toHaveText('0 waiting');
  expect((await records(page)).filter(image => image.rootOnBoard)).toHaveLength(0);
  await browser(page).getByRole('button', { name: 'All 20', exact: true }).click(); await openBrowserFilters(page);
  await browser(page).getByRole('combobox', { name: 'Filter images by stash' }).selectOption({ label: 'Keep' });
  await expect(browser(page).getByRole('button', { name: 'Add random', exact: true })).toBeDisabled();
  await browser(page).getByRole('button', { name: 'Clear filters', exact: true }).click();
  await browser(page).getByRole('searchbox', { name: 'Find images' }).fill('travel-');
  await expect(browser(page).locator('.image-browser__selection')).toHaveText('10 waiting');
  await browser(page).getByRole('button', { name: 'Add random', exact: true }).click(); await idle(page);
  const added = (await records(page)).filter(image => !image.categoryId && image.rootOnBoard);
  expect(added).toHaveLength(3); expect(added.every(image => image.path.startsWith('travel-'))).toBe(true);
  await expect(browser(page).locator('.image-browser__selection')).toHaveText('3 selected');
  await expect(board(page).locator('.card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await idle(page);
  expect((await records(page)).filter(image => !image.categoryId && image.rootOnBoard)).toHaveLength(0);
  await page.getByRole('button', { name: 'Deselect images', exact: true }).click();
  await browser(page).getByRole('searchbox', { name: 'Find images' }).fill('not-present');
  await expect(browser(page).getByRole('button', { name: 'Add random', exact: true })).toBeDisabled();
});

test('current-folder filtering includes queued Root images and only direct members of an open stash', async ({ page }) => {
  await seed(page, 12);
  await browser(page).locator('.card').first().click(); await browser(page).getByRole('button', { name: 'Add to board', exact: true }).click(); await idle(page);
  await page.getByRole('button', { name: 'Deselect images', exact: true }).click(); await openBrowserFilters(page);
  await browser(page).getByRole('checkbox', { name: 'In this folder only', exact: true }).check();
  await expect(browser(page).locator('.image-browser__header>span')).toHaveText('12 / 12'); await expect(browser(page).locator('.image-browser__on-board')).toHaveText('On board');
  await expect(browser(page).locator('.image-browser__selection')).toHaveText('11 waiting');
  await makeStash(page, 'Parent'); await expect(browser(page).locator('.image-browser__header>span')).toHaveText('10 / 12');
  await page.getByRole('button', { name: 'Open stash Parent', exact: true }).click(); await expect(browser(page).locator('.card')).toHaveCount(2);
  await makeStash(page, 'Child', 1); await expect(browser(page).locator('.card')).toHaveCount(1);
  await expect(board(page).getByRole('button', { name: 'Open stash Parent/Child', exact: true })).toBeVisible();
  await navigateOverview(page); await expect(browser(page).locator('.image-browser__header>span')).toHaveText('10 / 12');
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await openBrowserFilters(page); await expect(browser(page).getByRole('checkbox', { name: 'In this folder only', exact: true })).toBeChecked();
  await expect(browser(page).locator('.image-browser__header>span')).toHaveText('10 / 12');
});

test('browser order, direction, random sequence and scroll position survive reopening and reload', async ({ page }) => {
  await seed(page, 96); await browser(page).getByRole('button', { name: 'Reverse image order', exact: true }).click();
  await scroller(page).evaluate(element => { element.scrollTop = 1000; });
  await expect.poll(() => scroller(page).evaluate(element => element.scrollTop)).toBe(1000);
  await backToProject(page); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(browser(page).getByRole('combobox', { name: 'Image browser order' })).toHaveValue('name');
  await expect(browser(page).getByRole('button', { name: 'Reverse image order', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => scroller(page).evaluate(element => element.scrollTop)).toBe(1000);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(browser(page).getByRole('combobox', { name: 'Image browser order' })).toHaveValue('name');
  await expect.poll(() => scroller(page).evaluate(element => element.scrollTop)).toBe(1000);
  await browser(page).getByRole('button', { name: 'Collapse image browser', exact: true }).click();
  await browser(page).getByRole('button', { name: 'Show image browser', exact: true }).first().click();
  await expect.poll(() => scroller(page).evaluate(element => element.scrollTop)).toBe(1000);
  await browser(page).getByRole('combobox', { name: 'Image browser order' }).selectOption('random');
  await expect.poll(() => scroller(page).evaluate(element => element.scrollTop)).toBe(0);
  const visibleIds = () => browser(page).locator('.card').evaluateAll(elements => elements.map(element => element.getAttribute('data-testid')));
  const before = await visibleIds();
  await browser(page).getByRole('button', { name: 'Shuffle images', exact: true }).click();
  await expect.poll(visibleIds).not.toEqual(before); const shuffled = await visibleIds();
  await backToProject(page); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(browser(page).getByRole('combobox', { name: 'Image browser order' })).toHaveValue('random');
  await expect.poll(visibleIds).toEqual(shuffled);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect.poll(visibleIds).toEqual(shuffled);
});

test('project stash names open the requested board; Rename is separate and preserves its parent', async ({ page }) => {
  await seed(page, 8); await makeStash(page, 'Parent');
  await page.getByRole('button', { name: 'Open stash Parent', exact: true }).click(); await makeStash(page, 'Child', 1);
  await backToProject(page); await page.locator('.project-stashes>summary').click();
  await page.getByRole('button', { name: 'Open stash Parent/Child', exact: true }).click();
  await expect(page.locator('[data-current-location]')).toHaveText('Child'); await expect(board(page).locator('.card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Back to Parent', exact: true })).toBeVisible();
  await backToProject(page); await page.locator('.project-stashes>summary').click();
  await page.getByRole('button', { name: 'Stash actions for Parent/Child', exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename stash', exact: true });
  await expect(rename.getByRole('textbox', { name: 'Stash name', exact: true })).toHaveValue('Child');
  await rename.getByRole('textbox', { name: 'Stash name', exact: true }).fill(''); await expect(rename.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await rename.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open stash Parent/Child', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stash actions for Parent/Child', exact: true }).click(); await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await rename.getByRole('textbox', { name: 'Stash name', exact: true }).fill('Details'); await rename.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rename).toHaveCount(0); await expect(page.getByRole('button', { name: 'Open stash Parent/Details', exact: true })).toBeVisible();
  const before = await records(page); await page.getByRole('button', { name: 'Open stash Parent', exact: true }).click();
  await expect(page.locator('[data-current-location]')).toHaveText('Parent'); await expect(board(page).locator('.card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open stash Parent/Details', exact: true })).toBeVisible();
  expect((await records(page)).map(({ id, categoryId }) => ({ id, categoryId }))).toEqual(before.map(({ id, categoryId }) => ({ id, categoryId })));
  await page.screenshot({ path: '/tmp/foldersort-browser-fixes-desktop.png' });
});

test('repeated stash creation and returning reveal the stack without rearranging saved anchors', async ({ page }) => {
  await page.setViewportSize({ width: 1164, height: 656 }); await seed(page, 18);
  await browser(page).getByRole('button', { name: /^Unsorted / }).click();
  const contained = async (name: string) => {
    await expect.poll(async () => {
      const tile = await page.getByRole('region', { name: `Stash ${name}`, exact: true }).boundingBox(), pane = await board(page).boundingBox();
      return !!tile && !!pane && tile.x >= pane.x - 1 && tile.y >= pane.y - 1 && tile.x + tile.width <= pane.x + pane.width + 1 && tile.y + tile.height <= pane.y + pane.height + 1;
    }).toBe(true);
  };
  for (const name of ['Botany', 'Travel', 'Street']) {
    await makeStash(page, name); await contained(name);
    await page.getByRole('button', { name: `Open stash ${name}`, exact: true }).click();
    await expect(page.locator('[data-current-location]')).toHaveText(name);
    await navigateOverview(page); await contained(name);
  }
  const anchors = () => page.locator('[data-board-group-id]').evaluateAll(elements => elements.map(element => [element.getAttribute('data-board-group-id'), (element as HTMLElement).style.left, (element as HTMLElement).style.top]));
  const before = await anchors(); await page.getByRole('button', { name: 'Open stash Street', exact: true }).click();
  await expect(page.locator('[data-current-location]')).toHaveText('Street');
  await page.setViewportSize({ width: 1164, height: 500 }); await navigateOverview(page); await contained('Street');
  await expect(page.locator('.workspace-fit')).toBeVisible(); await fitBoard(page);
  for (const name of ['Botany', 'Travel', 'Street']) await contained(name);
  expect(await anchors()).toEqual(before);
  await zoomBoard(page, 'in');
  const savedZoom = await page.getByRole('button', { name: 'Board zoom', exact: true }).innerText();
  await backToProject(page); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Board zoom', exact: true })).toHaveText(savedZoom);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Board zoom', exact: true })).toHaveText(savedZoom);
});

test('Root and Unsorted are searchable move destinations; unmatched search has a recovery state', async ({ page }) => {
  await seed(page, 6); await makeStash(page, 'Keep', 1);
  await page.getByRole('button', { name: 'Open stash Keep', exact: true }).click();
  await board(page).locator('.card').first().click(); await page.getByRole('button', { name: 'Move to stash…', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Move to stash', exact: true }), query = picker.getByRole('searchbox', { name: 'Find stashes' });
  await query.fill('  ROOT  '); await expect(picker.locator('.stash-picker__list button')).toHaveCount(1);
  await query.fill('unsorted'); await expect(picker.getByRole('button', { name: /Root Unsorted/ })).toBeVisible();
  await query.fill('not-present'); await expect(picker.getByRole('status')).toHaveText('No stashes match “not-present”.');
  await query.fill('root'); await picker.getByRole('button', { name: /Root Unsorted/ }).click(); await idle(page);
  expect((await records(page)).filter(image => image.categoryId)).toHaveLength(0);
  expect((await records(page)).filter(image => image.rootOnBoard)).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click(); await idle(page);
  expect((await records(page)).filter(image => image.categoryId)).toHaveLength(1);
});

test('rename conflicts stay in the form with stash language and can be corrected', async ({ page }) => {
  await seed(page, 8); await browser(page).getByRole('button', { name: /^Unsorted / }).click();
  await makeStash(page, 'Botany'); await makeStash(page, 'Travel');
  await page.getByRole('button', { name: 'Stash actions for Travel', exact: true }).click(); await page.getByRole('button', { name: 'Rename stash Travel', exact: true }).click();
  const name = page.getByRole('textbox', { name: 'Stash name', exact: true });
  await name.fill(''); await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await name.fill('Botany'); await name.press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(1); await expect(page.getByRole('alert')).toHaveText('A stash with this name already exists.');
  await expect(name).toHaveAttribute('aria-invalid', 'true'); await expect(page.locator('.workspace-actions')).not.toHaveAttribute('open', '');
  await expect(name).toBeFocused();
  const error = await page.getByRole('alert').boundingBox(), head = await page.getByRole('region', { name: 'Stash Travel', exact: true }).locator('.stash-tile__head').boundingBox();
  expect(error!.y).toBeGreaterThanOrEqual(head!.y + head!.height - 1);
  await name.fill('Journeys'); await name.press('Enter'); await expect(name).toHaveCount(0); await expect(page.getByRole('alert')).toHaveCount(0);
  await backToProject(page); await page.locator('.project-stashes>summary').click();
  await page.getByRole('button', { name: 'Stash actions for Journeys', exact: true }).click(); await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename stash', exact: true }); await dialog.getByRole('textbox', { name: 'Stash name' }).fill('Botany'); await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(1); await expect(dialog.getByRole('alert')).toHaveText('A stash with this name already exists.');
  await expect(dialog.getByRole('textbox', { name: 'Stash name' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('empty-only deletion is available on the tile, inside the stash and in the project; Undo restores it', async ({ page }) => {
  await seed(page, 6); await makeStash(page, 'Parent', 1);
  await page.getByRole('button', { name: 'Stash actions for Parent', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete empty stash Parent', exact: true })).toBeDisabled(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open stash Parent', exact: true }).click(); await createBoardStash(page); await nameStash(page, 'Empty');
  await page.getByRole('button', { name: 'Stash actions for Parent/Empty', exact: true }).click();
  await page.locator('.stash-tile__menu').getByRole('button', { name: 'Delete empty stash Parent/Empty', exact: true }).click(); await idle(page);
  await expect(page.getByRole('button', { name: 'Open stash Parent/Empty', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo delete stash', exact: true }).click(); await idle(page);
  await page.getByRole('button', { name: 'Open stash Parent/Empty', exact: true }).click(); await expect(page.locator('[data-current-location]')).toHaveText('Empty');
  await openBoardActions(page); await page.getByRole('button', { name: 'Delete empty stash Parent/Empty', exact: true }).click(); await idle(page);
  await expect(page.locator('[data-current-location]')).toHaveText('Parent');
  await page.getByRole('button', { name: 'Undo delete stash', exact: true }).click(); await idle(page);
  await backToProject(page); await page.locator('.project-stashes>summary').click();
  await page.getByRole('button', { name: 'Stash actions for Parent/Empty', exact: true }).click(); await page.getByRole('button', { name: 'Delete empty stash Parent/Empty', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open stash Parent/Empty', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo delete stash', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open stash Parent/Empty', exact: true })).toBeVisible();
  expect((await records(page)).filter(image => image.categoryId)).toHaveLength(1);
  await page.reload(); await page.locator('.project-stashes>summary').click(); await expect(page.getByRole('button', { name: 'Open stash Parent/Empty', exact: true })).toBeVisible();
});

test('finishing a filtered group offers the remaining unsorted images without hidden selected counts', async ({ page }) => {
  await seed(page, 12); await makeStash(page, 'Botany', 1); await page.getByRole('button', { name: 'Open stash Botany', exact: true }).click();
  await browser(page).getByRole('button', { name: /^Unsorted / }).click(); await openBrowserFilters(page);
  await browser(page).getByRole('searchbox', { name: 'Find images' }).fill('plants-'); await page.getByRole('button', { name: 'Filters & view', exact: true }).click();
  await expect(browser(page).getByRole('button', { name: 'Clear search: plants-', exact: true })).toBeVisible();
  await browserSelectAll(page); await browser(page).getByRole('button', { name: 'Move here', exact: true }).click(); await idle(page);
  await expect(browser(page).locator('.image-browser__empty')).toContainText('Matching images sorted');
  await expect(browser(page).locator('.image-browser__selection')).toHaveText('5 selected on board');
  await expect(browser(page).locator('.image-browser__empty')).toContainText('6 unsorted images remain');
  await browser(page).getByRole('button', { name: 'Continue with unsorted', exact: true }).click();
  await expect(browser(page).getByRole('button', { name: 'Unsorted 6', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(browser(page).locator('.image-browser__header>span')).toHaveText('6 / 12'); await expect(page.getByRole('button', { name: 'Deselect images', exact: true })).toHaveCount(0);
  await expect(browser(page).getByRole('button', { name: /^Clear search:/ })).toHaveCount(0);
  expect((await records(page)).filter(image => image.categoryId)).toHaveLength(6);
  await page.screenshot({ path: '/tmp/foldersort-five-flow.png' });
});

test('mixed intake retains the whole comparison selection in Root and in a stash', async ({ page }) => {
  await seed(page, 12);
  for (let i = 0; i < 2; i++) await browser(page).locator('.card').nth(i).click(i ? { modifiers: ['Shift'] } : {});
  await browser(page).getByRole('button', { name: 'Add to board', exact: true }).click(); await idle(page);
  const initial = await records(page), first = initial.filter(image => image.rootOnBoard).map(({ id, boardX, boardY }) => ({ id, boardX, boardY }));
  for (const i of [2, 3]) await browser(page).locator('.card').nth(i).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('button', { name: 'Stash 4 images', exact: true })).toBeVisible();
  await browser(page).getByRole('button', { name: 'Add to board', exact: true }).click(); await idle(page);
  await expect(browser(page).locator('.image-browser__selection')).toHaveText('4 selected');
  await expect(board(page).locator('.card')).toHaveCount(4);
  expect((await records(page)).filter(image => first.some(item => item.id === image.id)).map(({ id, boardX, boardY }) => ({ id, boardX, boardY }))).toEqual(first);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(2);
  await browser(page).getByRole('button', { name: 'Add to board', exact: true }).click(); await idle(page);
  await createBoardStash(page); await nameStash(page, 'Batch');
  const assigned = await records(page); expect(assigned.filter(image => image.categoryId)).toHaveLength(4);
  await page.getByRole('button', { name: 'Open stash Batch', exact: true }).click();
  await expect(page.locator('[data-current-location]')).toHaveText('Batch');
  await idle(page); const beforeMove = await records(page);
  for (const [n, i] of [0, 4, 5].entries()) await browser(page).locator('.card').nth(i).click(n ? { modifiers: ['Shift'] } : {});
  await browser(page).getByRole('button', { name: 'Move here', exact: true }).click(); await idle(page);
  await expect(browser(page).locator('.image-browser__selection')).toHaveText('3 selected');
  await expect(page.getByRole('button', { name: 'Stash 3 images', exact: true })).toBeVisible();
  expect((await records(page)).filter(image => image.categoryId)).toHaveLength(6);
  await page.getByRole('button', { name: 'Undo stash move', exact: true }).click(); await idle(page);
  expect((await records(page)).map(({ id, categoryId, boardX, boardY }) => ({ id, categoryId, boardX, boardY }))).toEqual(beforeMove.map(({ id, categoryId, boardX, boardY }) => ({ id, categoryId, boardX, boardY })));
  await page.screenshot({ path: '/tmp/foldersort-mixed-intake-fixed.png' });
});

test('only initial naming groups with stash creation; later renames undo independently', async ({ page }) => {
  await seed(page, 8); const before = await records(page);
  await makeStash(page, 'Reading');
  await expect(page.getByRole('button', { name: 'Undo create stash', exact: true })).toBeEnabled();
  const assigned = await records(page);
  await page.getByRole('button', { name: 'Stash actions for Reading', exact: true }).click();
  await page.getByRole('button', { name: 'Rename stash Reading', exact: true }).click(); await nameStash(page, 'Reading later');
  await expect(page.getByRole('button', { name: 'Undo rename', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo rename', exact: true }).click(); await idle(page);
  await expect(page.getByRole('button', { name: 'Open stash Reading', exact: true })).toBeVisible();
  expect(await records(page)).toEqual(assigned);
  await page.getByRole('button', { name: 'Undo create stash', exact: true }).click(); await idle(page);
  expect(await records(page)).toEqual(before);
  // Accepting or cancelling the default name also ends the creation form.
  for (const initial of ['accept', 'cancel']) {
    await createBoardStash(page);
    const input = page.getByRole('textbox', { name: 'Stash name', exact: true });
    const original = await input.inputValue(); await input.press(initial === 'accept' ? 'Enter' : 'Escape');
    await expect(input).toHaveCount(0);
    await page.getByRole('button', { name: `Stash actions for ${original}`, exact: true }).click();
    await page.getByRole('button', { name: `Rename stash ${original}`, exact: true }).click(); await nameStash(page, 'Scratch');
    await page.getByRole('button', { name: 'Undo rename', exact: true }).click(); await idle(page);
    await expect(page.getByRole('button', { name: `Open stash ${original}`, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Undo create stash', exact: true }).click(); await idle(page);
    await expect(page.getByRole('button', { name: `Open stash ${original}`, exact: true })).toHaveCount(0);
  }
});

test('Unsorted in the current stash offers local images or the project-wide queue without edits', async ({ page }) => {
  await seed(page, 12); await makeStash(page, 'Parent', 3);
  await page.getByRole('button', { name: 'Open stash Parent', exact: true }).click(); await makeStash(page, 'Child', 1);
  const before = await records(page);
  await browser(page).getByRole('button', { name: 'Unsorted 9', exact: true }).click(); await openBrowserFilters(page);
  await browser(page).getByRole('checkbox', { name: 'In this folder only', exact: true }).check();
  await browser(page).getByRole('searchbox', { name: 'Find images' }).fill('travel-');
  await browser(page).getByRole('button', { name: 'Filters & view', exact: true }).click();
  await expect(browser(page).locator('.image-browser__empty')).toContainText('No unsorted images in Parent');
  await expect(browser(page).locator('.image-browser__empty')).toContainText('9 unsorted images elsewhere in the project.');
  await browser(page).getByRole('button', { name: 'Show this stash’s images', exact: true }).click();
  await expect(browser(page).getByRole('button', { name: 'All 12', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(browser(page).locator('.image-browser__header>span')).toHaveText('2 / 12');
  await expect(browser(page).getByRole('button', { name: 'Clear current folder filter', exact: true })).toBeVisible();
  await expect(browser(page).getByRole('button', { name: /^Clear search:/ })).toHaveCount(0);
  await browser(page).getByRole('button', { name: 'Unsorted 9', exact: true }).click();
  await browser(page).getByRole('button', { name: 'Continue with unsorted', exact: true }).click();
  await expect(browser(page).locator('.image-browser__header>span')).toHaveText('9 / 12');
  await expect(browser(page).getByRole('button', { name: 'Unsorted 9', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(browser(page).getByRole('button', { name: 'Clear current folder filter', exact: true })).toHaveCount(0);
  expect(await records(page)).toEqual(before);
  await expect(page.locator('[data-current-location]')).toHaveText('Parent');
});
