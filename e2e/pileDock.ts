import type { Page } from '@playwright/test';

export async function openPileOptions(page: Page) {
  const options = page.getByRole('button', { name: 'Filters & view' });
  if (await options.getAttribute('aria-expanded') !== 'true') await options.click();
}

export async function choosePileOrder(page: Page, order: string) {
  await page.getByRole('combobox', { name: 'Image browser order' }).selectOption(order);
}

/** Select actual browser images, then add the selected batch. */
export async function addBrowserImages(page: Page, count: number) {
  await page.keyboard.press('Escape');
  const candidates = page.locator('.image-browser .card:not(:has(+ .image-browser__on-board))');
  const items = await candidates.all();
  for (let index = 0; index < Math.min(count, items.length); index++) await items[index].click(index ? { modifiers: ['Shift'] } : {});
  await page.getByRole('button', { name: 'Add to board', exact: true }).click();
  // General fixtures start with a clean selection; intake retention has its own workflow check.
  await page.getByRole('group', { name: 'Image actions', exact: true }).getByRole('button', { name: 'Deselect images', exact: true }).click();
}
