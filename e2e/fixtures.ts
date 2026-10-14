import { test as base, expect } from '@playwright/test';

/** No model downloads in UI tests. CLIP-specific tests replace inference only. */
export const test = base.extend<{ blockModelDownloads: void }>({
  blockModelDownloads: [async ({ context }, use) => {
    await context.route(/https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, route => route.abort());
    await use();
  }, { auto: true }],
});
export { expect };
