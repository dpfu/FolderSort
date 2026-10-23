import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { fitBoard } from './menuBar';

/** Compare the painted photo with the preview frame, including clipped edges. */
async function expectFullPhoto(preview: Locator) {
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => preview.evaluate(element => {
    const image = element.querySelector('img')!, frame = element.getBoundingClientRect(), box = image.getBoundingClientRect();
    const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const x = box.x + (box.width - width) / 2, y = box.y + (box.height - height) / 2;
    const expectedScale = Math.min(frame.width / image.naturalWidth, frame.height / image.naturalHeight);
    return Math.max(Math.abs(width - image.naturalWidth * expectedScale), Math.abs(height - image.naturalHeight * expectedScale),
      frame.left - x, frame.top - y, x + width - frame.right, y + height - frame.bottom);
  })).toBeLessThan(1);
}

async function importPhotos(page: Page) {
  await page.goto('/');
  await page.locator('input[accept="image/*"]').evaluate((input: HTMLInputElement) => {
    const transfer = new DataTransfer();
    for (const [name, width, height] of [['portrait', 720, 1280], ['landscape', 1280, 720]] as const) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ['#d85f69', '#d8c454', '#5aa2b7', '#72a67d'].forEach((color, index) => {
        ctx.fillStyle = color; ctx.fillRect(0, height * index / 4, width, height / 4);
      });
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 20; ctx.strokeRect(10, 10, width - 20, height - 20);
      const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), c => c.charCodeAt(0));
      transfer.items.add(new File([bytes], `${name}.png`, { type: 'image/png' }));
    }
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
}

test('mobile touch dragging keeps portrait and landscape photos complete across board and browser preview sizes', async ({ browser, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'CDP exercises native touch; WebKit uses the persistent-profile smoke check.');
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await context.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, route => route.abort());
  try {
    const page = await context.newPage(); await importPhotos(page); await fitBoard(page);
    const session = await context.newCDPSession(page);
    for (const name of ['portrait', 'landscape']) {
      await page.keyboard.press('Escape');
      const browser = page.getByRole('region', { name: 'Image browser', exact: true });
      await browser.getByRole('group', { name: `Card: ${name}.png. Current area: Image browser`, exact: true }).click();
      await expect(page.getByRole('button', { name: 'Show on board', exact: true })).toBeEnabled();
      const card = page.locator('.sorting-workspace__board').getByRole('group', { name: `Card: ${name}.png`, exact: true });
      await expect(card).toBeVisible(); await expect(card).not.toHaveAttribute('data-arriving');
      await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
      const before = (await card.boundingBox())!, board = (await page.getByRole('region', { name: 'Sorting board area' }).boundingBox())!, browserBox = (await browser.boundingBox())!;
      const from = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
      const move = async (to: { x: number; y: number }) => {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...to, id: 1 }] });
      };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
      await move({ x: from.x + 12, y: from.y + 8 });
      await move({ x: board.x + board.width / 2, y: board.y + board.height * .7 });
      const preview = page.locator('.sorting-workspace__drag-ghost');
      await expectFullPhoto(preview);
      await move({ x: browserBox.x + browserBox.width / 2, y: browserBox.y + browserBox.height * .6 });
      await expectFullPhoto(preview);
      await expect(preview).toContainText('Drop on a board or stash to move');
      await move(from); await expectFullPhoto(preview);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(preview).toHaveCount(0); await expect(card).toBeVisible();
      await expect.poll(async () => {
        const after = (await card.boundingBox())!;
        return Math.max(Math.abs(after.width - before.width), Math.abs(after.height - before.height));
      }).toBeLessThan(1);
    }
  } finally { await context.close(); }
});
