import { test as base, expect } from './fixtures';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webkit } from '@playwright/test';

// This WebKit automation build needs a persistent profile for readable IDB Blobs.
export const test = base.extend({
  context: async ({ context, browserName, contextOptions, baseURL, viewport }, use) => {
    if (browserName !== 'webkit') { await use(context); return; }
    const profile = await mkdtemp(join(tmpdir(), 'foldersort-webkit-'));
    const persistentContext = await webkit.launchPersistentContext(profile, { ...contextOptions, baseURL, viewport: viewport || undefined, headless: true });
    try { await use(persistentContext); } finally { await persistentContext.close(); await rm(profile, { recursive: true, force: true }); }
  },
});

export { expect };
