import { acceptRandomPreview } from './menuBar';
import { test, expect } from './persistentFixtures';
import type { Page } from '@playwright/test';
import { createBoardStash, addAllUnsortedToBoard, zoomBoard } from './menuBar';
import { mockClipInference } from './clipFixtures';

const board = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const controls = (page: Page) => page.getByRole('region', { name: 'Similar image suggestions', exact: true });
const previews = (page: Page) => board(page).locator('[data-suggestion-preview]');
const trigger = (page: Page) => page.getByRole('button', { name: 'Show related image suggestions', exact: true });
const idle = async (page: Page) => { await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved'); await expect(board(page)).not.toHaveAttribute('data-stash-navigation'); };
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('sortboard-image-library-minimal', 2); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<any[]>(resolve => { const r = db.transaction('images').objectStore('images').getAll(); r.onsuccess = () => resolve(r.result); }); db.close();
    return rows.map(({ id, categoryId, boardScope, rootOnBoard, boardX, boardY, stashOrder }) => ({ id, categoryId, boardScope, rootOnBoard, boardX, boardY, stashOrder }));
  });
}
async function seed(page: Page, delay = 80, total = 12, failClip = false) {
  await mockClipInference(page, failClip, delay); await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: total }, (_, index) => ({
    name: 'photo-' + index + '.svg', mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + (index % 2 ? 240 : 360) + '" height="' + (index % 2 ? 360 : 240) + '"><rect width="100%" height="100%" fill="' + ['#b79578', '#9db7bf', '#b2bd88'][index % 3] + '"/><circle cx="120" cy="120" r="64" fill="#456557"/></svg>'),
  })));
  const starter = page.getByRole('region', { name: 'Start with random images', exact: true });
  await starter.getByRole('spinbutton').fill('1'); await starter.getByRole('button', { name: 'Add 1 image', exact: true }).click();
  await idle(page); await expect(board(page).locator('.card[data-arriving]')).toHaveCount(0);
  await board(page).locator('.card').click();
}
async function openColor(page: Page) {
  await trigger(page).click(); await controls(page).getByRole('combobox', { name: 'Suggestion method', exact: true }).selectOption('color');
  await expect(previews(page)).toHaveCount(3); await expect(controls(page)).toHaveAttribute('aria-busy', 'false');
}
async function draft(page: Page) {
  await expect.poll(() => previews(page).evaluateAll(elements => elements.every(el => {
    const image = el.querySelector('img'); return !!image?.complete && image.naturalWidth > 0;
  }))).toBe(true);
  await expect(board(page).locator('.board-preview-frame')).toHaveCount(1);
  return previews(page).evaluateAll(elements => elements.map(element => {
    const el = element as HTMLElement, rect = el.getBoundingClientRect(), img = el.querySelector('img')!.getBoundingClientRect();
    return { id: el.dataset.suggestionPreview!, x: parseInt(el.style.left), y: parseInt(el.style.top), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, image: { x: img.x, y: img.y, width: img.width, height: img.height } };
  }));
}
async function expectCommittedInPlace(page: Page, planned: Awaited<ReturnType<typeof draft>>, folder: string | null) {
  await idle(page); await expect(previews(page)).toHaveCount(0);
  await expect(board(page).locator('.card[data-arriving]')).toHaveCount(0);
  await expect(board(page).locator('.board-preview-frame')).toHaveCount(0);
  const saved = await records(page);
  for (const item of planned) {
    expect(saved.find(row => row.id === item.id)).toMatchObject({ categoryId: folder, boardX: item.x, boardY: item.y });
    const card = page.getByTestId('card-' + item.id);
    // Fixed grids can extend beyond the virtualized viewport. All records still save exact coordinates.
    if (!await card.count()) continue;
    const rect = (await card.boundingBox())!, image = (await card.locator('.cardPreview__img').boundingBox())!;
    for (const key of ['x', 'y', 'width', 'height'] as const) { expect(Math.abs(rect[key] - item.rect[key])).toBeLessThan(.8); expect(Math.abs(image[key] - item.image[key])).toBeLessThan(.8); }
  }
  await expect(board(page).locator('.card[data-arriving]')).toHaveCount(0);
}

for (const width of [1440, 390]) test('suggestions commit at their previewed coordinates and pixels on Staging at ' + width + 'px', async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await seed(page);
  const before = await records(page); await openColor(page);
  expect(await records(page)).toEqual(before); await expect(board(page).locator('.card')).toHaveCount(1);
  await controls(page).getByRole('combobox', { name: 'Number of suggestions', exact: true }).selectOption('2');
  await expect(previews(page)).toHaveCount(2); await expect(controls(page)).toHaveAttribute('aria-busy', 'false');
  await expect(controls(page)).toBeInViewport({ ratio: 1 });
  await expect.poll(() => previews(page).evaluateAll(elements => elements.every(el => (el.querySelector('img') as HTMLImageElement)?.complete))).toBe(true);
  const planned = await draft(page);
  await board(page).evaluate(root => {
    (window as any).relatedFrameFaded = false;
    new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node instanceof HTMLElement && node.matches('.board-preview-frame--placed'))))
        (window as any).relatedFrameFaded = true;
    }).observe(root, { childList: true, subtree: true });
  });
  await controls(page).getByRole('button', { name: 'Add 2', exact: true }).click();
  await expectCommittedInPlace(page, planned, null); expect((await records(page)).filter(image => image.rootOnBoard !== false)).toHaveLength(3);
  expect(await page.evaluate(() => (window as any).relatedFrameFaded)).toBe(true);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(before);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(previews(page)).toHaveCount(0); await expect(board(page).locator('.card')).toHaveCount(1);
});

test('folder suggestions move into the folder in place and one Undo restores their previous locations', async ({ page }) => {
  await seed(page); await createBoardStash(page);
  const name = page.getByRole('textbox', { name: 'Folder name', exact: true }); await name.fill('Reference'); await name.press('Enter'); await idle(page);
  await page.getByRole('button', { name: 'Open folder Reference', exact: true }).click(); await idle(page);
  const reference = board(page).locator('.card'); await expect(reference).toHaveCount(1); await reference.click();
  const before = await records(page), folder = before.find(image => image.categoryId)!.categoryId;
  await openColor(page); await expect(controls(page).getByRole('checkbox', { name: 'Include other folders' })).toHaveCount(0);
  const planned = await draft(page); expect(await records(page)).toEqual(before);
  await controls(page).getByRole('button', { name: 'Add 3', exact: true }).click();
  await expectCommittedInPlace(page, planned, folder);
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(before);
});

test('color can replace a pending subject search; dismissal and late results never change the project', async ({ page }) => {
  await seed(page, 2500); const before = await records(page);
  await trigger(page).click(); await expect(controls(page)).toHaveAttribute('aria-busy', 'true');
  await controls(page).getByRole('combobox', { name: 'Suggestion method' }).selectOption('color');
  await expect(previews(page)).toHaveCount(3); await expect(controls(page)).toHaveAttribute('aria-busy', 'false');
  await page.keyboard.press('Escape'); await expect(controls(page)).toHaveCount(0); await expect(previews(page)).toHaveCount(0); await expect(trigger(page)).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as any).clipCounts.embeds)).toBeGreaterThan(0);
  await expect(previews(page)).toHaveCount(0); expect(await records(page)).toEqual(before);
  await trigger(page).click(); await expect(previews(page)).toHaveCount(3);
  await controls(page).getByRole('combobox', { name: 'Number of suggestions' }).selectOption('1');
  await controls(page).getByRole('combobox', { name: 'Number of suggestions' }).selectOption('4');
  await expect(previews(page)).toHaveCount(4); await expect(controls(page)).toHaveAttribute('aria-busy', 'false');
  expect(new Set((await draft(page)).map(item => item.id)).size).toBe(4); expect(await records(page)).toEqual(before);
  await controls(page).getByRole('button', { name: 'Close similar image suggestions' }).click(); await expect(previews(page)).toHaveCount(0);
});

test('a failed method switch cannot accept the previous method’s suggestions under a new label', async ({ page }) => {
  await seed(page, 80, 12, true); await openColor(page); const before = await records(page);
  await controls(page).getByRole('combobox', { name: 'Suggestion method' }).selectOption('clip');
  await expect(controls(page)).toHaveAttribute('aria-busy', 'false');
  await expect(previews(page)).toHaveCount(0);
  await expect(controls(page).getByRole('button', { name: 'No suggestions', exact: true })).toBeDisabled();
  expect(await records(page)).toEqual(before);
});


test('completed background embeddings never reshuffle a visible subject preview', async ({ page }) => {
  await seed(page, 80, 32); const before = await records(page); await trigger(page).click();
  await expect(previews(page)).toHaveCount(3); await expect(controls(page)).toHaveAttribute('aria-busy', 'false');
  const planned = (await draft(page)).map(({ id, x, y }) => ({ id, x, y }));
  expect(await page.evaluate(() => (window as any).clipCounts.embeds)).toBeLessThan(32);
  await expect.poll(() => page.evaluate(() => (window as any).clipCounts.embeds)).toBe(32);
  expect((await draft(page)).map(({ id, x, y }) => ({ id, x, y }))).toEqual(planned);
  expect(await records(page)).toEqual(before);
});

test('a full Staging board never previews duplicates of images already on it', async ({ page }) => {
  await seed(page); await addAllUnsortedToBoard(page); await idle(page); await expect(board(page).locator('.card[data-arriving]')).toHaveCount(0);
  await board(page).locator('.card').first().press('s'); const before = await records(page); await trigger(page).click();
  await controls(page).getByRole('combobox', { name: 'Suggestion method' }).selectOption('color');
  await expect(controls(page)).toHaveAttribute('aria-busy', 'false'); await expect(previews(page)).toHaveCount(0);
  await expect(controls(page).getByRole('button', { name: 'No suggestions', exact: true })).toBeDisabled();
  await expect(controls(page).getByRole('status')).toContainText('No images available'); expect(await records(page)).toEqual(before);
});


test('a large suggestion group keeps fixed slots on a narrow board and saves all twelve positions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page, 80, 18);
  const before = await records(page); await openColor(page);
  await controls(page).getByRole('combobox', { name: 'Number of suggestions' }).selectOption('12');
  await expect(previews(page)).toHaveCount(12); await expect(controls(page)).toHaveAttribute('aria-busy', 'false');
  await expect(controls(page)).toBeInViewport({ ratio: 1 });
  const planned = await draft(page); expect(await records(page)).toEqual(before);
  expect(planned[3].x).toBe(planned[0].x); expect(planned[3].y).toBe(planned[0].y + 184);
  expect(planned[2].x).toBe(planned[0].x + 368);
  await controls(page).getByRole('button', { name: 'Add 12', exact: true }).click();
  await expectCommittedInPlace(page, planned, null); expect((await records(page)).filter(image => image.rootOnBoard !== false)).toHaveLength(13);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(before);
});

test('moving the reference or adding a random batch discards the suggestion draft without committing it', async ({ page }) => {
  await seed(page, 80, 18);
  const intake = page.getByRole('group', { name: 'Add images to staging', exact: true });
  await intake.getByRole('button', { name: 'Random image batch size', exact: true }).click();
  await intake.getByRole('spinbutton', { name: 'Number of random images', exact: true }).fill('3'); await page.keyboard.press('Escape');
  const before = await records(page);
  const reference = board(page).locator('.card').first(); await openColor(page);
  await reference.press('ArrowRight'); await idle(page);
  await expect(previews(page)).toHaveCount(0); await expect(controls(page)).toHaveCount(0);
  await expect(board(page).locator('.card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(before);
  await reference.click(); await openColor(page);
  await page.getByRole('button', { name: 'Preview 3 random images', exact: true }).click(); await acceptRandomPreview(page); await idle(page);
  await expect(previews(page)).toHaveCount(0); await expect(controls(page)).toHaveCount(0); await expect(board(page).locator('.card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(before);
});

test('quantity, batch dragging, cancellation and consecutive additions keep a predictable anchor', async ({ page }) => {
  await seed(page, 80, 32); const before = await records(page); await openColor(page);
  const camera = await page.getByTestId('board-canvas').boundingBox();
  const first = await draft(page);
  await controls(page).getByRole('combobox', { name: 'Number of suggestions' }).selectOption('1');
  await expect(previews(page)).toHaveCount(1); expect((await draft(page))[0]).toEqual(first[0]);
  await controls(page).getByRole('combobox', { name: 'Number of suggestions' }).selectOption('5');
  await expect(previews(page)).toHaveCount(5);
  expect((await draft(page)).slice(0, 3)).toEqual(first);
  await controls(page).getByRole('combobox', { name: 'Number of suggestions' }).selectOption('3'); await expect(previews(page)).toHaveCount(3); await draft(page);
  const handle = controls(page).getByRole('button', { name: 'Move suggestions', exact: true }), box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 54, box.y + box.height / 2 - 30, { steps: 8 }); await page.mouse.up();
  const moved = await draft(page);
  for (let i = 0; i < moved.length; i++) { expect(moved[i].x).toBe(first[i].x + 54); expect(moved[i].y).toBe(first[i].y - 30); }
  expect(await records(page)).toEqual(before);
  await controls(page).getByRole('button', { name: 'Add 3', exact: true }).click(); await expectCommittedInPlace(page, moved, null);
  const afterFirst = await records(page); expect(afterFirst.filter(image => before.some(old => old.id === image.id && old.rootOnBoard !== false))).toEqual(before.filter(image => image.rootOnBoard !== false));
  await trigger(page).click(); await expect(previews(page)).toHaveCount(3);
  const second = await draft(page);
  expect(second[0].x).toBe(moved[0].x); expect(second[0].y).toBe(moved[0].y + 196);
  await page.keyboard.press('Escape'); await trigger(page).click(); await expect(previews(page)).toHaveCount(3);
  expect(await draft(page)).toEqual(second);
  await controls(page).getByRole('button', { name: 'Add 3', exact: true }).click(); await expectCommittedInPlace(page, second, null);
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await idle(page);
  expect(await records(page)).toEqual(afterFirst);
  await board(page).locator('.card.isSelected').click(); await trigger(page).click(); await expect(previews(page)).toHaveCount(3);
  expect((await draft(page)).map(({ x, y }) => ({ x, y }))).toEqual(second.map(({ x, y }) => ({ x, y })));
  const afterCamera = (await page.getByTestId('board-canvas').boundingBox())!;
  expect(afterCamera.x).toBeCloseTo(camera!.x, 1); expect(afterCamera.y).toBeCloseTo(camera!.y, 1);
});

test('the preview drag handle respects zoom, supports keyboard movement and can cancel without edits', async ({ page }) => {
  await seed(page, 80, 18); await zoomBoard(page, 'in'); await openColor(page);
  const before = await records(page), first = await draft(page);
  const handle = controls(page).getByRole('button', { name: 'Move suggestions', exact: true }), box = (await handle.boundingBox())!;
  const scale = await page.getByTestId('board-canvas').evaluate(el => el.getBoundingClientRect().width / (el as HTMLElement).offsetWidth);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 33, { steps: 6 }); await page.mouse.up();
  const moved = await draft(page);
  expect(moved[0].x).toBe(first[0].x + Math.round(55 / scale)); expect(moved[0].y).toBe(first[0].y + Math.round(33 / scale));
  await handle.press('Shift+ArrowDown');
  expect((await draft(page))[0].y).toBe(moved[0].y + 30);
  await page.keyboard.press('Escape'); await expect(previews(page)).toHaveCount(0); expect(await records(page)).toEqual(before);
  await trigger(page).click(); await expect(previews(page)).toHaveCount(3);
  expect((await draft(page)).map(({ x, y }) => ({ x, y }))).toEqual(first.map(({ x, y }) => ({ x, y })));
});

test('an edge-clamped toolbar stays under the pointer while its batch is dragged inward', async ({ page }) => {
  await seed(page, 80, 18);
  const reference = board(page).locator('.card').first();
  for (let i = 0; i < 12; i++) await reference.press('ArrowRight');
  await idle(page); await openColor(page); await draft(page);
  const handle = controls(page).getByRole('button', { name: 'Move suggestions', exact: true }), before = (await handle.boundingBox())!;
  const bounds = (await board(page).boundingBox())!;
  // The random reference can clamp the toolbar at either vertical edge.
  // Move inward on both axes, rather than testing against the bottom clamp.
  const dy = before.y > bounds.y + bounds.height / 2 ? -10 : 10;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 74, before.y + before.height / 2 + dy, { steps: 8 }); await page.mouse.up();
  const after = (await handle.boundingBox())!;
  expect(after.x).toBeCloseTo(before.x - 74, 0); expect(after.y).toBeCloseTo(before.y + dy, 0);
});
