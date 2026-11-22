/**
 * The process-wide downloader the resume route starts a claimed batch with.
 *
 * The route is written against this seam so the picker and resume behavior can
 * be tested with a fake runner. The real yt-dlp runner registers itself when
 * the daemon loads it; a missing registration refuses the batch rather than
 * falling back to a shell download.
 */

import type {
  DownloadActivity,
  DownloadMediaOperation,
} from '@neumar/video-ir';

import type { StartDownloadBatch } from './run-batch';

let registered: StartDownloadBatch | undefined;

export function registerDownloadBatchRunner(start: StartDownloadBatch): void {
  registered = start;
}

export const startDownloadBatch: StartDownloadBatch = (
  operation: DownloadMediaOperation,
  options: { signal: AbortSignal; emit(activity: DownloadActivity): void },
) => {
  if (!registered) {
    return Promise.reject(
      new Error('The video downloader is not available in this build.'),
    );
  }
  return registered(operation, options);
};
