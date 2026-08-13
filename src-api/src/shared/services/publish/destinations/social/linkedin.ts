import { LinkedInClient } from '@/shared/integrations/social';

import { QUOTA_SPECS } from '../../quota-specs';
import type { UploadSession } from '../../upload';
import { LinkedInChunkedUploadSession } from '../../upload/native-protocols/linkedin-chunked';
import { SocialDestination } from './social-destination';

export function createLinkedInDestination(
  options: {
    client?: LinkedInClient;
    uploadSession?: UploadSession;
  } = {},
): SocialDestination {
  return new SocialDestination({
    kind: 'linkedin',
    client: options.client ?? new LinkedInClient(),
    uploadSession: options.uploadSession ?? new LinkedInChunkedUploadSession(),
    acceptedMimePrefixes: ['video/mp4', 'video/quicktime'],
    reformatSpec: {
      targetMime: 'video/mp4',
      container: 'mp4',
    },
    quotaSpecs: QUOTA_SPECS.linkedin,
  });
}
