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

const DEFAULT_INIT_URL =
  'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const DEFAULT_STATUS_URL =
  'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

export class TikTokClient implements SocialClient {
  readonly kind = 'tiktok' as const;
  readonly uploadProtocol = 'tiktok-chunked';

  private readonly accessToken?: string;
  private readonly initUrl: string;
  private readonly statusUrl: string;

  constructor(options: SocialClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.initUrl = options.endpoints?.init ?? DEFAULT_INIT_URL;
    this.statusUrl = options.endpoints?.status ?? DEFAULT_STATUS_URL;
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
          post_info: {
            title: input.metadata.title,
            description: input.metadata.description,
            privacy_level:
              input.destination.target?.privacyLevel ?? 'SELF_ONLY',
            ...recordValue(input.disclosure.post_info),
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: input.source.sizeBytes,
          },
        }),
      },
      post: {
        caption: captionFrom(input.metadata),
      },
    };
  }

  async publish(input: SocialPublishInput): Promise<PublishedRef> {
    return {
      providerId: input.upload.providerId,
      url: this.statusUrl,
      metadata: {
        platform: this.kind,
        post: input.post,
        upload: input.upload.metadata,
      },
    };
  }

  async queryStatus(ref: PublishedRef): Promise<PublishedStatus> {
    const status = ref.metadata?.status;
    return {
      state: status === 'FAILED' ? 'failed' : 'processing',
      metadata: { statusUrl: this.statusUrl },
    };
  }
}
