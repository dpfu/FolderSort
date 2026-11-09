import { test, expect } from './persistentFixtures';
import type { Page, Locator } from '@playwright/test';
import { addAllUnsortedToBoard, fitBoard, createBoardStash } from './menuBar';

const card = (page: Page, index: number) => page.locator('.sorting-workspace__board').getByRole('group', { name: `Card: group-${index}.png`, exact: true });
const idle = (page: Page) => expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
const frames = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
    const images = await new Promise<any[]>(resolve => { const request = db.transaction('images').objectStore('images').getAll(); request.onsuccess = () => resolve(request.result); });
    db.close(); return images.map(({ id, path, categoryId, boardX, boardY, rootOnBoard }: any) => ({ id, path, categoryId, boardX, boardY, rootOnBoard }));
  });
}
async function fixture(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').evaluate((input: HTMLInputElement) => {
    const files = new DataTransfer();
    for (let index = 0; index < 4; index++) {
      const canvas = document.createElement('canvas'); canvas.width = index % 2 ? 240 : 360; canvas.height = index % 2 ? 360 : 240;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = ['#b6d7b0', '#e1ba8f', '#9cbccf', '#c4a9d6'][index]; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#234b3c'; ctx.font = '32px sans-serif'; ctx.fillText(`Image ${index + 1}`, 24, 60);
      const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), char => char.charCodeAt(0));
      files.items.add(new File([bytes], `group-${index}.png`, { type: 'image/png' }));
    }
    input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await addAllUnsortedToBoard(page); await idle(page);
  // Stable fixture coordinates let the tests distinguish group movement from
  // camera movement and inspect photos before the drop writes anything.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction('images', 'readwrite'), store = tx.objectStore('images');
    const images = await new Promise<any[]>(resolve => { const request = store.getAll(); request.onsuccess = () => resolve(request.result); });
    for (const image of images) {
      const index = Number(image.path.match(/group-(\d)/)![1]);
      const point = [{ x: 120, y: 160 }, { x: 400, y: 185 }, { x: 690, y: 440 }, { x: 140, y: 470 }][index];
      store.put({ ...image, boardX: point.x, boardY: point.y }, image.id);
    }
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
  });
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await fitBoard(page);
  await expect(card(page, 0)).toBeVisible(); await frames(page);
}
async function settle(locator: Locator) {
  await locator.evaluate(async element => {
    let previous = element.getBoundingClientRect(), stable = 0;
    for (let frame = 0; frame < 120 && stable < 4; frame++) {
      await new Promise(requestAnimationFrame); const box = element.getBoundingClientRect();
      stable = Math.abs(box.x - previous.x) + Math.abs(box.y - previous.y) < .1 ? stable + 1 : 0; previous = box;
    }
  });
}
async function begin(page: Page, index: number) {
  await settle(card(page, index)); const before = (await card(page, index).boundingBox())!;
  const point = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 8, point.y + 6);
  await expect(page.locator('.sorting-workspace__drag-ghost')).toBeVisible(); return { before, point };
}

for (const index of [0, 1]) test(`releasing a ${index ? 'portrait' : 'landscape'} photo never paints a shadow around its larger drag frame`, async ({ page }, testInfo) => {
  await fixture(page);
  await begin(page, index);
  const target = (await card(page, index ? 0 : 1).boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await frames(page);
  // Sample the actual release frames: the source card is hidden behind the
  // image-shaped ghost during dragging and becomes visible while settling.
  const settling = card(page, index).evaluate(async element => {
    const samples: { opacity: number; shadow: string }[] = [], start = performance.now();
    while (performance.now() - start < 500) {
      await new Promise(requestAnimationFrame);
      const style = getComputedStyle(element);
      samples.push({ opacity: Number(style.opacity), shadow: style.boxShadow });
    }
    return samples.filter(sample => sample.opacity > .1);
  });
  await page.mouse.up();
  await expect(page.locator('.sorting-workspace__drag-ghost')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('release.png') });
  const visibleFrames = await settling;
  expect(visibleFrames.length).toBeGreaterThan(0);
  expect([...new Set(visibleFrames.map(frame => frame.shadow))]).toEqual(['none']);
  await expect(card(page, index).locator('img')).toHaveCSS('filter', /drop-shadow/);
  await idle(page);
});

test('selected board photos follow the pointer together before release and commit without a catch-up animation', async ({ page }) => {
  await fixture(page); await card(page, 0).click(); await card(page, 1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.sorting-workspace__board .card.isSelected')).toHaveCount(2);
  const original = await records(page), follower = (await card(page, 0).boundingBox())!;
  const { before, point } = await begin(page, 1), ghost = page.locator('.sorting-workspace__drag-ghost');
  for (const offset of [{ x: 85, y: 65 }, { x: 40, y: 105 }]) {
    await page.mouse.move(point.x + offset.x, point.y + offset.y, { steps: 8 });
    await expect(ghost).toContainText('Move 2 images');
    await expect.poll(async () => {
      const lead = (await ghost.boundingBox())!, other = (await card(page, 0).boundingBox())!;
      return Math.max(Math.abs((other.x - follower.x) - (lead.x - before.x)), Math.abs((other.y - follower.y) - (lead.y - before.y)));
    }).toBeLessThan(1.5);
    expect(await records(page)).toEqual(original);
  }
  const preview = (await card(page, 0).boundingBox())!;
  await page.screenshot({ path: '/tmp/foldersort-group-drag-preview.png' });
  await page.mouse.up(); await frames(page);
  const after = (await card(page, 0).boundingBox())!;
  expect(Math.max(Math.abs(after.x - preview.x), Math.abs(after.y - preview.y))).toBeLessThan(1.5);
  await idle(page);
  const saved = await records(page), first = saved.find(image => image.path === 'group-0.png')!, second = saved.find(image => image.path === 'group-1.png')!;
  expect(second.boardX - first.boardX).toBe(280); expect(second.boardY - first.boardY).toBe(25);
  expect(saved.filter(image => !['group-0.png', 'group-1.png'].includes(image.path))).toEqual(original.filter(image => !['group-0.png', 'group-1.png'].includes(image.path)));
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await idle(page);
  expect(await records(page)).toEqual(original);
});

test('lasso group previews cancel cleanly and move into a stash as one undoable action', async ({ page }) => {
  await fixture(page);
  // Add an assignment target before selecting so the selected pair remains a
  // freely positioned group rather than becoming the new stash immediately.
  await createBoardStash(page); const name = page.getByRole('textbox', { name: 'Folder name', exact: true });
  await name.fill('Destination'); await name.press('Enter'); await expect(name).toHaveCount(0); await idle(page); await fitBoard(page);
  await settle(card(page, 0)); await settle(card(page, 1));
  const a = (await card(page, 0).boundingBox())!, b = (await card(page, 1).boundingBox())!;
  await page.keyboard.down('Shift'); await page.mouse.move(Math.min(a.x, b.x) - 12, Math.min(a.y, b.y) - 12); await page.mouse.down();
  await page.mouse.move(Math.max(a.x + a.width, b.x + b.width) + 12, Math.max(a.y + a.height, b.y + b.height) + 12, { steps: 12 });
  await page.mouse.up(); await page.keyboard.up('Shift');
  await expect(page.locator('.sorting-workspace__board .card.isSelected')).toHaveCount(2);
  const original = await records(page);
  const { point } = await begin(page, 1); await page.mouse.move(point.x + 60, point.y + 45, { steps: 10 });
  await expect(page.locator('[data-board-drag-follower]')).toHaveCount(1);
  await page.keyboard.press('Escape'); await page.mouse.up(); await frames(page);
  await expect(page.locator('.sorting-workspace__drag-ghost, [data-board-drag-follower]')).toHaveCount(0);
  await idle(page); expect(await records(page)).toEqual(original);
  await card(page, 0).click(); await card(page, 1).click({ modifiers: ['Shift'] });
  await begin(page, 1);
  const pane = (await page.getByRole('region', { name: 'Image browser', exact: true }).boundingBox())!;
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('[data-board-drag-follower]')).toHaveCount(0); await idle(page);
  expect((await records(page)).filter(image => image.rootOnBoard === false)).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo remove from staging', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(original);
  const thumbnail = (await page.getByLabel('Card: group-0.png. Current area: Image browser', { exact: true }).boundingBox())!;
  await page.mouse.move(thumbnail.x + thumbnail.width / 2, thumbnail.y + thumbnail.height / 2); await page.mouse.down();
  await page.mouse.move(thumbnail.x + thumbnail.width / 2 + 60, thumbnail.y + thumbnail.height / 2 + 45, { steps: 10 });
  await expect(page.locator('.sorting-workspace__drag-ghost')).toBeVisible(); await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.sorting-workspace__drag-ghost')).toHaveCount(0); expect(await records(page)).toEqual(original);
  await card(page, 0).click(); await card(page, 1).click({ modifiers: ['Shift'] });
  // Cancellation returns the grabbed card via Motion. Frame and settle the
  // actual destination before the next gesture, rather than aiming at an
  // off-screen or still-moving target's old bounding box.
  await fitBoard(page);
  const destination = page.getByRole('region', { name: 'Folder Destination', exact: true });
  // CSS-pixel intersections can round a fully visible tile just below 1.
  await settle(destination); await expect(destination).toBeInViewport({ ratio: .999 });
  const target = (await destination.locator('.stash-tile__head').boundingBox())!;
  await begin(page, 1);
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await expect(page.locator('.sorting-workspace__drag-ghost')).toContainText('Move 2 into Destination');
  expect(await records(page)).toEqual(original); await page.mouse.up(); await idle(page);
  await expect(page.locator('[data-board-drag-follower]')).toHaveCount(0);
  const saved = await records(page), pair = saved.filter(image => ['group-0.png', 'group-1.png'].includes(image.path));
  expect(pair).toHaveLength(2); expect(pair[0].categoryId).toBeTruthy(); expect(pair[0].categoryId).toBe(pair[1].categoryId);
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(original);
});

test('a zoomed group keeps its spacing at the board boundary and native touch cancellation restores the preview', async ({ page, browserName, context }) => {
  await fixture(page); await card(page, 0).click(); await card(page, 1).click({ modifiers: ['Shift'] });
  // Lower the zoom so the world origin is reachable inside the viewport.
  await page.locator('.workspace-zoom-menu>summary').click(); await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); await page.keyboard.press('Escape');
  await card(page, 0).click(); await card(page, 1).click({ modifiers: ['Shift'] });
  const original = await records(page), a = (await card(page, 0).boundingBox())!;
  const { before, point } = await begin(page, 1), canvas = (await page.getByTestId('board-canvas').boundingBox())!;
  const boardPane = (await page.getByRole('region', { name: 'Sorting board area' }).boundingBox())!;
  await page.mouse.move(Math.max(boardPane.x + 12, canvas.x + 8), point.y + 30, { steps: 12 });
  await expect.poll(async () => {
    const lead = (await page.locator('.sorting-workspace__drag-ghost').boundingBox())!, follower = (await card(page, 0).boundingBox())!;
    return Math.abs((lead.x - follower.x) - (before.x - a.x));
  }).toBeLessThan(1.5);
  // Equal spacing alone can also hold at the old position. Wait for the
  // final pointer frame to actually reach the boundary before releasing.
  await expect.poll(async () => {
    const follower = (await card(page, 0).boundingBox())!, world = (await page.getByTestId('board-canvas').boundingBox())!;
    return Math.abs(follower.x - world.x);
  }).toBeLessThan(1.5);
  await page.mouse.up();
  await expect.poll(async () => Math.min(...(await records(page)).filter(image => ['group-0.png', 'group-1.png'].includes(image.path)).map(image => image.boardX))).toBe(0);
  await idle(page);
  const after = await records(page), pair = after.filter(image => ['group-0.png', 'group-1.png'].includes(image.path));
  expect(Math.min(...pair.map(image => image.boardX))).toBe(0);
  expect(pair.find(image => image.path === 'group-1.png')!.boardX - pair.find(image => image.path === 'group-0.png')!.boardX).toBe(280);
  await page.getByRole('button', { name: 'Undo image move', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(original);
  if (browserName !== 'chromium') return;
  await settle(card(page, 0)); await settle(card(page, 1));
  const lead = (await card(page, 1).boundingBox())!, follower = (await card(page, 0).boundingBox())!;
  const finger = { x: lead.x + lead.width / 2, y: lead.y + lead.height / 2 };
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...finger, id: 1 }] });
  for (let step = 1; step <= 10; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: finger.x + step * 7, y: finger.y + step * 4, id: 1 }] });
  await expect(page.locator('[data-board-drag-follower]')).toHaveCount(1);
  await expect.poll(async () => {
    const ghost = (await page.locator('.sorting-workspace__drag-ghost').boundingBox())!, other = (await card(page, 0).boundingBox())!;
    return Math.max(Math.abs((other.x - follower.x) - (ghost.x - lead.x)), Math.abs((other.y - follower.y) - (ghost.y - lead.y)));
  }).toBeLessThan(1.5);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await idle(page);
  await expect(page.locator('.sorting-workspace__drag-ghost, [data-board-drag-follower]')).toHaveCount(0); expect(await records(page)).toEqual(original);
});
