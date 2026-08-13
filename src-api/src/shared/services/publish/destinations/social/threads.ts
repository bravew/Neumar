import { ThreadsClient } from '@/shared/integrations/social';

import { QUOTA_SPECS } from '../../quota-specs';
import type { UploadSession } from '../../upload';
import { InstagramRuploadSession } from '../../upload/native-protocols/instagram-rupload';
import { SocialDestination } from './social-destination';

export function createThreadsDestination(
  options: {
    client?: ThreadsClient;
    uploadSession?: UploadSession;
  } = {},
): SocialDestination {
  return new SocialDestination({
    kind: 'threads',
    client: options.client ?? new ThreadsClient(),
    uploadSession: options.uploadSession ?? new InstagramRuploadSession(),
    acceptedMimePrefixes: ['image/', 'video/'],
    quotaSpecs: QUOTA_SPECS.threads,
  });
}
