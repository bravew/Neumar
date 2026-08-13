import { TikTokClient } from '@/shared/integrations/social';

import { QUOTA_SPECS } from '../../quota-specs';
import type { UploadSession } from '../../upload';
import { TikTokChunkedUploadSession } from '../../upload/native-protocols/tiktok-chunked';
import { SocialDestination } from './social-destination';

const TIKTOK_MAX_BYTES = 287_600_000;

export function createTikTokDestination(
  options: {
    client?: TikTokClient;
    uploadSession?: UploadSession;
  } = {},
): SocialDestination {
  return new SocialDestination({
    kind: 'tiktok',
    client: options.client ?? new TikTokClient(),
    uploadSession: options.uploadSession ?? new TikTokChunkedUploadSession(),
    acceptedMimePrefixes: ['video/mp4', 'video/quicktime'],
    maxBytes: TIKTOK_MAX_BYTES,
    reformatSpec: {
      targetMime: 'video/mp4',
      container: 'mp4',
      maxDurationSeconds: 30 * 60,
      videoCodec: 'h264',
      audioCodec: 'aac',
    },
    quotaSpecs: QUOTA_SPECS.tiktok,
  });
}
