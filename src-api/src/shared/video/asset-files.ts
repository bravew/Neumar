import type { PathValidationOptions } from '@/shared/services/ffmpeg';
import { validateInputFile } from '@/shared/services/ffmpeg';

import { assertSafeExternalMediaFile } from './linked-sources/local-fs';
import type { MediaItem } from './types';

/**
 * Absolute path to the bytes backing a project asset.
 *
 * Managed assets live inside the workspace and are checked against it, the way
 * everything in Video Mode always has been. External assets are the user's own
 * files, kept where they put them; they get the linked-source trust rules
 * instead — inside a trusted root (home, the workspace, a mounted volume),
 * never a credentials directory, symlinks resolved before the check.
 *
 * Every read of an external master goes through here, because `project.json`
 * is editable and a path that was safe when it was written is not
 * automatically safe now.
 */
export function resolveProjectAssetPath(
  asset: Pick<MediaItem, 'path' | 'origin'>,
  workspaceRoot: string,
): string {
  if (asset.origin === 'external') {
    return assertSafeExternalMediaFile(asset.path);
  }
  return validateInputFile(asset.path, workspaceRoot);
}

/** True when the asset's master is the user's own file, kept in place. */
export function isExternalAsset(
  asset: Pick<MediaItem, 'origin'> | undefined,
): boolean {
  return asset?.origin === 'external';
}

/**
 * Validation options for handing a path from `resolveProjectAssetPath` to
 * ffprobe/ffmpeg.
 *
 * The two enforce different rules, and without this the stricter one wins:
 * `resolveProjectAssetPath` admits an external master under the linked-source
 * rules, then the executor re-checks it against the workspace alone and
 * rejects the file we just approved. Passing the asset's origin along keeps
 * one decision instead of two, and keeps the relaxation tied to an asset
 * record rather than to whoever supplied the string.
 */
export function assetPathValidation(
  asset: Pick<MediaItem, 'origin'> | undefined,
): PathValidationOptions {
  return { allowExternalMedia: isExternalAsset(asset) };
}

/** True when the asset can supply an audio stream for a music/VO/SFX track. */
export function assetCanProvideAudio(
  asset: Pick<MediaItem, 'kind' | 'metadata'> | undefined,
): boolean {
  if (!asset) return false;
  if (asset.kind === 'audio') return true;
  if (asset.kind !== 'video') return false;
  const count = asset.metadata?.audioTrackCount;
  return count == null || count > 0;
}

/**
 * The same resolution as `resolveProjectAssetPath`, reported instead of thrown.
 *
 * Listing tools describe every asset in a project, so one unreadable master
 * must not take the other 46 with it. An external master is the user's own
 * file: the drive can be unmounted, the file renamed, the path edited in
 * `project.json` to somewhere we will not read from. All three are ordinary
 * states to report, not failures of the listing.
 *
 * The trust check is unchanged — an untrusted path yields no `filePath`, so a
 * caller still cannot read it. Callers that are about to open the file want
 * `resolveProjectAssetPath` and its exception.
 */
export function describeProjectAssetPath(
  asset: Pick<MediaItem, 'path' | 'origin'>,
  workspaceRoot: string,
): { filePath: string } | { filePath?: undefined; unavailableReason: string } {
  try {
    return { filePath: resolveProjectAssetPath(asset, workspaceRoot) };
  } catch (error) {
    return {
      unavailableReason: error instanceof Error ? error.message : String(error),
    };
  }
}
