import { openBoardActions, zoomBoard, createBoardStash } from './menuBar';
import { expect, test, type Page } from '@playwright/test';
import { choosePileOrder, openPileOptions } from './pileDock';

async function importImages(page: Page, count = 12) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').evaluate((input: HTMLInputElement, count) => {
    const files = new DataTransfer();
    for (let i = 0; i < count; i++) {
      const canvas = document.createElement('canvas'); canvas.width = i % 2 ? 300 : 420; canvas.height = i % 3 ? 300 : 420;
      const ctx = canvas.getContext('2d')!, colors = ['#cd8c77','#789ec7','#c1c56d','#81b197','#b79bc7'];
      ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff60'; ctx.beginPath(); ctx.arc(canvas.width * .65, canvas.height * .35, 60, 0, Math.PI * 2); ctx.fill();
      ctx.font = 'bold 48px system-ui'; ctx.fillStyle = '#173528'; ctx.fillText(String(i + 1).padStart(2, '0'), 30, canvas.height - 35);
      const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
      files.items.add(new File([bytes], `image-${String(i).padStart(2, '0')}.png`, { type: 'image/png' }));
    }
    input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, count);
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
}

async function savedImages(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
    const images = await new Promise<any[]>(resolve => { const request = db.transaction('images').objectStore('images').getAll(); request.onsuccess = () => resolve(request.result); });
    db.close(); return images;
  });
}

test('one persistent add control works while collapsed; choosing a count never adds images', async ({ page }) => {
  await importImages(page, 8);
  const boardCards = page.locator('.sorting-workspace__board .card');
  const picker = page.getByRole('combobox', { name: 'Images per add' });
  await expect(page.locator('.sorting-workspace__plus')).toHaveCount(0);
  await picker.selectOption('5'); await expect(boardCards).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse image pile' }).click();
  await expect(page.getByLabel('Scroll image pile', { exact: true })).toBeHidden();
  await expect(page.getByRole('separator', { name: 'Resize image pile' })).toHaveAttribute('aria-valuenow', '76');
  await expect(page.getByRole('button', { name: 'Explore image pile' })).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Add 5 random images' }).click();
  await expect(boardCards).toHaveCount(5);
  await expect(page.locator('.pile-dock__feedback')).toHaveText('Added 5 images');
  await expect(page.getByRole('button', { name: 'Add remaining 3' })).toBeEnabled();
  await page.getByRole('button', { name: 'Add remaining 3' }).click();
  await expect(boardCards).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Pile empty' })).toBeDisabled();
  expect((await savedImages(page)).every(image => image.categoryId === null)).toBe(true);
  await page.getByRole('button', { name: 'Explore image pile' }).click();
  await expect(page.getByRole('dialog', { name: 'Explore image pile', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to sorting board' }).click();
  await expect(page.getByRole('button', { name: 'Expand image pile' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand image pile' }).click();
  await expect(page.getByRole('separator', { name: 'Resize image pile' })).toHaveAttribute('aria-valuenow', '235');
});

test('next follows the chosen pile order, rapid clicks do not duplicate intake, and the board camera stays steady', async ({ page }) => {
  await importImages(page, 12);
  await choosePileOrder(page, 'name');
  const canvas = page.getByTestId('board-canvas');
  const before = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Add next 3 images' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.locator('.sorting-workspace__board .card')).toHaveCount(3);
  await expect.poll(async () => (await savedImages(page)).filter(image => image.placement === 'board').map(image => image.path).sort()).toEqual(['image-00.png', 'image-01.png', 'image-02.png']);
  const after = (await canvas.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(.5); expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(.5);
  await openPileOptions(page); await page.getByRole('button', { name: 'Reverse pile order' }).click();
  await expect(page.getByRole('button', { name: 'Reverse pile order' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Pile options', { exact: true }).press('Escape');
  await page.getByRole('combobox', { name: 'Images per add' }).selectOption('1');
  await page.getByRole('button', { name: 'Add next 1 image' }).click();
  await expect.poll(async () => (await savedImages(page)).find(image => image.path === 'image-11.png')?.placement).toBe('board');
  await openPileOptions(page); await page.getByRole('button', { name: 'Shuffle pile' }).click();
  await expect(page.getByRole('button', { name: 'Add 1 random image' })).toBeVisible();
});

test('collapse snaps when dragged, remembers the expanded height and scroll position, and survives reload', async ({ page }) => {
  await importImages(page, 60);
  const grip = page.getByRole('separator', { name: 'Resize image pile' });
  const scroll = page.getByLabel('Scroll image pile', { exact: true });
  await scroll.evaluate(element => { element.scrollLeft = 640; });
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBe(640);
  await grip.focus(); await grip.press('Shift+ArrowUp'); await grip.press('Shift+ArrowUp');
  const expanded = Number(await grip.getAttribute('aria-valuenow'));
  const rect = (await grip.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 8); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, 980, { steps: 12 }); await page.mouse.up();
  await expect(grip).toHaveAttribute('aria-valuenow', '76');
  await page.getByRole('button', { name: 'Expand image pile' }).click();
  await expect(grip).toHaveAttribute('aria-valuenow', String(expanded));
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBe(640);
  await grip.focus(); await grip.press('Home');
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace' }).click();
  await expect(grip).toHaveAttribute('aria-valuenow', '76');
  await grip.focus(); await grip.press('ArrowUp');
  await expect(grip).toHaveAttribute('aria-valuenow', String(expanded));
});

test('intake inside a stash uses its direct pile and keeps stash assignments', async ({ page }) => {
  await importImages(page, 8); await choosePileOrder(page, 'name');
  await page.getByRole('button', { name: 'Add next 3 images' }).click();
  const cards = page.locator('.sorting-workspace__board .card');
  await cards.first().click(); await cards.nth(1).click({ modifiers: ['Shift'] });
  await createBoardStash(page);
  const name = page.getByRole('textbox', { name: 'Stash name', exact: true }); await name.fill('Places'); await name.press('Enter');
  await page.getByRole('button', { name: 'Open stash Places' }).click();
  const before = (await savedImages(page)).map(image => ({ id: image.id, categoryId: image.categoryId }));
  await openBoardActions(page); await page.getByRole('button', { name: 'Clear board', exact: true }).click();
  await expect(cards).toHaveCount(0); await page.getByRole('button', { name: 'Collapse image pile' }).click();
  await page.getByRole('combobox', { name: 'Images per add' }).selectOption('1');
  await page.getByRole('button', { name: 'Add next 1 image' }).click(); await expect(cards).toHaveCount(1);
  expect((await savedImages(page)).map(image => ({ id: image.id, categoryId: image.categoryId }))).toEqual(before);
  await expect(page.locator('.pile-dock__name')).toContainText('1 in pile · 2 here');
});

test('dock stays reachable on phones and short landscape, with reduced motion and accessible options', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await importImages(page, 12);
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const add = page.getByRole('button', { name: 'Add 3 random images' });
    await expect(add).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('combobox', { name: 'Images per add' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Explore image pile' })).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Collapse image pile' }).click();
    await expect(add).toBeInViewport({ ratio: 1 });
    await openPileOptions(page);
    const size = page.getByRole('slider', { name: 'Pile image size', exact: true });
    await size.scrollIntoViewIfNeeded(); await expect(size).toBeInViewport({ ratio: 1 });
    await size.press('Escape'); await expect(page.getByLabel('Pile options', { exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Expand image pile' }).click();
  }
  await page.getByRole('button', { name: 'Collapse image pile' }).click();
  await page.getByRole('button', { name: 'Add 3 random images' }).click();
  const cards = page.locator('.sorting-workspace__board .card'); await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) await expect(card).toBeInViewport({ ratio: .99 });
});

test('new batches stay in the panned, zoomed viewport and avoid named stash stacks', async ({ page }) => {
  await importImages(page, 24);
  await createBoardStash(page);
  const name = page.getByRole('textbox', { name: 'Stash name', exact: true }); await name.fill('Neighbours'); await name.press('Enter');
  await page.getByRole('combobox', { name: 'Images per add' }).selectOption('5');
  await page.getByRole('button', { name: 'Add 5 random images' }).click();
  const cards = page.locator('.sorting-workspace__board .card'); await expect(cards).toHaveCount(5);
  const tile = page.getByRole('region', { name: 'Stash Neighbours', exact: true });
  const stack = (await tile.boundingBox())!;
  for (const card of await cards.all()) {
    const rect = (await card.boundingBox())!;
    expect(rect.x >= stack.x + stack.width || rect.x + rect.width <= stack.x || rect.y >= stack.y + stack.height || rect.y + rect.height <= stack.y).toBe(true);
  }
  await zoomBoard(page, 'out'); await zoomBoard(page, 'out');
  await page.getByTestId('board-root').evaluate(board => { board.scrollLeft += 380; board.scrollTop += 240; });
  const previous = new Set((await savedImages(page)).filter(image => image.placement === 'board').map(image => image.id));
  const before = (await page.getByTestId('board-canvas').boundingBox())!;
  await page.getByRole('button', { name: 'Add 5 random images' }).click();
  await expect.poll(async () => (await savedImages(page)).filter(image => image.placement === 'board').length).toBe(10);
  const after = (await page.getByTestId('board-canvas').boundingBox())!;
  // WebKit rounds the native scroll position when the world grows at a
  // fractional zoom. Half a CSS pixel is the same camera position.
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(.5); expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(.5);
  for (const image of (await savedImages(page)).filter(image => image.placement === 'board' && !previous.has(image.id))) {
    await expect(page.locator('.sorting-workspace__board').getByTestId(`card-${image.id}`)).toBeInViewport({ ratio: .99 });
  }
});
