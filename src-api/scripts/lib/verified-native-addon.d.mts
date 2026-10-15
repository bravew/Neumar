/**
 * Types for the build scripts' verified native addon module.
 *
 * The module itself is JavaScript so `build.mjs` and this declaration stay in
 * lockstep; `tsconfig.json` has `allowJs: false`, so this file is the only
 * typed view of it. Keep it in sync with scripts/lib/verified-native-addon.mjs.
 */

/** Reviewed digests for one release asset and the addon it contains. */
export interface AddonDigestPin {
  /** SHA-256 of the `.tar.gz` release asset. */
  archiveSha256: string;
  /** SHA-256 of `build/Release/better_sqlite3.node` inside the asset. */
  addonSha256: string;
}

/** Reviewed digest pins, keyed by version, then ABI key, then platform-arch. */
export type AddonDigestTable = Record<
  string,
  Record<string, Record<string, AddonDigestPin>>
>;

export interface ResolveVerifiedCacheEntryOptions {
  cacheDir: string;
  version: string;
  abi: number;
  platform: string;
  arch: string;
  /** Test seam only; production uses the reviewed table. */
  digestTable?: AddonDigestTable;
  log?: (message: string) => void;
}

export interface ResolveVerifiedPrebuiltOptions {
  cacheDir: string;
  version: string;
  abi: number;
  platform: string;
  arch: string;
  fetchImpl?: typeof fetch;
  run?: (file: string, args: string[]) => unknown;
  /** Test seam only; production uses the reviewed table. */
  digestTable?: AddonDigestTable;
  log?: (message: string) => void;
}

export declare const RELEASE_OWNER: string;
export declare const RELEASE_REPO: string;
export declare const ADDON_DIGESTS: AddonDigestTable;
export declare const MAX_ARCHIVE_BYTES: number;
export declare const MAX_ADDON_BYTES: number;

export declare class NativeAddonIntegrityError extends Error {
  constructor(message: string);
}

export declare function digestsFor(
  version: string,
  abi: number,
  platform: string,
  arch: string,
  table?: AddonDigestTable,
): AddonDigestPin;

export declare function releaseAssetName(
  version: string,
  abi: number,
  platform: string,
  arch: string,
): string;

export declare function releaseUrl(
  version: string,
  abi: number,
  platform: string,
  arch: string,
): string;

export declare function addonCacheDir(
  cacheDir: string,
  version: string,
  abi: number,
  platform: string,
  arch: string,
  table?: AddonDigestTable,
): string;

export declare function addonCachePath(
  cacheDir: string,
  version: string,
  abi: number,
  platform: string,
  arch: string,
  table?: AddonDigestTable,
): string;

export declare function sha256File(filePath: string): Promise<string>;

export declare function assertRegularFile(
  filePath: string,
  label: string,
  maxBytes?: number,
): unknown;

export declare function verifyFileDigest(
  filePath: string,
  expectedSha256: string,
  label: string,
): Promise<string>;

export declare function resolveVerifiedCacheEntry(
  options: ResolveVerifiedCacheEntryOptions,
): Promise<string | null>;

export declare function resolveVerifiedPrebuilt(
  options: ResolveVerifiedPrebuiltOptions,
): Promise<string>;
