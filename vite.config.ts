import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5189,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5189,
    strictPort: true,
  },
  test: {
    setupFiles: ['./src/testSetup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // JSDOM hydration tests become CPU-bound with Vitest's machine-wide worker
    // default. Two isolated workers keep their IndexedDB state independent and
    // their 5 s interaction waits deterministic.
    minWorkers: 1,
    maxWorkers: 2,
  },
});
