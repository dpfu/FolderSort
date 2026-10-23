import { expect, type Page } from '@playwright/test';

export async function openBoardActions(page: Page, section?: string) {
  const menu = page.locator('.workspace-actions');
  if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').click();
  const back = menu.getByRole('button', { name: 'Back to board actions', exact: true });
  if (await back.isVisible()) await back.click();
  if (section) await menu.getByRole('button', { name: section, exact: true }).click();
}
export async function openWorkspaceExport(page: Page) {
  if (!await page.locator('.workspace-actions').count()) return openProjectActions(page);
  const direct = page.locator('.workspace-export');
  if (await direct.isVisible()) { if (!await direct.evaluate(element => (element as HTMLDetailsElement).open)) await direct.locator('summary').click(); }
  else await openBoardActions(page, 'Export project');
}
export async function openBoardTools(page: Page) { await openBoardActions(page, 'Find similar to board'); }
export async function zoomBoard(page: Page, direction: 'in' | 'out') {
  const zoom = page.locator('.workspace-zoom-menu');
  if (await zoom.isVisible()) {
    if (!await zoom.evaluate(element => (element as HTMLDetailsElement).open)) await zoom.locator('summary').click();
    await zoom.getByRole('button', { name: `Zoom ${direction}`, exact: true }).click();
    await page.keyboard.press('Escape'); return;
  }
  await openBoardActions(page, 'Board view');
  await page.getByRole('button', { name: `Zoom ${direction}`, exact: true }).click();
}
export async function fitBoard(page: Page) {
  const zoom = page.locator('.workspace-zoom-menu');
  if (await zoom.isVisible()) {
    if (!await zoom.evaluate(element => (element as HTMLDetailsElement).open)) await zoom.locator('summary').click();
    await zoom.getByRole('button', { name: 'Fit board', exact: true }).click();
  } else {
    await openBoardActions(page, 'Board view');
    await page.getByRole('button', { name: 'Fit board', exact: true }).click();
  }
}
export async function createBoardStash(page: Page) {
  await page.getByRole('group', { name: 'Image actions', exact: true }).getByRole('button', { name: /^(Create stash|Stash [\d,]+ images?)$/ }).click();
}
export async function navigateOverview(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'Stash navigation' });
  const root = navigation.getByRole('button', { name: /^(Go to overview|Back to overview)$/ });
  if (await root.isVisible()) await root.click();
  else {
    await navigation.getByRole('button', { name: 'Choose stash', exact: true }).click();
    await navigation.getByRole('button', { name: 'Board overview', exact: true }).click();
  }
}
export async function backToProject(page: Page) {
  const direct = page.locator('.app-bar__leading').getByRole('button', { name: 'Back to project', exact: true });
  if (await direct.isVisible()) await direct.click();
  else { await openBoardActions(page); await page.getByRole('button', { name: 'Back to project', exact: true }).click(); }
}
export async function openProjectActions(page: Page) {
  const menu = page.locator('.project-export');
  if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').click();
}
export async function openProjectStashes(page: Page) {
  const menu = page.locator('.project-stashes');
  if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').first().click();
}
export async function openBrowserFilters(page: Page) {
  const toggle = page.getByRole('button', { name: 'Filters & view', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
export async function browserOptions(page: Page) { await openBrowserFilters(page); }
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
  await page.locator('.image-browser .card').first().dblclick();
}
export async function closeProjectImage(page: Page) {
  await page.getByRole('button', { name: 'Close image' }).click();
  await page.getByRole('button', { name: 'Return to sorting board' }).click();
  await backToProject(page);
}
export async function hideBrowserFilters(page: Page) {
  const toggle = page.getByRole('button', { name: 'Filters & view', exact: true });
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
}
export async function browserImageSize(page: Page, size: number) {
  await openBrowserFilters(page);
  await page.getByRole('slider', { name: 'Browser thumbnail size' }).fill(String(size));
  await hideBrowserFilters(page);
}
export async function browserSelectAll(page: Page) {
  await page.getByRole('region', { name: 'Browse project images' }).focus();
  await page.keyboard.press('ControlOrMeta+a');
}
