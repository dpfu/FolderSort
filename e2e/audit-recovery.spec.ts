import { test, expect } from './fixtures';
import { openProjectActions } from './menuBar';

test('a failed intake shows committed images, leaves no orphaned original, and loads ZIP code only on export', async ({ page }) => {
  await page.goto('/');
  const archiveRequests = () => page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /projectArchive-/.test(name)));
  expect(await archiveRequests()).toEqual([]);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let failed = false;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'images' && value.path === 'two.png' && !failed) { failed = true; throw new DOMException('Test storage full', 'QuotaExceededError'); }
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.locator('input[accept="image/*"]').evaluate((input: HTMLInputElement) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), char => char.charCodeAt(0));
    const transfer = new DataTransfer();
    for (const name of ['one.png', 'two.png', 'three.png']) transfer.items.add(new File([bytes], name, { type: 'image/png' }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByRole('alert')).toContainText('Test storage full');
  await expect(page.getByLabel('Project contents')).toContainText('1 images');
  const assets = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('sortboard-image-library-minimal', 2); request.onsuccess = () => resolve(request.result); });
    const keys = await new Promise<IDBValidKey[]>(resolve => { const request = db.transaction('assets').objectStore('assets').getAllKeys(); request.onsuccess = () => resolve(request.result); });
    db.close(); return keys;
  });
  expect(assets).toHaveLength(1);
  expect(await archiveRequests()).toEqual([]);
  await openProjectActions(page);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Backup ZIP', exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.zip$/);
  expect((await archiveRequests()).length).toBeGreaterThan(0);
  await page.reload(); await expect(page.getByLabel('Project contents')).toContainText('1 images');
});
