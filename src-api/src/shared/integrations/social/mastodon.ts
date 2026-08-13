import type { PublishedRef, PublishedStatus } from '@/shared/services/publish';

import {
  authHeaders,
  captionFrom,
  type SocialClient,
  type SocialClientOptions,
  type SocialPrepareInput,
  type SocialPublishInput,
  type SocialPreparedUpload,
} from './types';

const DEFAULT_MEDIA_URL = 'https://mastodon.social/api/v2/media';
const DEFAULT_STATUS_URL = 'https://mastodon.social/api/v1/statuses';

export class MastodonClient implements SocialClient {
  readonly kind = 'mastodon' as const;
  readonly uploadProtocol = 'x-media-upload';

  private readonly accessToken?: string;
  private readonly mediaUrl: string;
  private readonly statusUrl: string;

  constructor(options: SocialClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.mediaUrl = options.endpoints?.media ?? DEFAULT_MEDIA_URL;
    this.statusUrl = options.endpoints?.status ?? DEFAULT_STATUS_URL;
  }

  async prepareUpload(
    input: SocialPrepareInput,
  ): Promise<SocialPreparedUpload> {
    return {
      upload: {
        initUrl: this.mediaUrl,
        totalBytes: input.source.sizeBytes,
        mime: input.source.mime,
        fileName: input.source.path,
        headers: authHeaders(this.accessToken),
      },
      post: {
        status: captionFrom(input.metadata),
        language: input.disclosure.language,
        spoiler_text: input.disclosure.contentWarning,
        statusUrl: this.statusUrl,
      },
    };
  }

  async publish(input: SocialPublishInput): Promise<PublishedRef> {
    return {
      providerId: input.upload.providerId,
      url: this.statusUrl,
      metadata: { platform: this.kind, post: input.post },
    };
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'available' };
  }
}
