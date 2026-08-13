import path from 'path';

import { defineConfig } from 'vitest/config';

const isCI = !!process.env.CI;
const e2eWorkers = process.env.NEUMAR_E2E_WORKERS
  ? parseInt(process.env.NEUMAR_E2E_WORKERS, 10)
  : isCI
    ? 2
    : 4;
const verboseE2E = !!process.env.NEUMAR_E2E_VERBOSE;

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    testTimeout: 120_000,
    hookTimeout: 60_000,
    globalSetup: ['test/global-setup.ts'],
    pool: 'vmForks',
    maxWorkers: e2eWorkers,
    setupFiles: ['test/setup.ts'],
    include: ['test/e2e/**/*.e2e.test.ts'],
    silent: !verboseE2E,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
