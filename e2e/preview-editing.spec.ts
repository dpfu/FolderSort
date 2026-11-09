import { test, expect } from './persistentFixtures';
import type { Page } from '@playwright/test';
import { mockClipInference } from './clipFixtures';
import { backToProject, createBoardStash } from './menuBar';

const pane = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const cells = (page: Page) => page.locator('[data-suggestion-preview]');
const controls = (page: Page, random = false) => page.getByRole('region', { name: random ? 'Random image previews' : 'Similar image suggestions', exact: true });
const idle = (page: Page) => expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<any[]>(resolve => { const r = db.transaction('images').objectStore('images').getAll(); r.onsuccess = () => resolve(r.result); }); db.close();
    return rows.map(({ id, path, categoryId, boardScope, rootOnBoard, boardX, boardY, stashOrder, placement }) => ({ id, path, categoryId, boardScope, rootOnBoard, boardX, boardY, stashOrder, placement }));
  });
}
async function seed(page: Page, total = 30) {
  await mockClipInference(page); await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: total }, (_, i) => ({
    name: `image-${i}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${i % 2 ? 180 : 300}" height="220"><rect width="100%" height="100%" fill="${i % 2 ? '#93b5a4' : '#bbaa89'}"/></svg>`),
  })));
  const starter = page.getByRole('region', { name: 'Start with random images', exact: true });
  await starter.getByRole('spinbutton').fill('1'); await starter.getByRole('button', { name: 'Add 1 image', exact: true }).click();
  await idle(page); await expect(pane(page).locator('.card[data-arriving]')).toHaveCount(0);
}
async function open(page: Page, method: string) {
  if (method === 'random') { await page.getByRole('button', { name: 'Preview 1 random image', exact: true }).click(); await controls(page, true).getByRole('combobox').selectOption('3'); }
  else {
    await pane(page).locator('.card').first().click();
    await page.getByRole('button', { name: 'Show related image suggestions', exact: true }).click();
    await controls(page).getByRole('combobox', { name: 'Suggestion method' }).selectOption(method);
    if (method === 'text') { await controls(page).getByRole('searchbox').fill('images'); await controls(page).getByRole('searchbox').press('Enter'); }
    await expect(controls(page)).toHaveAttribute('aria-busy', 'false');
  }
  await expect(cells(page)).toHaveCount(3);
}
async function slots(page: Page) {
  return cells(page).evaluateAll(elements => elements.map(element => {
    const node = element as HTMLElement;
    return { id: node.dataset.suggestionPreview!, x: parseInt(node.style.left), y: parseInt(node.style.top), included: node.querySelector('input')!.checked };
  }));
}
async function drag(page: Page, id: string, to: { x: number; y: number }, cancel = false) {
  const cell = page.getByTestId('suggestion-' + id); await expect(cell).toBeVisible();
  await expect.poll(() => cell.locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const box = (await cell.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 8);
  await expect(page.locator('[data-preview-drag-ghost]')).toBeVisible();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up(); await expect(page.locator('[data-preview-drag-ghost]')).toHaveCount(0);
}
async function blankPoint(page: Page) {
  return pane(page).evaluate(element => {
    const box = element.getBoundingClientRect();
    const canvas = element.querySelector<HTMLElement>('[data-testid="board-canvas"]')!;
    const bounds = canvas.getBoundingClientRect(), scale = bounds.width / canvas.offsetWidth;
    for (const x of [.1, .3, .6, .8, .9]) for (const y of [.12, .35, .6, .8]) {
      const point = { x: box.left + box.width * x, y: box.top + box.height * y };
      if ((point.x - bounds.left) / scale < 86 || (point.y - bounds.top) / scale < 86) continue;
      if (!document.elementsFromPoint(point.x, point.y).some(node => node.closest('[data-stash-drop-id], [data-preview-slot], button, .board-suggestions, .staging-intake'))) return point;
    }
    throw new Error('No visible board drop point');
  });
}

for (const method of ['random', 'color', 'clip', 'text']) test(`${method} previews toggle inclusion, keep slots and add only retained images`, async ({ page }, testInfo) => {
  if (method === 'color') await page.setViewportSize({ width: 1920, height: 1080 });
  await seed(page); await open(page, method); const original = await slots(page), before = await records(page);
  await page.getByTestId('suggestion-' + original[1].id).click();
  await expect(page.getByTestId('suggestion-' + original[1].id).getByRole('checkbox')).not.toBeChecked();
  await expect(controls(page, method === 'random').getByRole('button', { name: 'Add 2', exact: true })).toBeEnabled();
  if (method === 'color') {
    const excluded = page.getByTestId('suggestion-' + original[1].id);
    await expect(excluded.locator('img')).toHaveCSS('opacity', '0.22');
    await expect(excluded.getByRole('checkbox')).toHaveCSS('border-radius', '50%');
    await page.screenshot({ path: testInfo.outputPath('preview-deselection.png') });
  }
  expect((await slots(page)).map(({ included, ...slot }) => slot)).toEqual(original.map(({ included, ...slot }) => slot));
  for (const id of [original[0].id, original[2].id]) await page.getByTestId('suggestion-' + id).getByRole('checkbox').uncheck();
  await expect(controls(page, method === 'random').getByRole('button', { name: 'Add 0', exact: true })).toBeDisabled();
  const first = page.getByTestId('suggestion-' + original[0].id).getByRole('checkbox'); await first.focus(); await first.press('Space');
  await page.getByTestId('suggestion-' + original[2].id).getByRole('checkbox').check();
  expect(await records(page)).toEqual(before);
  await controls(page, method === 'random').getByRole('button', { name: 'Add 2', exact: true }).click(); await idle(page);
  const after = await records(page);
  for (const index of [0, 2]) expect(after.find(image => image.id === original[index].id)).toMatchObject({ rootOnBoard: true, boardX: original[index].x, boardY: original[index].y });
  expect(after.find(image => image.id === original[1].id).rootOnBoard).toBe(false);
});

for (const method of ['random', 'color']) test(`${method} individual board drops refill one fixed slot; cancellation and Undo preserve the draft`, async ({ page }) => {
  await seed(page); await open(page, method); const original = await slots(page), before = await records(page);
  await page.getByTestId('suggestion-' + original[1].id).getByRole('checkbox').uncheck();
  const unchanged = await slots(page), point = await blankPoint(page);
  await drag(page, original[0].id, point, true);
  expect(await slots(page)).toEqual(unchanged); expect(await records(page)).toEqual(before);
  await drag(page, original[0].id, { x: 20, y: 20 });
  expect(await slots(page)).toEqual(unchanged);
  const box = (await page.getByTestId('suggestion-' + original[0].id).boundingBox())!;
  await drag(page, original[0].id, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(await slots(page)).toEqual(unchanged);
  await drag(page, original[0].id, point);
  await expect.poll(async () => (await slots(page))[0]?.id).not.toBe(original[0].id);
  await expect(cells(page)).toHaveCount(3); await idle(page);
  const refilled = await slots(page);
  expect(refilled[1]).toEqual(unchanged[1]); expect(refilled[2]).toEqual(unchanged[2]);
  expect(refilled[0].x).toBe(original[0].x); expect(refilled[0].y).toBe(original[0].y);
  expect((await records(page)).find(image => image.id === original[0].id).rootOnBoard).toBe(true);
  for (const image of before.filter(image => image.id !== original[0].id)) expect((await records(page)).find(row => row.id === image.id)).toEqual(image);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click();
  await expect.poll(() => slots(page)).toEqual(unchanged);
  expect(await records(page)).toEqual(before);
});

test('an excluded suggestion can be sorted into a folder, refilled and restored with Undo', async ({ page }) => {
  await seed(page); await backToProject(page);
  await page.locator('summary').filter({ hasText: /^Folders/ }).click();
  await page.getByRole('textbox', { name: 'New folder name', exact: true }).fill('Destination');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await open(page, 'color'); const original = await slots(page), before = await records(page);
  const id = original[1].id;
  await page.getByTestId('suggestion-' + id).getByRole('checkbox').uncheck(); const unchanged = await slots(page);
  const target = (await page.getByRole('region', { name: 'Folder Destination', exact: true }).boundingBox())!;
  await drag(page, id, { x: target.x + target.width / 2, y: target.y + 30 });
  await expect.poll(async () => (await slots(page))[1]?.id).not.toBe(id);
  await idle(page); await expect(controls(page).getByRole('button', { name: 'Add 3', exact: true })).toBeEnabled();
  expect((await records(page)).find(image => image.id === id).categoryId).toBeTruthy();
  expect((await slots(page))[0]).toEqual(unchanged[0]); expect((await slots(page))[2]).toEqual(unchanged[2]);
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click();
  await expect.poll(() => slots(page)).toEqual(unchanged); expect(await records(page)).toEqual(before);
});

test('a direct preview drop uses the open folder and exact pointer coordinates', async ({ page }) => {
  await seed(page); await pane(page).locator('.card').click(); await createBoardStash(page);
  const name = page.getByRole('textbox', { name: 'Folder name', exact: true }); await name.fill('Working'); await name.press('Enter');
  await page.getByRole('button', { name: 'Open folder Working', exact: true }).click();
  await expect(pane(page)).not.toHaveAttribute('data-stash-navigation');
  await open(page, 'color'); const before = await records(page), original = await slots(page), point = await blankPoint(page);
  const expected = await page.getByTestId('board-canvas').evaluate((canvas, point) => {
    const box = canvas.getBoundingClientRect(), scale = box.width / (canvas as HTMLElement).offsetWidth;
    return { boardX: Math.round((point.x - box.left) / scale - 86), boardY: Math.round((point.y - box.top) / scale - 86) };
  }, point);
  const folder = before.find(image => image.categoryId)?.categoryId;
  await drag(page, original[0].id, point);
  await expect.poll(async () => (await slots(page))[0]?.id).not.toBe(original[0].id);
  await idle(page);
  expect((await records(page)).find(image => image.id === original[0].id)).toMatchObject({ categoryId: folder, ...expected });
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click();
  await expect.poll(() => slots(page)).toEqual(original); expect(await records(page)).toEqual(before);
});

test('quantity changes preserve choices; changing search cancels a live thumbnail drag and resets inclusion', async ({ page }) => {
  await seed(page); await open(page, 'color'); const original = await slots(page), before = await records(page);
  await page.getByTestId('suggestion-' + original[1].id).getByRole('checkbox').uncheck();
  const chosen = await slots(page), quantity = controls(page).getByRole('combobox', { name: 'Number of suggestions' });
  await quantity.selectOption('5'); await expect(cells(page)).toHaveCount(5);
  expect((await slots(page)).slice(0, 3)).toEqual(chosen);
  await quantity.selectOption('3'); await expect(cells(page)).toHaveCount(3);
  const box = (await page.getByTestId('suggestion-' + original[0].id).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 8);
  await expect(page.locator('[data-preview-drag-ghost]')).toBeVisible();
  await controls(page).getByRole('combobox', { name: 'Suggestion method' }).selectOption('text');
  await expect(page.locator('[data-preview-drag-ghost]')).toHaveCount(0); await page.mouse.up();
  const search = controls(page).getByRole('searchbox'); await search.fill('slow first'); await search.press('Enter');
  await search.fill('other'); await search.press('Enter');
  await expect(controls(page)).toHaveAttribute('aria-busy', 'false'); await expect(cells(page)).toHaveCount(3);
  expect((await slots(page)).every(slot => slot.included)).toBe(true); expect(await records(page)).toEqual(before);
});

test('an exhausted pool leaves a vacant slot without duplicating or moving other previews; Undo fills it again', async ({ page }) => {
  await seed(page, 4); await open(page, 'random'); const original = await slots(page);
  await drag(page, original[0].id, await blankPoint(page)); await idle(page);
  await expect(cells(page)).toHaveCount(2);
  expect(await slots(page)).toEqual(original.slice(1));
  await expect(controls(page, true).getByRole('button', { name: 'Add 2', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click();
  await expect.poll(() => slots(page)).toEqual(original);
});

test('native touch can drag a preview onto the board and refill its slot', async ({ browser, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'CDP supplies native touch events.');
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, route => route.abort());
  try {
    const page = await context.newPage(); await seed(page); await open(page, 'random'); const original = await slots(page);
    await expect.poll(() => page.getByTestId('suggestion-' + original[0].id).locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    const box = (await page.getByTestId('suggestion-' + original[0].id).boundingBox())!, point = await blankPoint(page), session = await context.newCDPSession(page);
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, x: start.x + 12, y: start.y + 8 }] });
    await expect(page.locator('[data-preview-drag-ghost]')).toBeVisible();
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await slots(page))[0]?.id).not.toBe(original[0].id);
    expect((await slots(page)).slice(1)).toEqual(original.slice(1));
    expect((await records(page)).find(image => image.id === original[0].id).rootOnBoard).toBe(true);
  } finally { await context.close(); }
});
