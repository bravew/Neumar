import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Eval cases share a single throwaway HOME so neuma's settings/db code points
// at a temp dir even when imported from inside a vitest worker. Side-effect
// import: relies on top-of-file ordering in case modules.
if (!process.env.HOME?.includes('neumar-eval-')) {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'neumar-eval-'));
}
