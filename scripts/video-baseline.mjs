#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const skipBrowser = process.argv.includes('--skip-browser');

const commands = [
  ['node', ['scripts/video-acceptance.mjs', '--fixture', 'parity', '--json']],
  [
    'node',
    ['scripts/video-acceptance.mjs', '--fixture', 'long-render', '--json'],
  ],
  [
    'node',
    [
      'scripts/video-timeline-benchmark.mjs',
      '--clips',
      '1000',
      '--tracks',
      '12',
      '--json',
    ],
  ],
];

if (!skipBrowser) {
  commands.push([
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      'tests/e2e/specs/video-mode.spec.ts',
      '--grep',
      'idle video tabs',
    ],
  ]);
}

for (const [command, args] of commands) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, NO_COLOR: '1' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
