import { BlueskyClient } from '@/shared/integrations/social';

import { QUOTA_SPECS } from '../../quota-specs';
import type { UploadSession } from '../../upload';
import { XMediaUploadSession } from '../../upload/native-protocols/x-media-upload';
import { SocialDestination } from './social-destination';

export function createBlueskyDestination(
  options: {
    client?: BlueskyClient;
    uploadSession?: UploadSession;
  } = {},
): SocialDestination {
  return new SocialDestination({
    kind: 'bluesky',
    client: options.client ?? new BlueskyClient(),
    uploadSession: options.uploadSession ?? new XMediaUploadSession(),
    acceptedMimePrefixes: ['image/', 'video/'],
    quotaSpecs: QUOTA_SPECS.bluesky,
  });
}
