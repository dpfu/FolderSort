import { test, expect } from './persistentFixtures';
import type { Page } from '@playwright/test';
import fs from 'node:fs/promises';
import { mockClipInference } from './clipFixtures';
import { fitBoard, openBoardTools, openWorkspaceExport, showImageBrowser } from './menuBar';

const board = (page: Page) => page.getByTestId('board-root');
const idle = (page: Page) =>
  expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
const camera = (page: Page) =>
  board(page).evaluate((element) => {
    const root = element.getBoundingClientRect();
    const canvas = element.querySelector<HTMLElement>('[data-testid="board-canvas"]')!;
    const box = canvas.getBoundingClientRect(),
      scale = box.width / canvas.offsetWidth;
    return {
      x: (root.left + root.width / 2 - box.left) / scale,
      y: (root.top + root.height / 2 - box.top) / scale,
    };
  });
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('sortboard-image-library-minimal', 2);
      r.onsuccess = () => resolve(r.result);
    });
    const rows = await new Promise<any[]>((resolve) => {
      const r = db.transaction('images').objectStore('images').getAll();
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    return rows;
  });
}
async function seed(page: Page, amount = 12, start = true) {
  await mockClipInference(page);
  await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(
    Array.from({ length: amount }, (_, i) => ({
      name: `image-${String(i).padStart(2, '0')}.svg`,
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="${i % 2 ? '#a6b88a' : '#93adb6'}"/><text x="20" y="60">${i}</text></svg>`,
      ),
    })),
  );
  const starter = page.getByRole('region', { name: 'Start with random images', exact: true });
  if (!start) {
    await expect(starter).toBeVisible();
    return;
  }
  await starter.getByRole('spinbutton').fill('1');
  await starter.getByRole('button', { name: 'Add 1 image', exact: true }).click();
  await idle(page);
  await expect(board(page).locator('.card[data-arriving]')).toHaveCount(0);
}

test('PNG export recovers a corrupt cached thumbnail from its readable original', async ({
  page,
}) => {
  await seed(page);
  const image = (await records(page)).find((image) => image.rootOnBoard !== false);
  await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('sortboard-image-library-minimal', 2);
      r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction('assets', 'readwrite');
    tx.objectStore('assets').put(
      new Blob(['broken thumbnail'], { type: 'image/png' }),
      'thumbnail:v1:' + id,
    );
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, image.id);
  await openWorkspaceExport(page);
  const downloading = page.waitForEvent('download', { timeout: 6000 });
  await page.getByRole('button', { name: 'Current view (PNG)', exact: true }).click();
  const download = await downloading;
  const bytes = await fs.readFile((await download.path())!);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await expect(page.locator('.sorting-workspace')).toContainText('Board PNG saved');
  await expect(page.locator('.sorting-workspace')).not.toContainText('preview unavailable');
});

for (const method of ['color', 'clip'])
  test(`board-wide ${method} additions can be selected, dragged and moved into a folder`, async ({
    page,
  }) => {
    await seed(page);
    const original = (await records(page))
      .filter((image) => image.rootOnBoard !== false)
      .map((image) => image.id);
    await openBoardTools(page);
    const tools = page.locator('.workspace-similarity');
    await tools
      .getByRole('combobox', { name: 'Similarity method', exact: true })
      .selectOption(method);
    await tools.getByRole('button', { name: 'Add matches', exact: true }).click();
    await expect
      .poll(async () => (await records(page)).filter((image) => image.rootOnBoard !== false).length)
      .toBe(4);
    await idle(page);
    await page.keyboard.press('Escape');
    const added = (await records(page)).filter(
      (image) => image.rootOnBoard !== false && !original.includes(image.id),
    );
    expect(added).toHaveLength(3);
    // The default result is a selected group: it must also move without a reset.
    const groupTarget = page.getByTestId('card-' + added[0].id);
    const groupBox = (await groupTarget.boundingBox())!;
    await page.mouse.move(groupBox.x + groupBox.width / 2, groupBox.y + groupBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      groupBox.x + groupBox.width / 2 + 30,
      groupBox.y + groupBox.height / 2 + 50,
      { steps: 12 },
    );
    await page.mouse.up();
    await idle(page);
    await expect
      .poll(async () => (await records(page)).find((image) => image.id === added[0].id).boardY)
      .not.toBe(added[0].boardY);
    await page.getByRole('button', { name: 'Deselect images', exact: true }).click();
    await expect(board(page).locator('.card[data-board-drag-follower]')).toHaveCount(0);
    const target = page.getByTestId('card-' + added[0].id);
    await target.click();
    await expect(target).toHaveClass(/isSelected/);
    const box = (await target.boundingBox())!;
    const beforeIndividual = (await records(page)).find((image) => image.id === added[0].id);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 90, { steps: 12 });
    await page.mouse.up();
    await idle(page);
    await expect
      .poll(async () => (await records(page)).find((image) => image.id === added[0].id).boardY)
      .not.toBe(beforeIndividual.boardY);
    await page
      .getByRole('group', { name: 'Image actions', exact: true })
      .getByRole('button', { name: /^Create folder/ })
      .click();
    await idle(page);
    const folderId = (await records(page)).find((image) => image.id === added[0].id).categoryId;
    expect(folderId).not.toBeNull();
    await fitBoard(page);
    const next = page.getByTestId('card-' + added[1].id);
    await next.click();
    const from = (await next.boundingBox())!;
    const to = (await page.locator(`[data-stash-drop-id="${folderId}"]`).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 });
    await page.mouse.up();
    await expect.poll(async () => (await records(page)).find(image => image.id === added[1].id).categoryId).toBe(folderId);
  });

test('browser Shift-click ranges follow filters and order, with independent toggle selection', async ({
  page,
}) => {
  await seed(page);
  await showImageBrowser(page);
  const browser = page.getByRole('region', { name: 'Image browser', exact: true });
  await page
    .getByRole('combobox', { name: 'Image browser order', exact: true })
    .selectOption('name');
  const rows = (await records(page)).sort((a, b) => a.path.localeCompare(b.path));
  const card = (i: number) => page.getByTestId('browser-card-' + rows[i].id);
  const chosen = () =>
    browser
      .locator('.card.isSelected')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-testid')!.replace('browser-card-', '')).sort(),
      );
  await card(0).click();
  await card(4).click({ modifiers: ['Shift'] });
  expect(await chosen()).toEqual(
    rows
      .slice(0, 5)
      .map((row) => row.id)
      .sort(),
  );
  await card(2).click({ modifiers: ['Shift'] });
  expect(await chosen()).toEqual(
    rows
      .slice(0, 3)
      .map((row) => row.id)
      .sort(),
  );
  await card(7).click({ modifiers: ['ControlOrMeta'] });
  await card(9).click({ modifiers: ['Shift'] });
  expect(await chosen()).toEqual(
    [...rows.slice(0, 3), ...rows.slice(7, 10)].map((row) => row.id).sort(),
  );
  await page.getByRole('button', { name: 'Filters & view', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find images', exact: true }).fill('image-0');
  await expect(browser.locator('.image-browser__header > span')).toHaveText('10 / 12');
  await page.getByRole('button', { name: 'Reverse image order', exact: true }).click();
  await card(9).click();
  await card(5).click({ modifiers: ['Shift'] });
  expect(await chosen()).toEqual(
    rows
      .slice(5, 10)
      .map((row) => row.id)
      .sort(),
  );
});

test('range selection includes virtualized rows between the clicked images', async ({ page }) => {
  await seed(page, 80);
  await showImageBrowser(page);
  await page
    .getByRole('combobox', { name: 'Image browser order', exact: true })
    .selectOption('name');
  const rows = (await records(page)).sort((a, b) => a.path.localeCompare(b.path));
  await page.getByTestId('browser-card-' + rows[0].id).click();
  await page
    .locator('.image-browser__scroll')
    .evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
  await page.getByTestId('browser-card-' + rows[79].id).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('group', { name: 'Image actions', exact: true })).toContainText('80');
});

test('thumbnail size is directly accessible and a wide dock preserves board space and preferences', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await seed(page);
  await showImageBrowser(page);
  await expect(page.getByRole('button', { name: 'Filters & view', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const size = page.getByRole('slider', { name: 'Browser thumbnail size', exact: true });
  await size.focus();
  await size.press('End');
  await expect(size).toHaveValue('200');
  const handle = page.getByRole('separator', { name: 'Resize image browser', exact: true });
  const beforeResize = await camera(page);
  const beforePositions = (await records(page)).map(({ id, boardX, boardY }) => ({
    id,
    boardX,
    boardY,
  }));
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 100);
  await page.mouse.down();
  for (let step = 1; step <= 40; step++) {
    await page.mouse.move(grip.x + grip.width / 2 + (540 * step) / 40, grip.y + 100);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await camera(page)).x - beforeResize.x)).toBeLessThan(2);
  await handle.focus();
  await handle.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '1200');
  expect((await page.locator('.image-browser').boundingBox())!.width).toBeCloseTo(1200, 0);
  expect((await board(page).boundingBox())!.width).toBeGreaterThanOrEqual(400);
  await expect.poll(async () => Math.abs((await camera(page)).x - beforeResize.x)).toBeLessThan(2);
  expect((await records(page)).map(({ id, boardX, boardY }) => ({ id, boardX, boardY }))).toEqual(
    beforePositions,
  );
  await page.screenshot({ path: 'output/ux-pass-2026-11-09/wide-browser.png' });
  await page.getByRole('button', { name: 'Expand image browser', exact: true }).click();
  await page.getByRole('button', { name: 'Return to sorting board', exact: true }).click();
  await expect.poll(async () => Math.abs((await camera(page)).x - beforeResize.x)).toBeLessThan(2);
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await expect(size).toHaveValue('200');
  await expect(handle).toHaveAttribute('aria-valuenow', '1200');
  await page.setViewportSize({ width: 1024, height: 1080 });
  await expect(handle).toHaveAttribute('aria-valuenow', '624');
  expect((await board(page).boundingBox())!.width).toBeGreaterThanOrEqual(400);
});

test('starter shows overflow and random preview quantity survives dismissal and reload', async ({
  page,
}) => {
  await seed(page, 16, false);
  const starter = page.getByRole('region', { name: 'Start with random images', exact: true });
  await starter.getByRole('spinbutton').fill('8');
  await expect(starter.locator('.board-starter__more')).toHaveText('+5 more');
  await page.screenshot({ path: 'output/ux-pass-2026-11-09/starter-overflow.png' });
  await starter.getByRole('button', { name: 'Add 8 images', exact: true }).click();
  await idle(page);
  await page.getByRole('button', { name: 'Preview 8 random images', exact: true }).click();
  const count = page.getByRole('combobox', { name: 'Number of preview images', exact: true });
  await count.selectOption('4');
  await page.getByRole('button', { name: 'Dismiss random image previews', exact: true }).click();
  await page.getByRole('button', { name: 'Preview 4 random images', exact: true }).click();
  await expect(count).toHaveValue('4');
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Preview 4 random images', exact: true }).click();
  await expect(count).toHaveValue('4');
});

test('related preview quantity survives changing the selected image and reopening the project', async ({
  page,
}) => {
  await seed(page, 18);
  const show = () =>
    page.getByRole('button', { name: 'Show related image suggestions', exact: true }).click();
  await show();
  await page
    .getByRole('combobox', { name: 'Suggestion method', exact: true })
    .selectOption('color');
  const count = page.getByRole('combobox', { name: 'Number of suggestions', exact: true });
  await count.selectOption('5');
  await expect(board(page).locator('[data-suggestion-preview]')).toHaveCount(5);
  await page
    .getByRole('region', { name: 'Similar image suggestions', exact: true })
    .getByRole('button', { name: 'Add 5', exact: true })
    .click();
  await idle(page);
  await board(page).locator('.card').nth(1).click();
  await show();
  await expect(count).toHaveValue('5');
  await page.reload();
  await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click();
  await board(page).locator('.card').first().click();
  await show();
  await expect(count).toHaveValue('5');
});
