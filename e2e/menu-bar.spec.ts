import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openBoardActions, createBoardStash, backToProject, openBrowserFilters } from './menuBar';
import { addBrowserImages, choosePileOrder } from './pileDock';

async function fixture(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').evaluate((input: HTMLInputElement) => {
    const transfer = new DataTransfer();
    for (let i = 0; i < 9; i++) {
      const canvas = document.createElement('canvas'); canvas.width = i % 2 ? 240 : 320; canvas.height = i % 2 ? 320 : 200;
      const context = canvas.getContext('2d')!; context.fillStyle = ['#c18a71', '#759dbc', '#c2c876'][i % 3]; context.fillRect(0, 0, canvas.width, canvas.height);
      const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), c => c.charCodeAt(0));
      transfer.items.add(new File([bytes], `photo-${i}.png`, { type: 'image/png' }));
    }
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await choosePileOrder(page, 'name'); await addBrowserImages(page, 3);
  await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
    const read = (name: string) => new Promise<any[]>(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const [images, stashes] = await Promise.all([read('images'), read('categories')]); db.close(); return { images, stashes };
  });
}
const card = (page: Page, index: number) => page.locator('.sorting-workspace__board').getByRole('group', { name: `Card: photo-${index}.png`, exact: true });

for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`fixed actions leave images clear at ${viewport.width}×${viewport.height}; compact Undo remains available`, async ({ page }) => {
    await page.setViewportSize(viewport); await fixture(page);
    const header = page.getByRole('toolbar', { name: 'Board menu bar' });
    const originalBounds = await header.boundingBox();
    await card(page, 0).click(); await card(page, 1).click({ modifiers: ['Shift'] });
    expect(await header.boundingBox()).toEqual(originalBounds);
    await expect(page.getByRole('toolbar', { name: 'Board controls' }).getByRole('button', { name: 'Move to stash…', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('toolbar', { name: 'Board controls' }).getByRole('button', { name: 'Create stash', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    expect(await page.locator('.stash-selection, .undo-notice, .sorting-workspace__utilities, .stash-board-hint').count()).toBe(0);
    const boardBounds = (await page.locator('.sorting-workspace__board').boundingBox())!;
    const controls = (await page.getByRole('toolbar', { name: 'Board controls' }).boundingBox())!;
    expect(controls.y).toBe(originalBounds!.y + originalBounds!.height);
    expect(boardBounds.y).toBe(controls.y + controls.height);
    await openBoardActions(page); const returnAction = page.getByRole('button', { name: 'Remove selected images from board' });
    await expect(returnAction.locator('svg')).toHaveAttribute('data-icon', 'return-to-pile');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    const before = (await records(page)).images;
    await openBoardActions(page); await page.getByRole('button', { name: 'Clear board', exact: true }).click();
    const undo = page.getByRole('button', { name: 'Undo clear' });
    await expect(undo).toBeInViewport({ ratio: 1 }); await expect(undo.locator('..')).toHaveClass(/is-fresh/);
    await page.clock.install(); await page.clock.fastForward(6_000); await expect(undo).toBeEnabled(); await expect(undo.locator('..')).not.toHaveClass(/is-fresh/);
    await undo.click(); expect((await records(page)).images).toEqual(before);
    await page.getByRole('button', { name: 'Collapse image browser' }).click();
    await expect(page.getByRole('button', { name: 'Show image browser' }).first()).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `/tmp/foldersort-menu-bar-${viewport.width}.png` });
  });
}

test('review stays within the opened board and creates undoable sub-stashes; project Explore uses the same collection browser', async ({ page }) => {
  await fixture(page); await card(page, 0).click(); await card(page, 1).click({ modifiers: ['Shift'] }); await createBoardStash(page);
  const name = page.getByRole('textbox', { name: 'Stash name', exact: true }); await name.fill('Parent'); await name.press('Enter');
  await page.getByRole('button', { name: 'Open stash Parent', exact: true }).click();
  await expect(page.locator('.sorting-workspace__board .card__categoryLabel')).toHaveCount(0);
  await card(page, 0).dblclick(); const review = page.getByRole('dialog', { name: 'photo-0.png', exact: true });
  await expect(review.locator('.image-preview__nav')).toContainText('1 / 2');
  await page.getByRole('button', { name: 'Next image' }).click(); await expect(page.getByRole('dialog', { name: 'photo-1.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Move image to stash' }).click();
  const chooser = page.getByRole('dialog', { name: 'Move to stash', exact: true });
  await chooser.getByRole('textbox', { name: 'New stash name' }).fill('Child'); await chooser.getByRole('textbox', { name: 'New stash name' }).press('Enter');
  await expect(chooser).toHaveCount(0); expect((await records(page)).stashes.map(stash => stash.name)).toContain('Parent/Child');
  await expect(page.locator('.image-review__title small')).toHaveText('Parent/Child');
  await page.getByRole('button', { name: 'Undo create stash' }).click(); await expect(page.locator('.image-review__title small')).toHaveText('Parent');
  expect((await records(page)).stashes.map(stash => stash.name)).toEqual(['Parent']);
  await page.getByRole('button', { name: 'Close image' }).click(); await backToProject(page);
  await page.getByRole('button', { name: 'Explore project images' }).click();
  const browser = page.getByRole('region', { name: 'Image browser', exact: true }); await expect(browser.locator('.card')).toHaveCount(9);
  await openBrowserFilters(page); await browser.getByRole('searchbox', { name: 'Find images' }).fill('photo-0');
  await browser.locator('.card').first().dblclick();
  await expect(page.locator('.image-preview__nav')).toContainText('1 / 1');
  await page.getByRole('button', { name: 'Move image to stash' }).click(); await chooser.getByRole('button', { name: /Unsorted/ }).click();
  await expect(page.getByRole('dialog', { name: 'photo-0.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close image' }).click(); await page.reload();
  expect((await records(page)).images.find(image => image.path === 'photo-0.png').categoryId).toBeNull();
});

test('renaming from the current stash menu keeps its parent and descendants', async ({ page }) => {
  await fixture(page); await card(page, 0).click(); await card(page, 1).click({ modifiers: ['Shift'] }); await createBoardStash(page);
  let name = page.getByRole('textbox', { name: 'Stash name', exact: true }); await name.fill('Parent'); await name.press('Enter');
  await page.getByRole('button', { name: 'Open stash Parent', exact: true }).click(); await card(page, 0).click(); await createBoardStash(page);
  name = page.getByRole('textbox', { name: 'Stash name', exact: true }); await name.fill('Child'); await name.press('Enter');
  await page.getByRole('button', { name: 'Open stash Parent/Child', exact: true }).click();
  await openBoardActions(page); await page.getByRole('button', { name: 'Rename stash', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename stash', exact: true }); await rename.getByRole('textbox', { name: 'Stash name' }).fill('Renamed'); await rename.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rename).toHaveCount(0); expect((await records(page)).stashes.map(stash => stash.name).sort()).toEqual(['Parent', 'Parent/Renamed']);
  await page.getByRole('button', { name: 'Back to Parent', exact: true }).click(); await expect(page.getByRole('button', { name: 'Open stash Parent/Renamed', exact: true })).toBeVisible();
});
