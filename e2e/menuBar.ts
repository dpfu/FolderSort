import { expect, type Page } from '@playwright/test';

export async function openBoardActions(page: Page, section?: string) {
  const menu = page.locator('.workspace-actions');
  if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').click();
  const back = menu.getByRole('button', { name: 'Back to board actions', exact: true });
  if (await back.isVisible()) await back.click();
  if (section) await menu.getByRole('button', { name: section, exact: true }).click();
}
export async function openWorkspaceExport(page: Page) { if (await page.locator('.workspace-actions').count()) await openBoardActions(page, 'Export project'); else await openProjectActions(page); }
export async function openBoardTools(page: Page) { await openBoardActions(page, 'Find similar to board'); }
export async function zoomBoard(page: Page, direction: 'in' | 'out') {
  await openBoardActions(page, 'Board view');
  await page.getByRole('button', { name: `Zoom ${direction}`, exact: true }).click();
}
export async function createBoardStash(page: Page) {
  if (!await page.getByRole('button', { name: 'Create stash', exact: true }).isVisible()) await openBoardActions(page);
  await page.getByRole('button', { name: 'Create stash', exact: true }).click();
}
export async function navigateOverview(page: Page) {
  await page.getByRole('button', { name: 'Choose stash', exact: true }).click();
  await page.getByRole('navigation', { name: 'Stash navigation' }).getByRole('button', { name: 'Overview', exact: true }).click();
}
export async function backToProject(page: Page) {
  const direct = page.locator('.app-bar__leading').getByRole('button', { name: 'Back to project', exact: true });
  if (await direct.isVisible()) await direct.click();
  else { await openBoardActions(page); await page.getByRole('button', { name: 'Back to project', exact: true }).click(); }
}
export async function openProjectActions(page: Page) {
  const menu = page.locator('.project-actions');
  if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').click();
}
export async function openProjectStashes(page: Page) {
  const menu = page.locator('.project-stashes');
  if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').first().click();
}
export async function openBrowserFilters(page: Page) {
  const browser = page.getByRole('dialog', { name: 'Explore image pile', exact: true });
  if (!await browser.getByRole('searchbox', { name: 'Find images' }).isVisible()) {
    await browser.getByRole('button', { name: 'Image browser options' }).click();
    await browser.getByRole('button', { name: 'Filter and order', exact: true }).click();
  }
}
export async function browserOptions(page: Page) {
  const menu = page.getByRole('dialog', { name: 'Explore image pile', exact: true }).locator('.action-menu');
  if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').click();
}
export async function moveReviewedImage(page: Page, stash: string | null) {
  await page.getByRole('button', { name: 'Move image to stash', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'Move to stash', exact: true });
  const button = stash === null ? chooser.getByRole('button', { name: /Unsorted/ }) : chooser.locator('.stash-picker__list button').filter({ hasText: stash }).first();
  await button.click(); await expect(chooser).toHaveCount(0);
}

export async function openProjectImage(page: Page, path: string) {
  await page.getByRole('button', { name: 'Explore project images' }).click();
  await openBrowserFilters(page);
  await page.getByRole('searchbox', { name: 'Find images' }).fill(path);
  await page.getByRole('button', { name: `View ${path.split('/').at(-1)}`, exact: true }).first().click();
}
export async function closeProjectImage(page: Page) {
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page.getByRole('button', { name: 'Back to sorting board' }).click();
  await backToProject(page);
}
export async function hideBrowserFilters(page: Page) {
  await browserOptions(page);
  await page.getByRole('button', { name: 'Hide filters', exact: true }).click();
}
export async function browserImageSize(page: Page, size: number) {
  await browserOptions(page);
  await page.getByRole('slider', { name: 'Overview image size' }).fill(String(size));
  await page.keyboard.press('Escape');
}
export async function browserSelectAll(page: Page) {
  await browserOptions(page); await page.getByRole('button', { name: 'Select all', exact: true }).click();
}
