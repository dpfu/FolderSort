import { test as base, expect } from './fixtures';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webkit, type Browser, type BrowserContextOptions } from '@playwright/test';

export async function createStorageContext(browser: Browser, browserName: string, options: BrowserContextOptions) {
  const profile = browserName === 'webkit' ? await mkdtemp(join(tmpdir(), 'foldersort-webkit-')) : undefined;
  try {
    const context = profile ? await webkit.launchPersistentContext(profile, { ...options, headless: true }) : await browser.newContext(options);
    return { context, close: async () => {
      try { await context.close(); } finally { if (profile) await rm(profile, { recursive: true, force: true }); }
    } };
  } catch (cause) {
    if (profile) await rm(profile, { recursive: true, force: true });
    throw cause;
  }
}

// This WebKit automation build needs a persistent profile for readable IDB Blobs.
export const test = base.extend({
  context: async ({ browser, context, browserName, contextOptions, baseURL, viewport }, use) => {
    if (browserName !== 'webkit') { await use(context); return; }
    const storage = await createStorageContext(browser, browserName, { ...contextOptions, baseURL, viewport: viewport || undefined });
    try { await use(storage.context); } finally { await storage.close(); }
  },
});

export { expect };
