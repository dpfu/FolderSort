import { expect, type Page } from '@playwright/test';

/** Browser-focused checks explicitly open the panel; new projects start collapsed. */
export async function showImageBrowser(page: Page) {
  await expect(page.getByRole('region', { name: 'Image browser', exact: true })).toBeVisible();
  const show = page.getByRole('button', { name: 'Show image browser', exact: true }).first();
  if (await show.isVisible()) await show.click();
}

/** Some layout regressions deliberately begin with the whole unsorted collection. */
export async function addAllUnsortedToBoard(page: Page) {
  await showImageBrowser(page);
  const browser = page.getByRole('region', { name: 'Image browser', exact: true });
  await browser.getByRole('button', { name: /^Unsorted / }).click();
  await browserSelectAll(page);
  const add = browser.getByRole('button', { name: 'Add to staging', exact: true });
  if (await add.isVisible()) await add.click();
  await page.getByRole('button', { name: 'Deselect images', exact: true }).click();
  await browser.getByRole('button', { name: /^All / }).click();
  await expect(page.locator('.sorting-workspace__save-state')).toHaveText('Saved');
}

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
  const direct = page.locator('.workspace-fit');
  if (await direct.isVisible()) { await direct.click(); return; }
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
  await page.getByRole('group', { name: 'Image actions', exact: true }).getByRole('button', { name: /^Create folder(?: with [\d,]+ images?)?$/ }).click();
}
export async function navigateOverview(page: Page) {
  const navigation = page.getByRole('navigation', { name: 'Folder navigation' });
  const root = navigation.getByRole('button', { name: /^(Go to Staging|Back to Staging)$/ });
  if (await root.isVisible()) await root.click();
  else {
    await navigation.getByRole('button', { name: 'Choose folder', exact: true }).click();
    await navigation.getByRole('button', { name: 'Staging', exact: true }).click();
  }
}
export async function backToProject(page: Page) {
  const direct = page.locator('.workspace-project');
  if (await direct.isVisible()) await direct.click();
  else { await openBoardActions(page); await page.locator('.workspace-actions').getByRole('button', { name: 'Back to project', exact: true }).click(); }
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
  await showImageBrowser(page);
  const toggle = page.getByRole('button', { name: 'Filters & view', exact: true });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
export async function browserOptions(page: Page) { await openBrowserFilters(page); }
export async function moveReviewedImage(page: Page, stash: string | null) {
  await page.getByRole('button', { name: 'Move image to folder', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'Move to folder', exact: true });
  const button = stash === null ? chooser.getByRole('button', { name: /Staging Working board/ }) : chooser.locator('.stash-picker__list button').filter({ hasText: stash }).first();
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
  await showImageBrowser(page);
  await page.getByRole('region', { name: 'Browse project images' }).focus();
  await page.keyboard.press('ControlOrMeta+a');
}

/** Preview controls and acceptance are separate actions. */
export async function acceptSuggestionPreview(page: Page, method: 'clip' | 'color' = 'color') {
  const preview = page.getByRole('region', { name: 'Similar image suggestions', exact: true });
  await preview.getByRole('combobox', { name: 'Suggestion method', exact: true }).selectOption(method);
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await preview.getByRole('button', { name: /^Add \d+$/ }).click();
}

/** The random intake first opens a non-persistent board draft. */
export async function acceptRandomPreview(page: Page) {
  const preview = page.getByRole('region', { name: 'Random image previews', exact: true });
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: /^Add \d+$/ }).click();
  await expect(preview).toHaveCount(0);
}
