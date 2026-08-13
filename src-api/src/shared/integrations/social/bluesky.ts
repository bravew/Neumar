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

const DEFAULT_UPLOAD_URL =
  'https://bsky.social/xrpc/com.atproto.repo.uploadBlob';
const DEFAULT_CREATE_URL =
  'https://bsky.social/xrpc/com.atproto.repo.createRecord';

export class BlueskyClient implements SocialClient {
  readonly kind = 'bluesky' as const;
  readonly uploadProtocol = 'x-media-upload';

  private readonly accessToken?: string;
  private readonly uploadUrl: string;
  private readonly createUrl: string;

  constructor(options: SocialClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.uploadUrl = options.endpoints?.upload ?? DEFAULT_UPLOAD_URL;
    this.createUrl = options.endpoints?.create ?? DEFAULT_CREATE_URL;
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
        headers: authHeaders(this.accessToken),
      },
      post: {
        text: `${captionFrom(input.metadata)} ${
          input.disclosure.fallbackCaptionSuffix ?? ''
        }`.trim(),
        labels: input.disclosure.labels,
        createUrl: this.createUrl,
      },
    };
  }

  async publish(input: SocialPublishInput): Promise<PublishedRef> {
    return {
      providerId: input.upload.providerId,
      url: this.createUrl,
      metadata: { platform: this.kind, post: input.post },
    };
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'available' };
  }
}
