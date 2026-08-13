import path from 'path';

import { defineConfig } from 'vitest/config';

const isCI = !!process.env.CI;

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globalSetup: ['test/global-setup.ts'],
    pool: 'forks',
    maxWorkers: isCI ? 3 : 8,
    unstubEnvs: true,
    unstubGlobals: true,
    setupFiles: ['test/setup.ts'],
    include: [
      'test/unit/**/*.test.ts',
      'test/integration/**/*.test.ts',
      'test/evals/**/*.eval.ts',
    ],
    exclude: ['**/*.e2e.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 55,
        statements: 70,
      },
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
