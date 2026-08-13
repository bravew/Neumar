import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import { createLogger } from '@/shared/utils/logger';
import {
  ensureBuiltinVideoEnginesRegistered,
  tryGetVideoEngine,
} from '@/shared/video/engines';

import {
  type TemplateMetadata,
  TemplateMetadataSchema,
} from './gallery-schema';
import { lintTemplateProvenance } from './provenance-lint';

// File-based template gallery loader (Phase 3 M1).
//
// Layout (per dev-doc/html-video/06-05/03-template-gallery-and-provenance.md):
//
//   <root>/<template-id>/
//     ├── template.video.yaml
//     ├── source/<entry>           (engine-native source)
//     ├── SKILL.md                 (optional companion)
//     ├── example.md               (optional example inputs)
//     └── preview.png              (optional poster)
//
// Two roots are scanned in priority order so users can override branded
// defaults without forking the brand tree:
//
//   1. User templates      <workDir>/.neuma/video-templates/<id>/
//   2. Branded defaults    branding/default/video-templates/<id>/
//
// Tolerance: a malformed YAML or schema failure on one template surfaces as
// an `issues[]` entry, not a thrown error — one bad folder must not hide the
// rest of the gallery from the agent (mirrors html-video's
// cli/src/studio-server.ts collection-of-issues pattern).
//
// Caching: TTL (5s default) combined with the root dir's mtime. The mtime
// check costs one fs.stat per root per call and gives instant freshness on
// writes without re-reading every file on every plan/preview/export hop.

const logger = createLogger('VideoTemplateGallery');

const METADATA_FILENAME = 'template.video.yaml';
const DEFAULT_TTL_MS = 5_000;
const TEMPLATE_ID_RE = /^[\w][\w.-]*$/;

export type GalleryRootKind = 'user' | 'branding';

/** Read a template's declared source entry, with a containment guard. */
export async function readTemplateSource(
  template: GalleryTemplate,
): Promise<string> {
  return fs.readFile(
    resolveTemplateAssetPath(template, template.metadata.source_entry),
    'utf8',
  );
}

/** Resolve a template-relative asset path, with a containment guard. */
export function resolveTemplateAssetPath(
  template: GalleryTemplate,
  relativePath: string,
): string {
  const templateDir = path.dirname(template.metadataPath);
  const resolvedDir = path.resolve(templateDir);
  const resolved = path.resolve(templateDir, relativePath);
  // Defence in depth: never escape the template folder via a crafted path.
  if (
    resolved !== resolvedDir &&
    !resolved.startsWith(resolvedDir + path.sep)
  ) {
    throw new Error('template asset path escapes the template directory');
  }
  return resolved;
}

export interface GalleryTemplate {
  id: string;
  rootKind: GalleryRootKind;
  rootDir: string;
  metadataPath: string;
  metadata: TemplateMetadata;
  /** Issues from the provenance lint, surfaced but non-blocking. */
  warnings: string[];
}

export interface GalleryIssue {
  rootDir: string;
  /** May be the folder name when the YAML couldn't be read. */
  templateId: string;
  code:
    | 'unsafe-template-id'
    | 'symlinked-template'
    | 'missing-metadata-file'
    | 'yaml-parse-failed'
    | 'schema-validation-failed'
    | 'unknown-engine'
    | 'provenance-lint-failed';
  message: string;
}

export interface GalleryScanResult {
  templates: GalleryTemplate[];
  issues: GalleryIssue[];
  /** Wall-clock ms of the last *uncached* scan. Useful for slow-disk telemetry. */
  scanMs?: number;
}

interface CacheEntry {
  result: GalleryScanResult;
  cachedAt: number;
  /** ms-precision mtime of the root dir at scan time. */
  rootMtimeMs: number;
}

const cache = new Map<string, CacheEntry>();

export interface ScanOptions {
  /** Override the TTL in ms. Cache is bypassed when 0. */
  ttlMs?: number;
}

/**
 * Discover, parse, and validate the templates under a single root directory.
 * Returns `{ templates: [], issues: [] }` for a missing root (a brand-default
 * tree on a host that has never run brand-sync is a legitimate empty state,
 * not an error).
 */
export async function scanTemplateRoot(
  rootDir: string,
  rootKind: GalleryRootKind,
  options: ScanOptions = {},
): Promise<GalleryScanResult> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const cacheKey = `${rootKind}:${rootDir}`;

  if (ttlMs > 0) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < ttlMs) {
      // mtime check: even within the TTL, bust the cache if the root dir
      // changed (a `cp -R` of a new template should be visible on the next
      // read, not five seconds from now).
      const live = await rootMtime(rootDir);
      if (live === cached.rootMtimeMs) return cached.result;
    }
  }

  const start = Date.now();
  const issues: GalleryIssue[] = [];
  const templates: GalleryTemplate[] = [];

  // Read the root mtime BEFORE the directory scan. A write that lands between
  // readdir and the mtime sample would otherwise be hidden until TTL expiry:
  // the cache would record the post-write mtime against the pre-write result
  // and the next reader sees `live === cached` so the new template stays
  // invisible. Sampling first means a concurrent add advances the live mtime
  // past the cached one and busts on the very next read.
  const preScanMtimeMs = await rootMtime(rootDir);

  let entries: string[];
  try {
    entries = await fs.readdir(rootDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const empty: GalleryScanResult = {
        templates: [],
        issues: [],
        scanMs: Date.now() - start,
      };
      if (ttlMs > 0) {
        cache.set(cacheKey, {
          result: empty,
          cachedAt: Date.now(),
          rootMtimeMs: -1,
        });
      }
      return empty;
    }
    throw err;
  }

  for (const entry of entries.sort()) {
    if (entry.startsWith('.')) continue;
    const folderPath = path.join(rootDir, entry);
    // lstat (not stat) so symlinks are surfaced rather than followed. A
    // symlink with a slug-safe name and a target outside the workspace would
    // otherwise act as a confused-deputy path-traversal vector — the YAML
    // schema would still validate the upstream metadata but the loader would
    // be reading bytes from outside the template root by design.
    let stat;
    try {
      stat = await fs.lstat(folderPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      issues.push({
        rootDir,
        templateId: entry,
        code: 'symlinked-template',
        message: `"${entry}" is a symlink; symlinked template folders are not loaded`,
      });
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (!TEMPLATE_ID_RE.test(entry)) {
      issues.push({
        rootDir,
        templateId: entry,
        code: 'unsafe-template-id',
        message: `Folder "${entry}" is not a slug-safe template id`,
      });
      continue;
    }

    const metadataPath = path.join(folderPath, METADATA_FILENAME);
    let raw: string;
    try {
      raw = await fs.readFile(metadataPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        issues.push({
          rootDir,
          templateId: entry,
          code: 'missing-metadata-file',
          message: `${METADATA_FILENAME} not found in ${folderPath}`,
        });
      } else {
        issues.push({
          rootDir,
          templateId: entry,
          code: 'yaml-parse-failed',
          message: `Failed to read ${metadataPath}: ${(err as Error).message}`,
        });
      }
      continue;
    }

    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      issues.push({
        rootDir,
        templateId: entry,
        code: 'yaml-parse-failed',
        message: `YAML parse failed for ${entry}: ${(err as Error).message}`,
      });
      continue;
    }

    const validation = TemplateMetadataSchema.safeParse(parsed);
    if (!validation.success) {
      issues.push({
        rootDir,
        templateId: entry,
        code: 'schema-validation-failed',
        message: `Schema validation failed for ${entry}: ${validation.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      });
      continue;
    }
    const metadata = validation.data;

    // Folder id must match the metadata id so paths stay deterministic.
    if (metadata.id !== entry) {
      issues.push({
        rootDir,
        templateId: entry,
        code: 'schema-validation-failed',
        message: `metadata.id "${metadata.id}" does not match folder name "${entry}"`,
      });
      continue;
    }

    // Engine binding: the template declares an engine; the engine must be
    // registered. Cross-Phase Principle 3 forbids silent fallback, so a
    // missing engine surfaces here and the gallery omits the template.
    if (!tryGetVideoEngine(metadata.engine)) {
      issues.push({
        rootDir,
        templateId: entry,
        code: 'unknown-engine',
        message: `Template "${entry}" declares engine "${metadata.engine}" which is not registered`,
      });
      continue;
    }

    // Provenance lint is advisory in the loader — surface as warnings.
    const lint = lintTemplateProvenance(metadata);
    const warnings: string[] = [];
    for (const issue of lint.issues) {
      if (issue.severity === 'error') {
        issues.push({
          rootDir,
          templateId: entry,
          code: 'provenance-lint-failed',
          message: issue.message,
        });
      } else {
        warnings.push(issue.message);
      }
    }
    if (!lint.ok) continue;

    templates.push({
      id: entry,
      rootKind,
      rootDir,
      metadataPath,
      metadata,
      warnings,
    });
  }

  const result: GalleryScanResult = {
    templates,
    issues,
    scanMs: Date.now() - start,
  };

  if (ttlMs > 0) {
    cache.set(cacheKey, {
      result,
      cachedAt: Date.now(),
      rootMtimeMs: preScanMtimeMs,
    });
  }

  if (issues.length > 0) {
    logger.warn(
      `Scanned ${rootKind} template root ${rootDir} with ${issues.length} issue(s)`,
    );
  }

  return result;
}

/**
 * Scan a pair of roots and merge them. User templates win on id collisions
 * (the override use case). Issues from both roots are returned together so
 * the agent gets a single round-trip of feedback.
 */
export async function loadTemplateGallery(opts: {
  userRoot: string;
  brandingRoot: string;
  ttlMs?: number;
}): Promise<GalleryScanResult> {
  // Ensure the built-in engines are registered before the per-template engine
  // validation runs — otherwise a gallery load on a fresh process (before any
  // render or engine-list call) rejects every `html` template as
  // `unknown-engine`. Idempotent + synchronous, so it must run before the
  // scans populate the TTL cache.
  ensureBuiltinVideoEnginesRegistered();
  const [userScan, brandingScan] = await Promise.all([
    scanTemplateRoot(opts.userRoot, 'user', { ttlMs: opts.ttlMs }),
    scanTemplateRoot(opts.brandingRoot, 'branding', { ttlMs: opts.ttlMs }),
  ]);

  const byId = new Map<string, GalleryTemplate>();
  for (const t of brandingScan.templates) byId.set(t.id, t);
  for (const t of userScan.templates) byId.set(t.id, t); // user wins

  return {
    templates: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    issues: [...userScan.issues, ...brandingScan.issues],
    scanMs: Math.max(userScan.scanMs ?? 0, brandingScan.scanMs ?? 0),
  };
}

async function rootMtime(rootDir: string): Promise<number> {
  try {
    const stat = await fs.stat(rootDir);
    return stat.mtimeMs;
  } catch {
    return -1;
  }
}

/** Test-only. Flush the in-memory TTL cache. */
export function _resetTemplateGalleryCache(): void {
  cache.clear();
}

// -----------------------------------------------------------------------------
// Shared default-root resolution (used by the queue prepass + MCP tools).
// -----------------------------------------------------------------------------

/**
 * Resolve the standard user + branding template roots for the running API.
 *
 * - User root: `<workspaceRoot>/.neuma/video-templates/`
 * - Branding root: walks up from this module's filesystem location to the
 *   repo root and points at `branding/default/video-templates/`. Works for
 *   the `pnpm dev:api` runtime. For the packaged Tauri sidecar a custom
 *   resolver should be passed by the caller — see SPIKE-REPORT.
 *
 * Throws if the branding root does not exist on disk (typical Tauri-sidecar
 * symptom) so callers see a typed error rather than a silent miss.
 */
export function resolveDefaultTemplateGalleryRoots(workspaceRoot: string): {
  userRoot: string;
  brandingRoot: string;
} {
  const here = fileURLToPath(import.meta.url);
  // <repo>/src-api/src/shared/video/templates/gallery-loader.ts
  //                                 ^^^^^^^^^^^^^^^^^^^^^^^^^
  // Walk up six levels: gallery-loader.ts → templates → video → shared →
  // src → src-api → <repo>.
  const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
  const brandingRoot = path.join(
    repoRoot,
    'branding',
    'default',
    'video-templates',
  );
  // existsSync is intentional: this function is synchronous and called once
  // per render trigger or MCP-tool invocation. The single stat call is
  // negligible vs the eventual Playwright + ffmpeg work that follows, and
  // making it async would force every caller (queue-prepass, MCP tools)
  // through an extra `await` for no observable latency benefit.
  if (!existsSync(brandingRoot)) {
    throw new Error(
      `resolveDefaultTemplateGalleryRoots: branding root "${brandingRoot}" does not exist. ` +
        'For packaged Tauri-sidecar builds, the caller should pass an explicit ' +
        'brandingRoot to loadTemplateGallery() instead. ' +
        'See dev-doc/html-video/06-05/SPIKE-REPORT.md § Tauri sidecar packaging.',
    );
  }
  return {
    userRoot: path.join(workspaceRoot, '.neuma', 'video-templates'),
    brandingRoot,
  };
}
