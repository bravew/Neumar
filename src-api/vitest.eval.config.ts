import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['test/evals/**/*.eval.ts'],
      pool: 'forks',
      coverage: {
        provider: 'v8',
        thresholds: {
          lines: 80,
          functions: 75,
          branches: 70,
          statements: 80,
        },
        include: ['src/core/agent/**/*.ts', 'src/shared/observability/**/*.ts'],
      },
    },
  }),
);
