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

const DEFAULT_INIT_URL = 'https://graph.threads.net/v1.0/me/threads';
const DEFAULT_PUBLISH_URL = 'https://graph.threads.net/v1.0/me/threads_publish';

export class ThreadsClient implements SocialClient {
  readonly kind = 'threads' as const;
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
          media_type: input.destination.target?.mediaType ?? 'VIDEO',
          text: captionFrom(input.metadata),
          ...recordValue(input.disclosure.disclosures),
        }),
      },
      post: { text: captionFrom(input.metadata), publishUrl: this.publishUrl },
    };
  }

  async publish(input: SocialPublishInput): Promise<PublishedRef> {
    return {
      providerId: input.upload.providerId,
      url: this.publishUrl,
      metadata: { platform: this.kind, post: input.post },
    };
  }

  async queryStatus(): Promise<PublishedStatus> {
    return { state: 'processing' };
  }
}
