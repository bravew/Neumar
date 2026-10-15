/**
 * Verified download and cache for the prebuilt better-sqlite3 native addon.
 *
 * The packaged sidecar needs a `better_sqlite3.node` compiled for the pkg
 * target ABI. When the host Node.js ABI differs from the target, `build.mjs`
 * downloads a prebuilt tarball from GitHub releases.
 *
 * Upstream does not sign these assets and publishes no checksum file, so the
 * digest is pinned here, in reviewed source. A download that does not match
 * its pin is never extracted, and a cache entry that does not match its pin is
 * never reused. The cache directory name carries the package version, the ABI,
 * the platform and the arch, so a version bump cannot pick up a stale addon.
 *
 * Findings S9 in doc/maintenance/2026-10-13-regression/01-findings.md.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

/** Release host for the prebuilt addon tarballs. */
export const RELEASE_OWNER = 'WiseLibs';
export const RELEASE_REPO = 'better-sqlite3';

/**
 * Reviewed digest pins.
 *
 * `archiveSha256` covers the `.tar.gz` release asset; `addonSha256` covers the
 * `build/Release/better_sqlite3.node` member inside it, so a tampered cache
 * entry is rejected even though the archive itself is gone by then.
 *
 * Provenance: both digests were computed from the assets downloaded from
 * https://github.com/WiseLibs/better-sqlite3/releases/tag/v12.11.1 (the version
 * pnpm-lock.yaml resolves) and confirmed by a second download of the
 * darwin-arm64 asset. Recompute with `shasum -a 256` on the release asset and
 * on the extracted addon whenever the pinned version changes.
 */
export const ADDON_DIGESTS = Object.freeze({
  '12.11.1': Object.freeze({
    'node-v127': Object.freeze({
      'darwin-arm64': Object.freeze({
        archiveSha256:
          '8855551fa9a93d7141c5ff2156dd418bde42f63c23255b309a5b29c7c77925e2',
        addonSha256:
          '1946ab352978b5b3493f99080dc04ed6d0a4157c511c7139cbf50b3d44d8d560',
      }),
      'darwin-x64': Object.freeze({
        archiveSha256:
          '9c76d0dd927ad83941d29ba9cd3a4f507a88c14057afa0a3e0dbe93b5e251f4d',
        addonSha256:
          'af38de1a26e51a3bee7ec05ec9810e9a39c5da41c31b3766ba5ca37f94bd8966',
      }),
      'linux-x64': Object.freeze({
        archiveSha256:
          '94ce113ea2d9347fcd1cf8e46445cc271d1dbd02d05a64aa460442222f023b11',
        addonSha256:
          'df9fbd0d061f360d81fb51e265c53c9605020bd68219e34f33c07c85de15719a',
      }),
      'win32-x64': Object.freeze({
        archiveSha256:
          '927b34496e946dc7c9a45636a03a039df72f10191ccc4960b8616d1a9319e45b',
        addonSha256:
          'c4b95a94a963258a9ef41b12fd3bb86f0b08a2ac5c5b499fe94de57a5443682d',
      }),
    }),
  }),
});

/** Largest release asset we accept. Real assets are about 1 MB. */
export const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;

/** Largest extracted addon we accept. Real addons are about 2 MB. */
export const MAX_ADDON_BYTES = 32 * 1024 * 1024;

const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Path of the addon inside the release tarball. */
const ADDON_MEMBER = ['build', 'Release', 'better_sqlite3.node'];

/** Raised when a download or a cache entry fails digest or shape validation. */
export class NativeAddonIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NativeAddonIntegrityError';
  }
}

function missingPinMessage(version, abi, platform, arch) {
  return (
    `No reviewed digest pin for better-sqlite3 ${version} node-v${abi} ` +
    `${platform}-${arch}. Add the release asset digest and addon digest to ` +
    'ADDON_DIGESTS in scripts/lib/verified-native-addon.mjs before building ' +
    'this target.'
  );
}

/**
 * Reviewed pins for one version and target.
 *
 * An unpinned version or target is refused rather than downloaded unverified:
 * a new target needs a reviewed digest, not a fallback.
 *
 * `table` exists so tests can point the lookup at fixture digests. Production
 * callers use the reviewed `ADDON_DIGESTS` and never override it.
 */
export function digestsFor(
  version,
  abi,
  platform,
  arch,
  table = ADDON_DIGESTS,
) {
  const digests = table[version]?.[`node-v${abi}`]?.[`${platform}-${arch}`];
  if (!digests) {
    throw new NativeAddonIntegrityError(
      missingPinMessage(version, abi, platform, arch),
    );
  }
  return digests;
}

/** Release asset name, e.g. `better-sqlite3-v12.11.1-node-v127-darwin-arm64.tar.gz`. */
export function releaseAssetName(version, abi, platform, arch) {
  return `better-sqlite3-v${version}-node-v${abi}-${platform}-${arch}.tar.gz`;
}

/** Download URL for a target. */
export function releaseUrl(version, abi, platform, arch) {
  return (
    `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/` +
    `v${version}/${releaseAssetName(version, abi, platform, arch)}`
  );
}

/**
 * Cache directory for one version and target.
 *
 * The version is part of the path, so a version bump reads and writes a
 * different directory and cannot reuse the previous version's addon. The old
 * key (`better_sqlite3-node<abi>-<platform>-<arch>.node`) is deliberately not
 * produced by any function here.
 */
export function addonCacheDir(
  cacheDir,
  version,
  abi,
  platform,
  arch,
  table = ADDON_DIGESTS,
) {
  const { addonSha256 } = digestsFor(version, abi, platform, arch, table);
  return join(
    cacheDir,
    `better-sqlite3-v${version}-node-v${abi}-${platform}-${arch}-${addonSha256}`,
  );
}

/** Cached addon path for one version, target, and reviewed addon digest. */
export function addonCachePath(
  cacheDir,
  version,
  abi,
  platform,
  arch,
  table = ADDON_DIGESTS,
) {
  return join(
    addonCacheDir(cacheDir, version, abi, platform, arch, table),
    'better_sqlite3.node',
  );
}

/** Streaming SHA-256 of a file. */
export async function sha256File(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Assert that a path is a regular file, not a symlink, and within a size
 * bound. A symlinked cache entry can point anywhere, so it is refused.
 */
export function assertRegularFile(filePath, label, maxBytes) {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch (err) {
    throw new NativeAddonIntegrityError(
      `${label} is not readable at ${filePath}: ${err.message}`,
    );
  }
  if (stats.isSymbolicLink()) {
    throw new NativeAddonIntegrityError(
      `${label} at ${filePath} is a symlink; refusing to trust it`,
    );
  }
  if (!stats.isFile()) {
    throw new NativeAddonIntegrityError(
      `${label} at ${filePath} is not a regular file`,
    );
  }
  if (maxBytes !== undefined && stats.size > maxBytes) {
    throw new NativeAddonIntegrityError(
      `${label} at ${filePath} is ${stats.size} bytes, over the ${maxBytes} byte limit`,
    );
  }
  return stats;
}

/**
 * Assert that a file matches an expected SHA-256 digest. Never returns a path
 * it has not verified: on mismatch it throws and leaves the caller no way to
 * use the artifact.
 */
export async function verifyFileDigest(filePath, expectedSha256, label) {
  const actual = await sha256File(filePath);
  if (actual !== expectedSha256) {
    throw new NativeAddonIntegrityError(
      `${label} digest mismatch at ${filePath}: expected ${expectedSha256}, got ${actual}`,
    );
  }
  return filePath;
}

/**
 * Verify a cached addon before reuse.
 *
 * Returns the cached path when it matches its reviewed pin, and null when the
 * entry is missing or invalid. An invalid entry is deleted so the next build
 * downloads a fresh copy instead of failing forever.
 */
export async function resolveVerifiedCacheEntry({
  cacheDir,
  version,
  abi,
  platform,
  arch,
  digestTable = ADDON_DIGESTS,
  log = () => {},
}) {
  const { addonSha256 } = digestsFor(version, abi, platform, arch, digestTable);
  const cachedPath = addonCachePath(
    cacheDir,
    version,
    abi,
    platform,
    arch,
    digestTable,
  );
  if (!existsSync(cachedPath)) return null;

  try {
    assertRegularFile(
      cachedPath,
      'cached better_sqlite3.node',
      MAX_ADDON_BYTES,
    );
    await verifyFileDigest(
      cachedPath,
      addonSha256,
      'cached better_sqlite3.node',
    );
  } catch (err) {
    if (!(err instanceof NativeAddonIntegrityError)) throw err;
    log(`[build] Discarding invalid cache entry: ${err.message}`);
    rmSync(addonCacheDir(cacheDir, version, abi, platform, arch, digestTable), {
      recursive: true,
      force: true,
    });
    return null;
  }
  log(`[build] Using verified cached prebuilt: ${cachedPath}`);
  return cachedPath;
}

/**
 * Download the release tarball with a byte bound, then verify it against the
 * reviewed archive digest before anything reads its contents.
 */
async function downloadVerifiedArchive({
  url,
  archivePath,
  expectedSha256,
  fetchImpl,
  log,
}) {
  log(`[build] Downloading prebuilt: ${url}`);
  const res = await fetchImpl(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const declaredLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARCHIVE_BYTES) {
    throw new NativeAddonIntegrityError(
      `prebuilt archive declares ${declaredLength} bytes, over the ${MAX_ARCHIVE_BYTES} byte limit`,
    );
  }

  let received = 0;
  const bound = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_ARCHIVE_BYTES) {
        controller.error(
          new NativeAddonIntegrityError(
            `prebuilt archive exceeded the ${MAX_ARCHIVE_BYTES} byte limit`,
          ),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });

  await pipeline(res.body, bound, createWriteStream(archivePath));
  await verifyFileDigest(
    archivePath,
    expectedSha256,
    'prebuilt archive (better-sqlite3 release asset)',
  );
}

/**
 * Extract the addon from an already verified archive into a fresh directory.
 * The directory is created empty and removed again on any failure, so a
 * partial extraction never becomes the input to the next step.
 */
function extractAddon({ archivePath, extractDir, run }) {
  try {
    run('tar', ['xzf', archivePath, '-C', extractDir]);
    const addonPath = join(extractDir, ...ADDON_MEMBER);
    if (!existsSync(addonPath)) {
      throw new NativeAddonIntegrityError(
        `better_sqlite3.node not found in the verified archive at ${archivePath}`,
      );
    }
    return addonPath;
  } catch (err) {
    rmSync(extractDir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Resolve a verified `better_sqlite3.node` for the given target.
 *
 * Order of operations:
 * 1. A cache entry that matches the reviewed addon digest is reused.
 * 2. Otherwise the release asset is downloaded within a byte bound.
 * 3. The archive digest is verified before extraction.
 * 4. The addon is extracted into a fresh directory and its digest verified.
 * 5. Only then is it published into the version-keyed cache.
 *
 * Every failure path throws `NativeAddonIntegrityError`; the build must fail
 * rather than link an addon whose provenance is unknown.
 */
export async function resolveVerifiedPrebuilt({
  version,
  abi,
  platform,
  arch,
  cacheDir,
  fetchImpl = globalThis.fetch,
  run = (file, args) => execFileSync(file, args, { stdio: 'pipe' }),
  digestTable = ADDON_DIGESTS,
  log = () => {},
}) {
  const { archiveSha256, addonSha256 } = digestsFor(
    version,
    abi,
    platform,
    arch,
    digestTable,
  );

  const cached = await resolveVerifiedCacheEntry({
    cacheDir,
    version,
    abi,
    platform,
    arch,
    digestTable,
    log,
  });
  if (cached) return cached;

  const targetDir = addonCacheDir(
    cacheDir,
    version,
    abi,
    platform,
    arch,
    digestTable,
  );
  mkdirSync(targetDir, { recursive: true });
  const stagingDir = mkdtempSync(join(cacheDir, 'extract-'));
  const extractDir = join(stagingDir, 'addon');
  mkdirSync(extractDir);
  const archivePath = join(
    stagingDir,
    releaseAssetName(version, abi, platform, arch),
  );
  const cachedPath = addonCachePath(
    cacheDir,
    version,
    abi,
    platform,
    arch,
    digestTable,
  );

  try {
    await downloadVerifiedArchive({
      url: releaseUrl(version, abi, platform, arch),
      archivePath,
      expectedSha256: archiveSha256,
      fetchImpl,
      log,
    });

    const extractedAddonPath = extractAddon({
      archivePath,
      extractDir,
      run,
    });

    assertRegularFile(
      extractedAddonPath,
      'extracted better_sqlite3.node',
      MAX_ADDON_BYTES,
    );
    await verifyFileDigest(
      extractedAddonPath,
      addonSha256,
      'extracted better_sqlite3.node',
    );

    // Publish atomically so an interrupted build cannot leave a half-written
    // addon that a later build would find and reuse.
    renameSync(extractedAddonPath, cachedPath);
    log(`[build] Verified prebuilt cached: ${cachedPath}`);
    return cachedPath;
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
