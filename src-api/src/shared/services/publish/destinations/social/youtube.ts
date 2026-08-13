import { YouTubeClient } from '@/shared/integrations/social';

import { QUOTA_SPECS } from '../../quota-specs';
import type { UploadSession } from '../../upload';
import { GoogleResumableUploadSession } from '../../upload/native-protocols/google-resumable';
import { SocialDestination } from './social-destination';

export function createYouTubeDestination(
  options: {
    client?: YouTubeClient;
    uploadSession?: UploadSession;
  } = {},
): SocialDestination {
  return new SocialDestination({
    kind: 'youtube',
    client: options.client ?? new YouTubeClient(),
    uploadSession: options.uploadSession ?? new GoogleResumableUploadSession(),
    acceptedMimePrefixes: ['video/mp4', 'video/quicktime'],
    reformatSpec: {
      targetMime: 'video/mp4',
      container: 'mp4',
      audioCodec: 'aac',
    },
    quotaSpecs: QUOTA_SPECS.youtube,
  });
}
