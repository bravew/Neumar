#!/usr/bin/env node

/**
 * Sync the generated official plugin registry into src-site so the website can
 * serve it as a read-only marketplace catalog
 * (dev-doc/plan/07-04-plugin-system checkpoint 6).
 *
 *   plugins/registry/official/marketplace.json
 *     → src-site/apps/web/app/api/v1/marketplace/official-marketplace.json
 *
 * Run after scripts/generate-plugin-registry.mjs. `--check` fails when the
 * synced copy has drifted from the source registry.
 */

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(
  repoRoot,
  'plugins/registry/official/marketplace.json',
);
const DEST = path.join(
  repoRoot,
  'src-site/apps/web/app/api/v1/marketplace/official-marketplace.json',
);
const destDir = path.dirname(DEST);

if (!existsSync(SOURCE)) {
  console.error(
    '[sync-registry] source registry missing — run: node scripts/generate-plugin-registry.mjs',
  );
  process.exit(1);
}

if (!existsSync(destDir)) {
  console.warn(
    '[sync-registry] skipped — src-site marketplace directory absent',
  );
  process.exit(0);
}

if (process.argv[2] === '--check') {
  if (!existsSync(DEST)) {
    console.error('[sync-registry] site copy missing — run without --check');
    process.exit(1);
  }
  if (readFileSync(SOURCE, 'utf-8') !== readFileSync(DEST, 'utf-8')) {
    console.error(
      '[sync-registry] site copy is stale — run: node scripts/sync-plugin-registry-to-site.mjs',
    );
    process.exit(1);
  }
  console.log('[sync-registry] OK — site copy matches the source registry');
} else {
  copyFileSync(SOURCE, DEST);
  console.log(
    `[sync-registry] copied registry to ${path.relative(repoRoot, DEST)}`,
  );
}
