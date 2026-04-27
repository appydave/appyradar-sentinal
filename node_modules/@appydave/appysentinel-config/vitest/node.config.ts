import { defineConfig } from 'vitest/config';

/**
 * Vitest config for headless Node/Bun Sentinel projects.
 *
 * No DOM, no jsdom — Sentinels run in Node-like environments.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
