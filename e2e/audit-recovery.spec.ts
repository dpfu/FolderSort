import { test, expect } from './fixtures';
import { openProjectActions, backToProject } from './menuBar';
import JSZip from 'jszip';
import fs from 'node:fs/promises';

test('a failed intake shows committed images, leaves no orphaned original, and keeps backup usable', async ({ page }) => {
  await page.goto('/');
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
  await openProjectActions(page);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Backup ZIP', exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.zip$/);
  await page.reload(); await expect(page.getByLabel('Project contents')).toContainText('1 images');
});

test('can save a first backup after the app goes offline', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'New project name' }).fill('Offline backup');
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Offline backup', exact: true })).toBeVisible();
  await context.setOffline(true);
  await openProjectActions(page);
  const downloading = page.waitForEvent('download', { timeout: 5000 });
  await page.getByRole('button', { name: 'Backup ZIP', exact: true }).click();
  expect((await downloading).suggestedFilename()).toBe('Offline-backup.zip');
});

test('keeps SVG backups compressed and preserves originals without network access', async ({ page, context }) => {
  await page.goto('/');
  const originals = await page.locator('input[accept="image/*"]').evaluate((input: HTMLInputElement) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><!--${'vector metadata '.repeat(25000)}--><rect width="24" height="24" fill="teal"/></svg>`;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 24;
    const png = canvas.toDataURL().split(',')[1], bytes = Uint8Array.from(atob(png), char => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([svg], 'vector.svg', { type: 'image/svg+xml' }));
    transfer.items.add(new File([bytes], 'raster.png', { type: 'image/png' }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    return { svg, png };
  });
  await expect(page.getByRole('main', { name: 'Sorting workspace' })).toBeVisible();
  await backToProject(page);
  // Block HTTP while allowing local Blob reads. WebKit's offline emulation
  // also breaks direct FileReader/arrayBuffer reads of persisted IDB blobs.
  await context.route(/^https?:\/\//, route => route.abort('internetdisconnected'));
  await openProjectActions(page);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Backup ZIP', exact: true }).click();
  const bytes = await fs.readFile(await (await downloading).path());
  const zip = await JSZip.loadAsync(bytes);
  const svg = Object.keys(zip.files).find(path => path.endsWith('/vector.svg'))!;
  const png = Object.keys(zip.files).find(path => path.endsWith('/raster.png'))!;
  expect(await zip.file(svg)!.async('string')).toBe(originals.svg);
  expect(await zip.file(png)!.async('base64')).toBe(originals.png);
  expect(bytes.length).toBeLessThan(originals.svg.length / 10);
});
