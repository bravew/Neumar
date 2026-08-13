/**
 * Remote plugin acquisition — download a plugin from GitHub or an https URL
 * into a temp directory, hardened against hostile archives
 * (dev-doc/plan/07-04-plugin-system checkpoint 4; replaces the 501 stubs).
 *
 * Only zip archives are supported: GitHub serves zipballs natively via
 * codeload, and jszip is already a dependency. Extraction enforces the same
 * caps as local installs and refuses traversal, absolute paths, and symlinks.
 */

import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import { dirname, join } from 'path';

import JSZip from 'jszip';

import { getAppDir } from '@/config/constants';

import { NetworkPolicyDenied, safeFetch } from '@/shared/network-policy/fetch';
import {
  externalApiPolicy,
  trustedLocalPolicy,
} from '@/shared/network-policy/schema';
import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrl } from '@/shared/utils/url-validator';

import {
  INSTALL_MAX_FILE_BYTES,
  INSTALL_MAX_FILES,
  INSTALL_MAX_TOTAL_BYTES,
  PluginInstallError,
} from './install';

const logger = createLogger('PluginRemoteInstall');

const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface GithubRef {
  owner: string;
  repo: string;
  ref: string;
  subdir?: string;
}

const GITHUB_REF_RE =
  /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:@([A-Za-z0-9_./-]+?))?(?:#(.+))?$/;

/**
 * Parse `owner/repo[@ref][#subdir]` (optionally prefixed `github:`).
 * `@ref` may be a branch, tag, or commit SHA; defaults to HEAD.
 */
export function parseGithubRef(input: string): GithubRef {
  const match = GITHUB_REF_RE.exec(input.trim());
  if (!match) {
    throw new PluginInstallError(
      `invalid github ref '${input}' — expected owner/repo[@ref][#subdir]`,
    );
  }
  const [, owner, repo, ref, subdir] = match;
  if (!owner || !repo) {
    throw new PluginInstallError(
      `invalid github ref '${input}' — expected owner/repo[@ref][#subdir]`,
    );
  }
  if (subdir && (subdir.includes('..') || subdir.startsWith('/'))) {
    throw new PluginInstallError('github subdir must be a relative path');
  }
  return {
    owner,
    repo: repo.replace(/\.git$/, ''),
    ref: ref || 'HEAD',
    subdir: subdir || undefined,
  };
}

function isLoopbackHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(hostname);
  } catch {
    return false;
  }
}

async function downloadArchive(url: string): Promise<Buffer> {
  let res;
  try {
    // Loopback needs the localhost-permitting policy (dev registries);
    // everything else gets the strict external-https policy.
    const policy = isLoopbackHost(url)
      ? trustedLocalPolicy()
      : externalApiPolicy();
    res = await safeFetch(url, policy, {
      method: 'GET',
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });
  } catch (err) {
    if (err instanceof NetworkPolicyDenied) {
      throw new PluginInstallError(
        `download URL rejected by SSRF policy: ${err.reason}`,
      );
    }
    throw new PluginInstallError(`download failed: ${(err as Error).message}`);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new PluginInstallError(`download failed: HTTP ${res.status}`, 404);
  }
  if (res.body.length > INSTALL_MAX_TOTAL_BYTES) {
    throw new PluginInstallError(
      `archive exceeds total-size limit (${res.body.length} > ${INSTALL_MAX_TOTAL_BYTES})`,
    );
  }
  return res.body;
}

function assertZipMagic(buffer: Buffer): void {
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    (buffer[2] !== 0x03 && buffer[2] !== 0x05 && buffer[2] !== 0x07)
  ) {
    throw new PluginInstallError('archive is not a zip file');
  }
}

function isUnsafeEntryPath(name: string): boolean {
  return (
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.split('/').includes('..') ||
    name.includes('\\')
  );
}

/**
 * Extract a zip archive to a fresh temp directory, applying the install caps
 * and refusing traversal/absolute/symlink entries. When every entry shares a
 * single top-level folder (GitHub zipball layout), that folder is stripped.
 * `subdir` narrows extraction to one directory inside the (stripped) tree.
 *
 * Returns the extracted root and a cleanup callback.
 */
export async function extractZipToTemp(
  buffer: Buffer,
  subdir?: string,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  assertZipMagic(buffer);
  const zip = await JSZip.loadAsync(buffer);

  const fileEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !isSymlink(entry),
  );
  if (fileEntries.length === 0) {
    throw new PluginInstallError('archive contains no files');
  }
  for (const entry of Object.values(zip.files)) {
    if (isUnsafeEntryPath(entry.name)) {
      throw new PluginInstallError(
        `archive entry has an unsafe path: ${entry.name}`,
      );
    }
    if (isSymlink(entry)) {
      throw new PluginInstallError(
        `archive contains a symlink entry: ${entry.name}`,
      );
    }
  }

  // GitHub zipballs wrap everything in `<repo>-<ref>/` — strip a common
  // top-level folder when one exists.
  const topSegments = new Set(
    fileEntries.map((entry) => entry.name.split('/')[0]),
  );
  const stripPrefix =
    topSegments.size === 1 &&
    fileEntries.every((entry) => entry.name.includes('/'))
      ? `${[...topSegments][0]}/`
      : '';

  const wantedPrefix = subdir
    ? `${stripPrefix}${subdir.replace(/\/+$/, '')}/`
    : stripPrefix;

  const dir = join(getAppDir(), 'tmp', `plugin-install-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  const cleanup = async () => {
    await fs.rm(dir, { recursive: true, force: true });
  };

  let fileCount = 0;
  let totalBytes = 0;
  let extracted = 0;
  try {
    for (const entry of fileEntries) {
      if (!entry.name.startsWith(wantedPrefix)) continue;
      const rel = entry.name.slice(wantedPrefix.length);
      if (!rel) continue;

      fileCount += 1;
      if (fileCount > INSTALL_MAX_FILES) {
        throw new PluginInstallError(
          `archive exceeds file-count limit (${INSTALL_MAX_FILES})`,
        );
      }
      const content = await entry.async('nodebuffer');
      if (content.length > INSTALL_MAX_FILE_BYTES) {
        throw new PluginInstallError(
          `archive entry ${rel} exceeds per-file limit`,
        );
      }
      totalBytes += content.length;
      if (totalBytes > INSTALL_MAX_TOTAL_BYTES) {
        throw new PluginInstallError(
          `archive exceeds total-size limit (${INSTALL_MAX_TOTAL_BYTES} bytes)`,
        );
      }

      const target = join(dir, rel);
      await fs.mkdir(dirname(target), { recursive: true });
      await fs.writeFile(target, content);
      extracted += 1;
    }
  } catch (err) {
    await cleanup();
    throw err;
  }

  if (extracted === 0) {
    await cleanup();
    throw new PluginInstallError(
      subdir
        ? `archive has no files under '${subdir}'`
        : 'archive extraction produced no files',
      404,
    );
  }
  return { dir, cleanup };
}

function isSymlink(entry: JSZip.JSZipObject): boolean {
  const attrs = entry.unixPermissions;
  if (typeof attrs !== 'number') return false;
  // Upper bits of the unix mode: 0o120000 marks a symlink.
  return (attrs & 0o170000) === 0o120000;
}

/** Download a GitHub zipball for explicit coordinates and extract it. */
async function fetchGithubZip(coords: {
  owner: string;
  repo: string;
  ref: string;
  subdir?: string;
}): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const url = `https://codeload.github.com/${coords.owner}/${coords.repo}/zip/${encodeURIComponent(coords.ref)}`;
  logger.info(
    `Downloading plugin zipball: ${coords.owner}/${coords.repo}@${coords.ref}${coords.subdir ? `/${coords.subdir}` : ''}`,
  );
  const buffer = await downloadArchive(url);
  return extractZipToTemp(buffer, coords.subdir);
}

/**
 * Download `owner/repo[@ref][#subdir]` as a GitHub zipball and extract it.
 */
export async function fetchGithubPlugin(
  refInput: string,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const ref = parseGithubRef(refInput);
  return fetchGithubZip(ref);
}

/**
 * Download a plugin zip from an arbitrary URL (https, or http on localhost
 * only) and extract it.
 */
export async function fetchUrlPlugin(
  url: string,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const validation = validateBaseUrl(url);
  if (!validation.valid) {
    throw new PluginInstallError(
      `URL rejected: ${validation.reason ?? 'invalid'}`,
    );
  }
  logger.info(`Downloading plugin archive: ${url}`);
  const buffer = await downloadArchive(url);
  return extractZipToTemp(buffer);
}

// ---------------------------------------------------------------------------
// Catalog source resolution
//
// Marketplace catalog entries advertise their install source in several forms
// (Anthropic wire format): a relative path, a `github:` string, an https zip
// URL, or an object like `{ source: 'github' | 'git-subdir' | 'url' | 'git',
// url|repo, path, ref, sha }`. Resolve each to a concrete fetch, deriving
// GitHub coordinates so the existing zipball pipeline can serve them. Relative
// sources resolve against the marketplace catalog's own repository.
// ---------------------------------------------------------------------------

export interface CatalogSourceObject {
  source: string;
  url?: string;
  repo?: string;
  path?: string;
  ref?: string;
  sha?: string;
}

export type CatalogSource = string | CatalogSourceObject;

/** Extract `owner/repo` from a github.com repo URL (optional `.git`). */
function parseGithubRepoUrl(url: string): { owner: string; repo: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PluginInstallError(`invalid source url: ${url}`);
  }
  if (
    parsed.hostname !== 'github.com' &&
    parsed.hostname !== 'www.github.com'
  ) {
    throw new PluginInstallError(
      `unsupported source host '${parsed.hostname}' — only github.com repositories can be installed`,
    );
  }
  const segments = parsed.pathname.replace(/^\/+/, '').split('/');
  const owner = segments[0];
  const repo = segments[1]?.replace(/\.git$/, '');
  if (!owner || !repo) {
    throw new PluginInstallError(`could not parse owner/repo from ${url}`);
  }
  return { owner, repo };
}

/**
 * Derive `{owner, repo, ref}` from a marketplace catalog URL so relative
 * plugin sources resolve against the catalog's own repository. Supports
 * `raw.githubusercontent.com/OWNER/REPO/REF/...` and
 * `github.com/OWNER/REPO/...` forms.
 */
function marketplaceRepoContext(
  marketplaceUrl: string,
): { owner: string; repo: string; ref: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(marketplaceUrl);
  } catch {
    return null;
  }
  const segments = parsed.pathname.replace(/^\/+/, '').split('/');
  if (parsed.hostname === 'raw.githubusercontent.com') {
    const [owner, repo, ref] = segments;
    if (owner && repo && ref)
      return { owner, repo: repo.replace(/\.git$/, ''), ref };
  }
  if (parsed.hostname === 'github.com') {
    const [owner, repo] = segments;
    if (owner && repo) {
      return { owner, repo: repo.replace(/\.git$/, ''), ref: 'HEAD' };
    }
  }
  return null;
}

/** A resolved fetch plan for a catalog source: a GitHub repo+subdir, or a zip URL. */
export type PluginFetchTarget =
  | {
      kind: 'github';
      owner: string;
      repo: string;
      ref: string;
      subdir?: string;
    }
  | { kind: 'url'; url: string };

/** Human-readable ref for a target, stored as install provenance. */
export function fetchTargetRef(target: PluginFetchTarget): string {
  if (target.kind === 'url') return target.url;
  return `${target.owner}/${target.repo}@${target.ref}${target.subdir ? `#${target.subdir}` : ''}`;
}

/**
 * Resolve a catalog entry's source to a concrete fetch target without
 * downloading. `marketplaceUrl` resolves relative sources against the catalog
 * repository. Shared by the installer and the pre-install inspector.
 */
export function resolvePluginFetchTarget(
  source: CatalogSource,
  marketplaceUrl: string,
): PluginFetchTarget {
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed.startsWith('github:')) {
      return { kind: 'github', ...parseGithubRef(trimmed) };
    }
    if (/^https?:\/\//.test(trimmed)) {
      return urlTarget(trimmed, undefined, undefined);
    }
    const context = marketplaceRepoContext(marketplaceUrl);
    if (!context) {
      throw new PluginInstallError(
        'relative plugin source cannot be resolved: the catalog is not hosted on a recognized GitHub URL',
      );
    }
    const subdir = trimmed.replace(/^\.\//, '').replace(/^\/+/, '');
    return { kind: 'github', ...context, subdir };
  }

  const kind = source.source;
  const ref = source.sha || source.ref || 'HEAD';
  if (kind === 'github') {
    if (!source.repo) {
      throw new PluginInstallError("github source missing 'repo'");
    }
    const [owner, repo] = source.repo.split('/');
    if (!owner || !repo) {
      throw new PluginInstallError(`invalid github repo '${source.repo}'`);
    }
    return { kind: 'github', owner, repo, ref, subdir: source.path };
  }
  if (kind === 'git-subdir' || kind === 'git' || kind === 'url') {
    if (!source.url) {
      throw new PluginInstallError(`${kind} source missing 'url'`);
    }
    return urlTarget(source.url, ref, source.path);
  }
  throw new PluginInstallError(
    `unsupported catalog source kind '${kind}' — this plugin cannot be installed automatically`,
  );
}

/** A URL-form source: a GitHub repo resolves to repo coords; else a zip URL. */
function urlTarget(
  url: string,
  ref: string | undefined,
  subdir: string | undefined,
): PluginFetchTarget {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new PluginInstallError(`invalid source url: ${url}`);
  }
  const isGithubRepo =
    host === 'github.com' || host === 'www.github.com' || url.endsWith('.git');
  if (isGithubRepo) {
    const { owner, repo } = parseGithubRepoUrl(url);
    return { kind: 'github', owner, repo, ref: ref || 'HEAD', subdir };
  }
  return { kind: 'url', url };
}

/**
 * Resolve a catalog entry's source to a concrete fetch and extract it to a
 * temp dir. `marketplaceUrl` is the catalog URL, used to resolve relative
 * sources against the catalog repository.
 */
export async function fetchCatalogPlugin(
  source: CatalogSource,
  marketplaceUrl: string,
): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
  installKind: 'github' | 'url';
  ref: string;
}> {
  const target = resolvePluginFetchTarget(source, marketplaceUrl);
  const ref = fetchTargetRef(target);
  if (target.kind === 'github') {
    return { ...(await fetchGithubZip(target)), installKind: 'github', ref };
  }
  return { ...(await fetchUrlPlugin(target.url)), installKind: 'url', ref };
}
