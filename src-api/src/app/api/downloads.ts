/**
 * The download surface the app mounts.
 *
 * Two routes belong together and share one rule: a client never names a path.
 * `/downloads/destination` checks a folder the picker returned, and
 * `/files/tasks/:taskId/downloads/:assetId` serves a saved file by asset id
 * after re-resolving that task's grant. Mounting them through one function
 * keeps the playback route from being added to the service but never to the
 * daemon, which would make every saved video unplayable.
 */

import type { Hono } from 'hono';

import { resolveDownloadDestination } from '@/shared/services/media-download/downloader';

import { downloadAssetRoutes } from './download-assets';
import { downloadDestinationRoutes } from './download-destination';

export function mountDownloadRoutes(app: Hono): void {
  app.route('/downloads', downloadDestinationRoutes());
  app.route('/files', downloadAssetRoutes(resolveDownloadDestination));
}
