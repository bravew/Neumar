/**
 * Regression test for the prebuilt better-sqlite3 native addon download and
 * cache (findings S9).
 *
 * The test never reaches GitHub. It builds tarballs from a synthetic addon in
 * a temporary directory, points the digest lookup at those fixtures through
 * the `digestTable` seam, and injects a `fetchImpl` that serves the bytes from
 * memory. That exercises the real code path: byte bound, archive digest check,
 * fresh extraction, addon digest check, cache publication, and cache reuse.
 *
 * Acceptance (issue #206): a tampered archive and a tampered cache entry are
 * both rejected, and a version bump invalidates the cache.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AddonDigestTable } from '../../../scripts/lib/verified-native-addon.mjs';
import {
  addonCacheDir,
  addonCachePath,
  MAX_ARCHIVE_BYTES,
  NativeAddonIntegrityError,
  resolveVerifiedCacheEntry,
  resolveVerifiedPrebuilt,
  sha256File,
  verifyFileDigest,
} from '../../../scripts/lib/verified-native-addon.mjs';

const ABI = 127;
const PLATFORM = 'darwin';
const ARCH = 'arm64';
const VERSION = '12.11.1';
const NEXT_VERSION = '12.12.0';

interface FixtureArchive {
  archivePath: string;
  addonBytes: Buffer;
  archiveSha256: string;
  addonSha256: string;
}

/** Deterministic synthetic addon payload; no real binary is involved. */
function fixtureAddonBytes(tag: string): Buffer {
  return Buffer.from(`synthetic-better-sqlite3-addon:${tag}`.padEnd(4096, '.'));
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Build a release tarball containing `build/Release/better_sqlite3.node`, laid
 * out exactly as upstream lays it out.
 */
function buildFixtureArchive(dir: string, tag: string): FixtureArchive {
  const addonBytes = fixtureAddonBytes(tag);
  const staging = join(dir, `staging-${tag}`);
  const memberDir = join(staging, 'build', 'Release');
  mkdirSync(memberDir, { recursive: true });
  writeFileSync(join(memberDir, 'better_sqlite3.node'), addonBytes);

  const archivePath = join(dir, `better-sqlite3-${tag}.tar.gz`);
  execFileSync('tar', ['czf', archivePath, '-C', staging, 'build']);
  return {
    archivePath,
    addonBytes,
    archiveSha256: sha256(readFileSync(archivePath)),
    addonSha256: sha256(addonBytes),
  };
}

/** A digest table for one version, so a test can point the module at fixtures. */
function digestTable(
  version: string,
  pin: { archiveSha256: string; addonSha256: string },
): AddonDigestTable {
  return {
    [version]: {
      [`node-v${ABI}`]: {
        [`${PLATFORM}-${ARCH}`]: {
          archiveSha256: pin.archiveSha256,
          addonSha256: pin.addonSha256,
        },
      },
    },
  };
}

/** A `fetchImpl` that serves the fixture archive bytes and records calls. */
function fixtureFetch(
  archivePath: string,
  options: { status?: number } = {},
): { fetchImpl: typeof fetch; calls: string[] } {
  const status = options.status ?? 200;
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    const bytes = readFileSync(archivePath);
    return new Response(new Uint8Array(bytes), {
      status,
      headers: { 'content-length': String(bytes.length) },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** A response whose streamed body exceeds the byte bound with no length header. */
function oversizeFetch(totalBytes: number): typeof fetch {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunk.byteLength, totalBytes - sent);
      sent += size;
      controller.enqueue(
        size === chunk.byteLength ? chunk : chunk.subarray(0, size),
      );
    },
  });
  return (async () => new Response(body, { status: 200 })) as typeof fetch;
}

describe('verified native addon download and cache', () => {
  let dir: string;
  let cacheDir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'native-addon-test-'));
    cacheDir = join(dir, 'cache');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Extraction staging directories left under the cache. The module names them
   * `extract-*` from `mkdtempSync`, so this reports what actually survived a
   * run instead of asserting on one hardcoded name.
   */
  function stagingDirsLeftBehind(): string[] {
    if (!existsSync(cacheDir)) return [];
    return readdirSync(cacheDir).filter((entry) =>
      entry.startsWith('extract-'),
    );
  }

  it('accepts the correct archive and publishes a verified cache entry', async () => {
    const fixture = buildFixtureArchive(dir, 'good');
    const { fetchImpl, calls } = fixtureFetch(fixture.archivePath);

    const resolved = await resolveVerifiedPrebuilt({
      version: VERSION,
      abi: ABI,
      platform: PLATFORM,
      arch: ARCH,
      cacheDir,
      fetchImpl,
      digestTable: digestTable(VERSION, fixture),
    });

    expect(calls).toHaveLength(1);
    expect(resolved).toBe(
      addonCachePath(
        cacheDir,
        VERSION,
        ABI,
        PLATFORM,
        ARCH,
        digestTable(VERSION, fixture),
      ),
    );
    expect(readFileSync(resolved)).toEqual(fixture.addonBytes);
    expect(await sha256File(resolved)).toBe(fixture.addonSha256);

    // Neither the extraction directory nor a partial file survives the build.
    expect(stagingDirsLeftBehind()).toEqual([]);
    expect(
      existsSync(join(dirname(resolved), 'better_sqlite3.node.partial')),
    ).toBe(false);
  });

  it('reuses a verified cache entry without downloading again', async () => {
    const fixture = buildFixtureArchive(dir, 'good');
    const first = fixtureFetch(fixture.archivePath);
    await resolveVerifiedPrebuilt({
      version: VERSION,
      abi: ABI,
      platform: PLATFORM,
      arch: ARCH,
      cacheDir,
      fetchImpl: first.fetchImpl,
      digestTable: digestTable(VERSION, fixture),
    });

    const second = fixtureFetch(fixture.archivePath);
    const resolved = await resolveVerifiedPrebuilt({
      version: VERSION,
      abi: ABI,
      platform: PLATFORM,
      arch: ARCH,
      cacheDir,
      fetchImpl: second.fetchImpl,
      digestTable: digestTable(VERSION, fixture),
    });

    expect(second.calls).toHaveLength(0);
    expect(readFileSync(resolved)).toEqual(fixture.addonBytes);
  });

  it('rejects a tampered archive at the archive digest boundary', async () => {
    const fixture = buildFixtureArchive(dir, 'good');
    // The addon inside the served archive is exactly the pinned addon, but the
    // archive bytes differ. Only the archive digest can catch this: the addon
    // digest is computed after extraction and would pass.
    const repacked = buildFixtureArchive(dir, 'repacked');
    expect(repacked.addonSha256).not.toBe(fixture.addonSha256);
    const repackedAddon = join(
      dir,
      'staging-repacked',
      'build',
      'Release',
      'better_sqlite3.node',
    );
    writeFileSync(repackedAddon, fixture.addonBytes);
    // Repacking identical content can yield identical bytes (GNU tar with equal
    // mtimes and a zeroed gzip header), so add a file to guarantee the archive
    // differs while the addon inside stays exactly the pinned one.
    writeFileSync(
      join(dir, 'staging-repacked', 'build', 'repack-marker.txt'),
      'repacked',
    );
    execFileSync('tar', [
      'czf',
      repacked.archivePath,
      '-C',
      join(dir, 'staging-repacked'),
      'build',
    ]);
    expect(sha256(readFileSync(repacked.archivePath))).not.toBe(
      fixture.archiveSha256,
    );

    const { fetchImpl } = fixtureFetch(repacked.archivePath);

    await expect(
      resolveVerifiedPrebuilt({
        version: VERSION,
        abi: ABI,
        platform: PLATFORM,
        arch: ARCH,
        cacheDir,
        fetchImpl,
        digestTable: digestTable(VERSION, fixture),
      }),
    ).rejects.toThrow(/prebuilt archive .* digest mismatch/);

    // Nothing was published, and neither the tarball nor the extraction
    // directory survived the failure.
    const cachedPath = addonCachePath(
      cacheDir,
      VERSION,
      ABI,
      PLATFORM,
      ARCH,
      digestTable(VERSION, fixture),
    );
    expect(existsSync(cachedPath)).toBe(false);
    expect(readdirSync(dirname(cachedPath))).toEqual([]);
    expect(stagingDirsLeftBehind()).toEqual([]);
  });

  it('rejects an archive whose addon was replaced', async () => {
    const fixture = buildFixtureArchive(dir, 'good');
    // Same version and target, different addon bytes: the reviewed digest no
    // longer matches what the server returned.
    const tampered = buildFixtureArchive(dir, 'tampered');
    const { fetchImpl } = fixtureFetch(tampered.archivePath);

    await expect(
      resolveVerifiedPrebuilt({
        version: VERSION,
        abi: ABI,
        platform: PLATFORM,
        arch: ARCH,
        cacheDir,
        fetchImpl,
        digestTable: digestTable(VERSION, fixture),
      }),
    ).rejects.toThrow(NativeAddonIntegrityError);

    const cachedPath = addonCachePath(
      cacheDir,
      VERSION,
      ABI,
      PLATFORM,
      ARCH,
      digestTable(VERSION, fixture),
    );
    expect(existsSync(cachedPath)).toBe(false);
  });

  it('rejects a tampered cache entry and discards it', async () => {
    const fixture = buildFixtureArchive(dir, 'good');
    const cachedPath = addonCachePath(
      cacheDir,
      VERSION,
      ABI,
      PLATFORM,
      ARCH,
      digestTable(VERSION, fixture),
    );
    mkdirSync(dirname(cachedPath), { recursive: true });
    writeFileSync(cachedPath, fixtureAddonBytes('poisoned'));

    const resolved = await resolveVerifiedCacheEntry({
      cacheDir,
      version: VERSION,
      abi: ABI,
      platform: PLATFORM,
      arch: ARCH,
      digestTable: digestTable(VERSION, fixture),
    });

    expect(resolved).toBeNull();
    expect(existsSync(cachedPath)).toBe(false);
  });

  it('refuses a symlinked cache entry', async () => {
    const fixture = buildFixtureArchive(dir, 'good');
    const elsewhere = join(dir, 'elsewhere.node');
    writeFileSync(elsewhere, fixture.addonBytes);
    const cachedPath = addonCachePath(
      cacheDir,
      VERSION,
      ABI,
      PLATFORM,
      ARCH,
      digestTable(VERSION, fixture),
    );
    mkdirSync(dirname(cachedPath), { recursive: true });
    symlinkSync(elsewhere, cachedPath);

    const resolved = await resolveVerifiedCacheEntry({
      cacheDir,
      version: VERSION,
      abi: ABI,
      platform: PLATFORM,
      arch: ARCH,
      digestTable: digestTable(VERSION, fixture),
    });

    expect(resolved).toBeNull();
  });

  it('invalidates the cache when the addon version changes', async () => {
    const fixture = buildFixtureArchive(dir, 'good');
    const { fetchImpl } = fixtureFetch(fixture.archivePath);
    await resolveVerifiedPrebuilt({
      version: VERSION,
      abi: ABI,
      platform: PLATFORM,
      arch: ARCH,
      cacheDir,
      fetchImpl,
      digestTable: digestTable(VERSION, fixture),
    });

    expect(
      addonCacheDir(
        cacheDir,
        NEXT_VERSION,
        ABI,
        PLATFORM,
        ARCH,
        digestTable(NEXT_VERSION, fixture),
      ),
    ).not.toBe(
      addonCacheDir(
        cacheDir,
        VERSION,
        ABI,
        PLATFORM,
        ARCH,
        digestTable(VERSION, fixture),
      ),
    );

    // A build for the next version must not see the previous version's addon.
    const resolved = await resolveVerifiedCacheEntry({
      cacheDir,
      version: NEXT_VERSION,
      abi: ABI,
      platform: PLATFORM,
      arch: ARCH,
      digestTable: {
        ...digestTable(VERSION, fixture),
        ...digestTable(NEXT_VERSION, fixture),
      },
    });
    expect(resolved).toBeNull();

    // The previous version's entry is still present and untouched.
    expect(
      existsSync(
        addonCachePath(
          cacheDir,
          VERSION,
          ABI,
          PLATFORM,
          ARCH,
          digestTable(VERSION, fixture),
        ),
      ),
    ).toBe(true);
  });

  it('separates cache entries when the reviewed digest changes for the same version', async () => {
    const first = buildFixtureArchive(dir, 'first');
    const second = buildFixtureArchive(dir, 'second');
    const resolveFixture = (fixture: FixtureArchive) =>
      resolveVerifiedPrebuilt({
        version: VERSION,
        abi: ABI,
        platform: PLATFORM,
        arch: ARCH,
        cacheDir,
        fetchImpl: fixtureFetch(fixture.archivePath).fetchImpl,
        digestTable: digestTable(VERSION, fixture),
      });
    const firstPath = await resolveFixture(first);
    const secondPath = await resolveFixture(second);
    expect(secondPath).not.toBe(firstPath);
    expect(readFileSync(firstPath)).toEqual(first.addonBytes);
    expect(readFileSync(secondPath)).toEqual(second.addonBytes);
  });

  it('refuses a target with no reviewed digest pin and does not download', async () => {
    const fixture = buildFixtureArchive(dir, 'good');
    const { fetchImpl, calls } = fixtureFetch(fixture.archivePath);

    await expect(
      resolveVerifiedPrebuilt({
        version: VERSION,
        abi: 999,
        platform: PLATFORM,
        arch: ARCH,
        cacheDir,
        fetchImpl,
        digestTable: digestTable(VERSION, fixture),
      }),
    ).rejects.toThrow(/No reviewed digest pin/);

    expect(calls).toHaveLength(0);
  });

  it('rejects an archive whose declared size is over the bound', async () => {
    const fixture = buildFixtureArchive(dir, 'good');
    const fetchImpl = (async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-length': String(MAX_ARCHIVE_BYTES + 1) },
      })) as typeof fetch;

    await expect(
      resolveVerifiedPrebuilt({
        version: VERSION,
        abi: ABI,
        platform: PLATFORM,
        arch: ARCH,
        cacheDir,
        fetchImpl,
        digestTable: digestTable(VERSION, fixture),
      }),
    ).rejects.toThrow(NativeAddonIntegrityError);
  });

  it('stops a streamed download that exceeds the bound', async () => {
    const fixture = buildFixtureArchive(dir, 'good');

    await expect(
      resolveVerifiedPrebuilt({
        version: VERSION,
        abi: ABI,
        platform: PLATFORM,
        arch: ARCH,
        cacheDir,
        fetchImpl: oversizeFetch(MAX_ARCHIVE_BYTES + 1024 * 1024),
        digestTable: digestTable(VERSION, fixture),
      }),
    ).rejects.toThrow(/byte limit/);
  });

  it('reports a digest mismatch with both digests', async () => {
    const path = join(dir, 'sample.bin');
    writeFileSync(path, 'actual-bytes');

    await expect(
      verifyFileDigest(path, sha256(Buffer.from('other-bytes')), 'sample'),
    ).rejects.toThrow(/digest mismatch/);
  });
});
