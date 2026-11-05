import { test, expect } from './persistentFixtures';
import type { Page } from '@playwright/test';
import { mockClipInference } from './clipFixtures';

const board = (page: Page) => page.getByRole('region', { name: 'Sorting board area', exact: true });
const draft = (page: Page) => page.getByRole('region', { name: 'Random image previews', exact: true });
const previews = (page: Page) => board(page).locator('[data-suggestion-preview]');
async function idle(page: Page) {
  await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
  await expect(board(page).locator('.card[data-arriving]')).toHaveCount(0);
}
async function seed(page: Page, total = 24) {
  await mockClipInference(page); await page.goto('/');
  await page.locator('input[accept="image/*"]').setInputFiles(Array.from({ length: total }, (_, i) => ({
    name: `image-${i}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${i % 2 ? 240 : 360}" height="${i % 2 ? 360 : 240}"><rect width="100%" height="100%" fill="${['#b79578','#9db7bf','#b2bd88'][i % 3]}"/><circle cx="120" cy="120" r="64" fill="#456557"/></svg>`),
  })));
  await page.getByRole('button', { name: 'Skip starter', exact: true }).click(); await idle(page);
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
    const rows = await new Promise<any[]>(resolve => { const request = db.transaction('images').objectStore('images').getAll(); request.onsuccess = () => resolve(request.result); }); db.close();
    return rows.map(({ id, categoryId, boardX, boardY, rootOnBoard, stashOrder, size }) => ({ id, categoryId, boardX, boardY, rootOnBoard, stashOrder, size }));
  });
}
async function camera(page: Page) {
  return board(page).getByTestId('board-root').evaluate(el => {
    const canvas = el.querySelector('[data-testid="board-canvas"]') as HTMLElement, rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, transform: canvas.style.transform, scrollX: el.scrollLeft, scrollY: el.scrollTop };
  });
}
async function preview(page: Page) {
  await page.getByRole('button', { name: /^Preview \d+ random images?$/ }).click(); await expect(draft(page)).toBeVisible();
  await expect.poll(() => previews(page).evaluateAll(nodes => nodes.every(el => { const img = el.querySelector('img'); return !!img?.complete && img.naturalWidth > 0; }))).toBe(true);
  await expect(board(page).locator('.board-preview-frame')).toHaveCount(1);
  expect(await board(page).locator('.board-suggestions__previews').evaluate(root => {
    const frame = root.querySelector('.board-preview-frame')!.getBoundingClientRect();
    return [...root.querySelectorAll<HTMLElement>('[data-suggestion-preview]')].every(cell => {
      const photo = cell.querySelector('img')!, box = photo.getBoundingClientRect();
      const scale = Math.min(box.width / photo.naturalWidth, box.height / photo.naturalHeight);
      const width = photo.naturalWidth * scale, height = photo.naturalHeight * scale;
      const left = box.left + (box.width - width) / 2, top = box.top + (box.height - height) / 2;
      return frame.left < left && frame.top < top && frame.right > left + width && frame.bottom > top + height
        && getComputedStyle(cell, '::after').content === 'none';
    });
  })).toBe(true);
  return previews(page).evaluateAll(nodes => nodes.map(el => {
    const node = el as HTMLElement, box = node.getBoundingClientRect(), photo = node.querySelector('img')!.getBoundingClientRect();
    return { id: node.dataset.suggestionPreview!, x: Number.parseFloat(node.style.left), y: Number.parseFloat(node.style.top), box: { x: box.x, y: box.y }, photo: { x: photo.x, y: photo.y, width: photo.width, height: photo.height } };
  }));
}
async function accept(page: Page) { await draft(page).getByRole('button', { name: /^Add (these \d+|this image)$/ }).click(); await idle(page); await expect(draft(page)).toHaveCount(0); await expect(board(page).locator('.board-preview-frame')).toHaveCount(0); }

async function observeLanding(page: Page) {
  await board(page).evaluate(root => {
    const results: any[] = []; (window as any).previewLandings = results;
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement) || !node.matches('.board-preview-frame--placed')) continue;
        results.push({ pointerEvents: getComputedStyle(node).pointerEvents, children: node.childElementCount,
          duration: node.getAnimations()[0]?.effect?.getTiming().duration });
      }
    });
    observer.observe(root, { childList: true, subtree: true });
  });
}

test('desktop plus previews without saving; acceptance, minus and Undo preserve exact positions and the camera', async ({ page }) => {
  await seed(page); const initial = await records(page), view = await camera(page), planned = await preview(page);
  expect(planned).toHaveLength(3); expect(await records(page)).toEqual(initial); expect(await camera(page)).toEqual(view);
  await observeLanding(page);
  await accept(page); const saved = await records(page); expect(await camera(page)).toEqual(view);
  expect(await page.evaluate(() => (window as any).previewLandings)).toEqual([{ pointerEvents: 'none', children: 0, duration: 220 }]);
  for (const item of planned) {
    expect(saved.find(row => row.id === item.id)).toMatchObject({ rootOnBoard: true, boardX: item.x, boardY: item.y });
    const card = page.getByTestId('card-' + item.id), photo = (await card.locator('.cardPreview__img').boundingBox())!, box = (await card.boundingBox())!;
    for (const key of ['x','y'] as const) expect(Math.abs(box[key] - item.box[key])).toBeLessThan(.8);
    for (const key of ['x','y','width','height'] as const) expect(Math.abs(photo[key] - item.photo[key])).toBeLessThan(.8);
  }
  const first = planned[0]; await page.getByTestId('card-' + first.id).press('s');
  await page.getByRole('button', { name: 'Remove image from staging', exact: true }).click(); await idle(page);
  await expect(board(page).locator('.card')).toHaveCount(2);
  const removed = (await records(page)).find(row => row.id === first.id); expect(removed).toMatchObject({ rootOnBoard: false, boardX: first.x, boardY: first.y }); expect(removed.size).toBeGreaterThan(0);
  expect(await camera(page)).toEqual(view);
  await page.getByRole('button', { name: 'Undo remove from staging', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(saved); expect(await camera(page)).toEqual(view);
  await page.reload(); await page.getByRole('button', { name: 'Open sorting workspace', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(saved);
});

test('repeated desktop batches may overlap; they never move earlier cards, and a new card can be dragged away', async ({ page }) => {
  await seed(page); const view = await camera(page); let previous = await records(page);
  let latest: Awaited<ReturnType<typeof preview>> = [];
  for (let batch = 0; batch < 3; batch++) {
    latest = await preview(page); expect(await records(page)).toEqual(previous); await accept(page);
    const next = await records(page);
    for (const original of previous.filter(row => row.rootOnBoard)) expect(next.find(row => row.id === original.id)).toEqual(original);
    expect(await camera(page)).toEqual(view); previous = next;
  }
  const staged = previous.filter(row => row.rootOnBoard);
  expect(staged).toHaveLength(9);
  expect(staged.some((image, i) => staged.slice(0, i).some(other => Math.abs(image.boardX - other.boardX) < 172 && Math.abs(image.boardY - other.boardY) < 172))).toBe(true);
  const card = page.getByTestId('card-' + latest[0].id), box = (await card.boundingBox())!;
  await card.press('s'); await page.mouse.move(box.x + 80, box.y + 80); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y - 100, { steps: 15 }); await page.mouse.up(); await idle(page);
  await expect.poll(async () => (await records(page)).find(row => row.id === latest[0].id)?.boardY).not.toBe(previous.find(row => row.id === latest[0].id)!.boardY);
  await idle(page);
  const moved = await records(page); expect(moved.find(row => row.id === latest[0].id)).not.toEqual(previous.find(row => row.id === latest[0].id));
  for (const image of previous.filter(row => row.id !== latest[0].id)) expect(moved.find(row => row.id === image.id)).toEqual(image);
  expect(await camera(page)).toEqual(view);
});

test('quantity, refresh, Escape and exhaustion keep previews distinct and preserve the project until accepted', async ({ page }) => {
  await seed(page, 7); const before = await records(page); const first = await preview(page);
  await draft(page).getByRole('button', { name: 'Try other random images', exact: true }).press('Enter');
  await expect(draft(page).getByRole('button', { name: 'Try other random images', exact: true })).toBeFocused();
  const next = await previews(page).evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.suggestionPreview));
  expect(next).toHaveLength(3); expect(next.every(id => !first.some(item => item.id === id))).toBe(true);
  await draft(page).getByRole('combobox', { name: 'Number of preview images' }).selectOption('1'); await expect(previews(page)).toHaveCount(1);
  expect(await records(page)).toEqual(before); await page.keyboard.press('Escape'); await expect(previews(page)).toHaveCount(0); await expect(board(page).locator('.board-preview-frame')).toHaveCount(0); expect(await records(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Preview 1 random image', exact: true })).toBeFocused();
  await preview(page); await draft(page).getByRole('combobox', { name: 'Number of preview images' }).selectOption('7'); await expect(previews(page)).toHaveCount(7);
  await expect(draft(page).getByRole('button', { name: 'Try other random images', exact: true })).toBeDisabled(); await accept(page);
  await expect(page.getByRole('button', { name: 'No waiting images', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo add images', exact: true }).click(); await idle(page); expect(await records(page)).toEqual(before);
});

test('reduced motion accepts a preview without a deal animation or camera changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await seed(page, 6); const view = await camera(page); await preview(page); await observeLanding(page); await accept(page);
  expect(await page.evaluate(() => (window as any).previewLandings)).toEqual([]);
  await expect(board(page).locator('.card')).toHaveCount(3); expect(await camera(page)).toEqual(view);
  expect(await board(page).locator('.card__surface').evaluateAll(nodes => nodes.every(node => node.getAnimations().length === 0))).toBe(true);
});
