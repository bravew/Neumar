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

const DEFAULT_UPLOAD_URL = 'https://upload.x.com/1.1/media/upload.json';
const DEFAULT_TWEET_URL = 'https://api.x.com/2/tweets';

export class XClient implements SocialClient {
  readonly kind = 'x' as const;
  readonly uploadProtocol = 'x-media-upload';

  private readonly accessToken?: string;
  private readonly uploadUrl: string;
  private readonly tweetUrl: string;

  constructor(options: SocialClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.uploadUrl = options.endpoints?.upload ?? DEFAULT_UPLOAD_URL;
    this.tweetUrl = options.endpoints?.tweet ?? DEFAULT_TWEET_URL;
  }

  async prepareUpload(
    input: SocialPrepareInput,
  ): Promise<SocialPreparedUpload> {
    const appendText =
      typeof input.disclosure.textAppend === 'string'
        ? ` ${input.disclosure.textAppend}`
        : '';
    return {
      upload: {
        initUrl: this.uploadUrl,
        totalBytes: input.source.sizeBytes,
        mime: input.source.mime,
        fileName: input.source.path,
        headers: authHeaders(this.accessToken),
      },
      post: {
        text: `${captionFrom(input.metadata)}${appendText}`.trim(),
        disclosure: input.disclosure.approvalDisclosure,
      },
    };
  }

  async publish(input: SocialPublishInput): Promise<PublishedRef> {
    return {
      providerId: input.upload.providerId,
      url: this.tweetUrl,
      metadata: {
        platform: this.kind,
        post: input.post,
        upload: input.upload.metadata,
      },
    };
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'available' };
  }
}
