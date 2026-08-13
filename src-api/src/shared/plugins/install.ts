/**
 * Shared plugin install pipeline — copy a validated plugin tree into an
 * install root, hash it, verify its signature, and record the install with
 * provenance (dev-doc/plan/07-04-plugin-system checkpoint 4).
 *
 * Used by the local-path install route and the github/url remote installer;
 * both funnel through {@link installPluginFromDir} so caps, hashing, and
 * provenance stamping stay in one place.
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import { join } from 'path';

import { getAppDir } from '@/config/constants';

import type { MarketplaceSourceTrust } from '@/shared/db/marketplace-sources';
import { getSetting } from '@/shared/db/operations';
import {
  upsertInstalledPlugin,
  type InstalledPlugin,
  type PluginSource,
} from '@/shared/db/plugins';
import type { TrustTier } from '@/shared/plugins/runtime';

import { parseManifest, readManifestFile } from './manifest';
import { verifyManifestSignature } from './verify';

/** Per-install caps. A legitimate plugin tree fits comfortably; larger inputs
 *  are almost certainly an attempt to exhaust memory or fill the install dir. */
export const INSTALL_MAX_FILES = 5_000;
export const INSTALL_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const INSTALL_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export class PluginInstallError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
    readonly issues?: string[],
  ) {
    super(message);
    this.name = 'PluginInstallError';
  }
}

export interface InstallProvenance {
  sourceMarketplaceId: string;
  sourceEntryName: string;
  sourceEntryVersion: string | null;
  /** Trust of the SOURCE row at install time — never taken from a catalog. */
  marketplaceTrust: MarketplaceSourceTrust;
}

export interface InstallPluginFromDirInput {
  scope: 'project' | 'user';
  source: PluginSource;
  sourceRef: string;
  provenance?: InstallProvenance;
}

function trustTierForSource(
  source: PluginSource,
  provenance?: InstallProvenance,
): TrustTier {
  if (provenance) return 'marketplace';
  switch (source) {
    case 'github':
      return 'github';
    case 'url':
      return 'url';
    default:
      return 'local';
  }
}

/**
 * Install the plugin at `sourceDir` (already vetted by the caller) into the
 * scope's install root. Throws {@link PluginInstallError} with an HTTP-ish
 * status on every failure path; rolls back half-written installs.
 */
export async function installPluginFromDir(
  sourceDir: string,
  input: InstallPluginFromDirInput,
): Promise<InstalledPlugin> {
  const manifestFile = await readManifestFile(sourceDir);
  if (!manifestFile) {
    throw new PluginInstallError(
      'no .claude-plugin/plugin.json (or codex/cursor variant) found in source',
    );
  }
  const parseResult = parseManifest(manifestFile.raw);
  if (!parseResult.ok || !parseResult.manifest) {
    throw new PluginInstallError('invalid manifest', 400, parseResult.issues);
  }
  const manifest = parseResult.manifest;

  let installRoot: string;
  if (input.scope === 'project') {
    const workDir = getSetting('workDir');
    if (!workDir) {
      throw new PluginInstallError(
        'workspace directory is not configured — set one in Settings before installing project-scoped plugins',
      );
    }
    installRoot = join(workDir, '.plugins');
  } else {
    installRoot = join(getAppDir(), 'plugins');
  }
  await fs.mkdir(installRoot, { recursive: true });
  const installPath = join(installRoot, manifest.name);

  try {
    // mkdir without recursive surfaces EEXIST atomically — no TOCTOU.
    await fs.mkdir(installPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new PluginInstallError(
        `Plugin '${manifest.name}' already installed at ${installPath}`,
        409,
      );
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PluginInstallError('source path does not exist', 404);
    }
    throw err;
  }

  let sha256: string;
  try {
    sha256 = await copyAndHash(sourceDir, installPath);
  } catch (err) {
    // Roll back the half-written install dir so a retry isn't blocked by 409.
    await fs.rm(installPath, { recursive: true, force: true });
    throw new PluginInstallError((err as Error).message);
  }

  const verifyResult = await verifyManifestSignature(manifest);

  return upsertInstalledPlugin({
    id: `${input.scope}/${manifest.name}`,
    name: manifest.name,
    version: manifest.version,
    source: input.source,
    sourceRef: input.sourceRef,
    installPath,
    scope: input.scope,
    enabled: true,
    manifest,
    sha256,
    signatureOk: verifyResult.signatureOk,
    trustTier: trustTierForSource(input.source, input.provenance),
    sourceMarketplaceId: input.provenance?.sourceMarketplaceId ?? null,
    sourceEntryName: input.provenance?.sourceEntryName ?? null,
    sourceEntryVersion: input.provenance?.sourceEntryVersion ?? null,
    marketplaceTrust: input.provenance?.marketplaceTrust ?? null,
  });
}

/**
 * Recursive tree copy that hashes every file as it streams through. Single
 * I/O pass per file; deterministic hash via sorted directory entries.
 * Symlinks intentionally skipped — refuse to chase them across the install
 * boundary. Bounded by INSTALL_MAX_* caps to keep a hostile manifest from
 * exhausting memory or filling the install root.
 */
export async function copyAndHash(src: string, dest: string): Promise<string> {
  const hash = createHash('sha256');
  const counters = { fileCount: 0, totalBytes: 0 };
  await walk(src, dest, '', hash, counters);
  return hash.digest('hex');
}

async function walk(
  srcRoot: string,
  destRoot: string,
  rel: string,
  hash: ReturnType<typeof createHash>,
  counters: { fileCount: number; totalBytes: number },
): Promise<void> {
  const here = rel ? join(srcRoot, rel) : srcRoot;
  const entries = await fs.readdir(here, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const files: string[] = [];
  const dirs: string[] = [];
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      dirs.push(childRel);
      hash.update(`D:${childRel}\n`);
    } else if (entry.isFile()) {
      files.push(childRel);
    }
  }

  for (const d of dirs) {
    await fs.mkdir(join(destRoot, d), { recursive: true });
  }
  // Sequential so hash.update() runs in sorted order — Promise.all would
  // interleave the updates in I/O-completion order and yield non-deterministic
  // digests for the same on-disk tree.
  for (const f of files) {
    const srcPath = join(srcRoot, f);
    const stat = await fs.stat(srcPath);
    if (stat.size > INSTALL_MAX_FILE_BYTES) {
      throw new Error(
        `file ${f} exceeds per-file limit (${stat.size} > ${INSTALL_MAX_FILE_BYTES})`,
      );
    }
    counters.fileCount += 1;
    counters.totalBytes += stat.size;
    if (counters.fileCount > INSTALL_MAX_FILES) {
      throw new Error(`plugin exceeds file-count limit (${INSTALL_MAX_FILES})`);
    }
    if (counters.totalBytes > INSTALL_MAX_TOTAL_BYTES) {
      throw new Error(
        `plugin exceeds total-size limit (${INSTALL_MAX_TOTAL_BYTES} bytes)`,
      );
    }
    const buf = await fs.readFile(srcPath);
    hash.update(`F:${f}\n`);
    hash.update(buf);
    await fs.writeFile(join(destRoot, f), buf);
  }
  for (const d of dirs) {
    await walk(srcRoot, destRoot, d, hash, counters);
  }
}
