import type { PublishedRef, PublishedStatus } from '@/shared/services/publish';

import {
  authHeaders,
  captionFrom,
  recordValue,
  type SocialClient,
  type SocialClientOptions,
  type SocialPrepareInput,
  type SocialPublishInput,
  type SocialPreparedUpload,
} from './types';

const DEFAULT_INIT_URL = 'https://graph.facebook.com/v23.0/me/media';
const DEFAULT_PUBLISH_URL = 'https://graph.facebook.com/v23.0/me/media_publish';

export class InstagramClient implements SocialClient {
  readonly kind = 'instagram' as const;
  readonly uploadProtocol = 'instagram-rupload';

  private readonly accessToken?: string;
  private readonly initUrl: string;
  private readonly publishUrl: string;

  constructor(options: SocialClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.initUrl = options.endpoints?.init ?? DEFAULT_INIT_URL;
    this.publishUrl = options.endpoints?.publish ?? DEFAULT_PUBLISH_URL;
  }

  async prepareUpload(
    input: SocialPrepareInput,
  ): Promise<SocialPreparedUpload> {
    return {
      upload: {
        initUrl: this.initUrl,
        totalBytes: input.source.sizeBytes,
        mime: input.source.mime,
        fileName: input.source.path,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(this.accessToken),
        },
        body: JSON.stringify({
          media_type: input.destination.target?.mediaType ?? 'REELS',
          caption: captionFrom(input.metadata),
          ...recordValue(input.disclosure.disclosures),
        }),
      },
      post: {
        caption: captionFrom(input.metadata),
        mediaType: input.destination.target?.mediaType ?? 'REELS',
      },
    };
  }

  async publish(input: SocialPublishInput): Promise<PublishedRef> {
    return {
      providerId: input.upload.providerId,
      url: this.publishUrl,
      metadata: {
        platform: this.kind,
        containerId: input.upload.providerId,
        post: input.post,
        upload: input.upload.metadata,
      },
    };
  }

  async queryStatus(ref: PublishedRef): Promise<PublishedStatus> {
    return {
      state: ref.metadata?.status === 'FINISHED' ? 'available' : 'processing',
    };
  }
}
