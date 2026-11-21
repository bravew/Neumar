/**
 * Production wiring for the download batch runner.
 *
 * The resume route claims a destination and hands the operation here. The
 * grant is re-resolved and re-checked before the downloader runs and again
 * before the file is published; a grant that moved, was replaced, or lost its
 * permission fails the item as `denied` instead of writing anywhere.
 *
 * Importing this module registers the runner with the route. A build that does
 * not import it refuses a batch rather than starting an unmanaged download.
 */

import type { DownloadMediaOperation } from '@neumar/video-ir';

import { getDatabase } from '@/shared/db/index';

import { registerDownloadAsset } from './assets';
import {
  bindDestination,
  destinationPolicy,
  DestinationDenied,
} from './destination';
import { registerDownloadBatchRunner } from './registry';
import { runDownloadMedia } from './runner';

interface GrantRow {
  directory: string;
  device: string;
  inode: string;
}

function storedGrant(grantId: string): GrantRow | undefined {
  return getDatabase()
    .prepare(
      'SELECT directory, device, inode FROM download_destination_grants WHERE id = ?',
    )
    .get(grantId) as GrantRow | undefined;
}

/**
 * The folder this operation may write to, or a refusal.
 *
 * The grant must still be the folder the user chose: the policy is re-read and
 * the stored directory, device and inode must still describe one directory.
 * Only the task and the grant identify it, so playback resolves the same grant
 * without reconstructing the whole operation.
 */
export async function resolveDownloadDestination(
  operation: Pick<DownloadMediaOperation, 'taskId' | 'destinationGrantId'>,
): Promise<string> {
  const stored = storedGrant(operation.destinationGrantId);
  if (!stored?.directory) throw new DestinationDenied();
  let current: { directory: string; device: string; inode: string };
  try {
    current = bindDestination(
      destinationPolicy(operation.taskId),
      stored.directory,
      false,
    );
  } catch (error) {
    throw error instanceof DestinationDenied ? error : new DestinationDenied();
  }
  if (
    current.directory !== stored.directory ||
    current.device !== stored.device ||
    current.inode !== stored.inode
  ) {
    throw new DestinationDenied();
  }
  return current.directory;
}

/** Start one claimed batch with the real downloader. */
export function startDownloadBatch(
  operation: DownloadMediaOperation,
  options: {
    signal: AbortSignal;
    emit: Parameters<typeof runDownloadMedia>[1]['emit'];
  },
) {
  return runDownloadMedia(operation, {
    signal: options.signal,
    emit: options.emit,
    resolveDestination: resolveDownloadDestination,
    registerAsset: (op, itemId, root, file) =>
      registerDownloadAsset(op, itemId, root, file),
  });
}

registerDownloadBatchRunner(startDownloadBatch);
