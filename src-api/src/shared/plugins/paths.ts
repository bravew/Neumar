/**
 * Resolution for the repo-shipped builtin plugin root (`plugins/builtin/`).
 *
 * Mirrors the design-mode catalog resolution in
 * `services/design-mode/catalogs.ts`: the build copies `plugins/builtin/` to
 * `src-api/dist/plugins/builtin/` and tauri.conf bundles it as a resource, so
 * production resolves through RESOURCES_DIR / the executable dir while dev
 * resolves relative to this source file.
 */

import { statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PluginPaths');

let resolvedBuiltinRoot: string | null = null;

/** Test-only: drop the memoized root so fixtures can re-resolve. */
export function resetBuiltinPluginRootCache(): void {
  resolvedBuiltinRoot = null;
}

export function resolveBuiltinPluginRoot(): string {
  if (resolvedBuiltinRoot) return resolvedBuiltinRoot;

  const candidates: string[] = [];
  const resourcesDir = process.env.RESOURCES_DIR;
  if (resourcesDir) {
    candidates.push(
      path.join(resourcesDir, '_up_', 'src-api', 'dist', 'plugins', 'builtin'),
      path.join(resourcesDir, 'plugins', 'builtin'),
    );
  }
  // Bundled binary: catalog copied next to the executable.
  const execDir = path.dirname(process.execPath);
  candidates.push(
    path.join(execDir, 'plugins', 'builtin'),
    path.join(execDir, 'dist', 'plugins', 'builtin'),
  );
  // Dev fallback: repo root relative to this source file
  // (src-api/src/shared/plugins → repo).
  try {
    candidates.push(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../..',
        'plugins',
        'builtin',
      ),
    );
  } catch {
    // import.meta.url not available in some snapshot fs contexts.
  }

  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) {
        resolvedBuiltinRoot = candidate;
        logger.info(`builtin plugin root: ${candidate}`);
        return candidate;
      }
    } catch {
      // try next
    }
  }

  const fallback = candidates[candidates.length - 1] ?? execDir;
  logger.warn(`builtin plugin root not found; using fallback: ${fallback}`);
  resolvedBuiltinRoot = fallback;
  return fallback;
}
