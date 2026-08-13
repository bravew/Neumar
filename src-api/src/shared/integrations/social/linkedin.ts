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

const DEFAULT_INIT_URL =
  'https://api.linkedin.com/rest/videos?action=initializeUpload';
const DEFAULT_STATUS_URL = 'https://api.linkedin.com/rest/videos';

export class LinkedInClient implements SocialClient {
  readonly kind = 'linkedin' as const;
  readonly uploadProtocol = 'linkedin-chunked';

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
    const owner =
      (input.destination.target?.owner as string | undefined) ??
      (input.destination.target?.author as string | undefined);
    if (!owner) throw new Error('LinkedIn publish requires target.owner');

    return {
      upload: {
        initUrl: this.initUrl,
        totalBytes: input.source.sizeBytes,
        mime: input.source.mime,
        fileName: input.source.path,
        headers: {
          'Content-Type': 'application/json',
          'LinkedIn-Version': '202501',
          ...authHeaders(this.accessToken),
        },
        body: JSON.stringify({
          initializeUploadRequest: {
            owner,
            fileSizeBytes: input.source.sizeBytes,
          },
        }),
        metadata: { owner },
      },
      post: {
        owner,
        commentary: captionFrom(input.metadata),
        disclosure: input.disclosure.commentaryDisclosure,
      },
    };
  }

  async publish(input: SocialPublishInput): Promise<PublishedRef> {
    return {
      providerId: input.upload.providerId,
      url: `${this.statusUrl}/${encodeURIComponent(input.upload.providerId)}`,
      metadata: {
        platform: this.kind,
        post: input.post,
        upload: input.upload.metadata,
      },
    };
  }

  async queryStatus(ref: PublishedRef): Promise<PublishedStatus> {
    return {
      state: ref.metadata?.status === 'PROCESSING' ? 'processing' : 'available',
      metadata: { statusUrl: this.statusUrl },
    };
  }
}
