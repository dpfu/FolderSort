import type { Page } from '@playwright/test';
import { showImageBrowser } from './menuBar';

export async function openPileOptions(page: Page) {
  await showImageBrowser(page);
  const options = page.getByRole('button', { name: 'Filters & view' });
  if (await options.getAttribute('aria-expanded') !== 'true') await options.click();
}

export async function choosePileOrder(page: Page, order: string) {
  await showImageBrowser(page);
  await page.getByRole('combobox', { name: 'Image browser order' }).selectOption(order);
}

/** Add a Staging batch or move browser images into the current stash. */
export async function addBrowserImages(page: Page, count: number) {
  await showImageBrowser(page);
  await page.keyboard.press('Escape');
  const candidates = page.locator('.image-browser .card:not(:has(+ .image-browser__on-board))');
  const items = await candidates.all();
  if (!items.length) return;
  for (let index = 0; index < Math.min(count, items.length); index++) await items[index].click(index ? { modifiers: ['Shift'] } : {});
  await page.locator('.image-browser__footer').getByRole('button', { name: /^(Move to .+|Add to staging)$/ }).click();
  await page.getByRole('group', { name: 'Image actions', exact: true }).getByRole('button', { name: 'Deselect images', exact: true }).click();
}
