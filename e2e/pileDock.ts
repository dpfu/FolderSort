import type { Page } from '@playwright/test';

export async function openPileOptions(page: Page) {
  const options = page.locator('.pile-options');
  if (!await options.evaluate(element => (element as HTMLDetailsElement).open)) await options.locator('summary').click();
}

export async function choosePileOrder(page: Page, order: string) {
  await openPileOptions(page);
  await page.getByRole('combobox', { name: 'Pile order' }).selectOption(order);
}
