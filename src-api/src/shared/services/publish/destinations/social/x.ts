import { XClient } from '@/shared/integrations/social';

import { QUOTA_SPECS } from '../../quota-specs';
import type { UploadSession } from '../../upload';
import { XMediaUploadSession } from '../../upload/native-protocols/x-media-upload';
import { SocialDestination } from './social-destination';

export function createXDestination(
  options: {
    client?: XClient;
    uploadSession?: UploadSession;
  } = {},
): SocialDestination {
  return new SocialDestination({
    kind: 'x',
    client: options.client ?? new XClient(),
    uploadSession: options.uploadSession ?? new XMediaUploadSession(),
    acceptedMimePrefixes: ['image/', 'video/'],
    quotaSpecs: QUOTA_SPECS.x,
  });
}
