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

const DEFAULT_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

export class YouTubeClient implements SocialClient {
  readonly kind = 'youtube' as const;
  readonly uploadProtocol = 'google-resumable';

  private readonly accessToken?: string;
  private readonly uploadUrl: string;

  constructor(options: SocialClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.uploadUrl = options.endpoints?.upload ?? DEFAULT_UPLOAD_URL;
  }

  async prepareUpload(
    input: SocialPrepareInput,
  ): Promise<SocialPreparedUpload> {
    return {
      upload: {
        initUrl: this.uploadUrl,
        totalBytes: input.source.sizeBytes,
        mime: input.source.mime,
        fileName: input.source.path,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(this.accessToken),
        },
        body: JSON.stringify({
          snippet: {
            title: input.metadata.title,
            description: input.metadata.description,
            tags: input.metadata.tags,
          },
          status: {
            privacyStatus:
              (input.destination.target?.privacyStatus as string | undefined) ??
              'private',
            ...recordValue(input.disclosure.status),
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
      url: input.upload.url,
      metadata: {
        platform: this.kind,
        post: input.post,
        upload: input.upload.metadata,
      },
    };
  }

  async queryStatus(ref: PublishedRef): Promise<PublishedStatus> {
    const state = ref.metadata?.processingDetails ? 'processing' : 'available';
    return { state };
  }
}
