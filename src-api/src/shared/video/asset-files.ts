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
