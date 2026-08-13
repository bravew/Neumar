import { InstagramClient } from '@/shared/integrations/social';

import { QUOTA_SPECS } from '../../quota-specs';
import type { UploadSession } from '../../upload';
import { InstagramRuploadSession } from '../../upload/native-protocols/instagram-rupload';
import { SocialDestination } from './social-destination';

export function createInstagramDestination(
  options: {
    client?: InstagramClient;
    uploadSession?: UploadSession;
  } = {},
): SocialDestination {
  return new SocialDestination({
    kind: 'instagram',
    client: options.client ?? new InstagramClient(),
    uploadSession: options.uploadSession ?? new InstagramRuploadSession(),
    acceptedMimePrefixes: ['video/mp4', 'video/quicktime'],
    reformatSpec: {
      targetMime: 'video/mp4',
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'aac',
    },
    quotaSpecs: QUOTA_SPECS.instagram,
  });
}
