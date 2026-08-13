import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vitest/config';

import fs from 'fs';
import path from 'path';

const branding = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'branding.json'), 'utf-8'),
);
const buildDate = new Date().toISOString().slice(0, 10).replace(/-/g, '.');

export default defineConfig({
  plugins: [react(), svgr({ include: '**/*.svg?react' })],
  define: {
    __BRANDING__: JSON.stringify(branding),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    pool: 'forks',
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/__tests__/**', 'src/**/*.d.ts'],
      // Floor thresholds — keep these low/conservative initially so CI does
      // not flake on small drift. Tighten once test coverage stabilizes.
      thresholds: {
        lines: 5,
        statements: 5,
        functions: 5,
        branches: 50,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
