import { MastodonClient } from '@/shared/integrations/social';

import { QUOTA_SPECS } from '../../quota-specs';
import type { UploadSession } from '../../upload';
import { XMediaUploadSession } from '../../upload/native-protocols/x-media-upload';
import { SocialDestination } from './social-destination';

export function createMastodonDestination(
  options: {
    client?: MastodonClient;
    uploadSession?: UploadSession;
  } = {},
): SocialDestination {
  return new SocialDestination({
    kind: 'mastodon',
    client: options.client ?? new MastodonClient(),
    uploadSession: options.uploadSession ?? new XMediaUploadSession(),
    acceptedMimePrefixes: ['image/', 'video/'],
    quotaSpecs: QUOTA_SPECS.mastodon,
  });
}
