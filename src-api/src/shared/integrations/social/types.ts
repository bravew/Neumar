import type { DisclosureFields } from '@/shared/services/publish/provenance';
import type {
  DestinationConfig,
  DestinationKind,
  PublishedRef,
  PublishedStatus,
  PublishMetadata,
  SourceArtifact,
} from '@/shared/services/publish/types';
import type {
  UploadFinalizeResult,
  UploadStartInput,
} from '@/shared/services/publish/upload';

export interface SocialPrepareInput {
  source: SourceArtifact;
  metadata: PublishMetadata;
  destination: DestinationConfig;
  disclosure: DisclosureFields;
}

export interface SocialPreparedUpload {
  upload: UploadStartInput;
  post: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface SocialPublishInput {
  upload: UploadFinalizeResult;
  post: Record<string, unknown>;
  disclosure: DisclosureFields;
  destination: DestinationConfig;
  metadata: PublishMetadata;
}

export interface SocialClient {
  readonly kind: DestinationKind;
  readonly uploadProtocol: string;
  prepareUpload(input: SocialPrepareInput): Promise<SocialPreparedUpload>;
  publish(input: SocialPublishInput): Promise<PublishedRef>;
  queryStatus(ref: PublishedRef): Promise<PublishedStatus>;
  abort?(ref: PublishedRef): Promise<void>;
}

export interface SocialClientOptions {
  accessToken?: string;
  fetch?: typeof fetch;
  endpoints?: Record<string, string>;
}

export function authHeaders(accessToken?: string): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export function captionFrom(metadata: PublishMetadata): string {
  return [metadata.title, metadata.description].filter(Boolean).join('\n\n');
}

export function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
