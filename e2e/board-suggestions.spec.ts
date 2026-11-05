import { acceptRandomPreview } from './menuBar';
import { test, expect } from './persistentFixtures';
import type { Page } from '@playwright/test';
import { createBoardStash, addAllUnsortedToBoard } from './menuBar';
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
async function seed(page: Page, delay = 80, total = 12) {
  await mockClipInference(page, false, delay); await page.goto('/');
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
  return previews(page).evaluateAll(elements => elements.map(element => {
    const el = element as HTMLElement, rect = el.getBoundingClientRect(), img = el.querySelector('img')!.getBoundingClientRect();
    return { id: el.dataset.suggestionPreview!, x: parseInt(el.style.left), y: parseInt(el.style.top), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, image: { x: img.x, y: img.y, width: img.width, height: img.height } };
  }));
}
async function expectCommittedInPlace(page: Page, planned: Awaited<ReturnType<typeof draft>>, folder: string | null) {
  await idle(page); await expect(previews(page)).toHaveCount(0);
  await expect(board(page).locator('.card[data-arriving]')).toHaveCount(0);
  const saved = await records(page);
  for (const item of planned) {
    expect(saved.find(row => row.id === item.id)).toMatchObject({ categoryId: folder, boardX: item.x, boardY: item.y });
    const card = page.getByTestId('card-' + item.id), rect = (await card.boundingBox())!, image = (await card.locator('.cardPreview__img').boundingBox())!;
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
  await controls(page).getByRole('button', { name: 'Add these 2', exact: true }).click();
  await expectCommittedInPlace(page, planned, null); await expect(board(page).locator('.card')).toHaveCount(3);
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
  await openColor(page); await expect(controls(page).getByRole('checkbox', { name: 'Include other folders' })).not.toBeChecked();
  const planned = await draft(page); expect(await records(page)).toEqual(before);
  await controls(page).getByRole('button', { name: 'Move these 3', exact: true }).click();
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


test('a large suggestion group fits a narrow board and accepts twelve images without moving them', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page, 80, 18);
  const before = await records(page); await openColor(page);
  await controls(page).getByRole('combobox', { name: 'Number of suggestions' }).selectOption('12');
  await expect(previews(page)).toHaveCount(12); await expect(controls(page)).toHaveAttribute('aria-busy', 'false');
  await expect(controls(page)).toBeInViewport({ ratio: 1 });
  for (const image of await previews(page).all()) await expect(image).toBeInViewport({ ratio: .99 });
  const planned = await draft(page); expect(await records(page)).toEqual(before);
  await controls(page).getByRole('button', { name: 'Add these 12', exact: true }).click();
  await expectCommittedInPlace(page, planned, null); await expect(board(page).locator('.card')).toHaveCount(13);
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
