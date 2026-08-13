import { z } from 'zod';

import type { JobState, LegState } from './state-machine';

export const destinationKinds = [
  'gdrive',
  'dropbox',
  'box',
  'onedrive',
  's3',
  'immich',
  'webdav',
  'synology-photos',
  'rclone',
  'youtube',
  'tiktok',
  'instagram',
  'linkedin',
  'x',
  'threads',
  'bluesky',
  'mastodon',
  'pinterest',
  'snapchat',
  'reddit',
  'facebook-page',
  'local-archive',
] as const;

export type DestinationKind = (typeof destinationKinds)[number];

export const destinationKindSchema = z.enum(destinationKinds);

export interface SourceProvenance {
  provider?: string;
  model?: string;
  claimGenerator?: string;
  manifestDigest?: string;
  aiGenerated?: boolean;
  summary?: string;
}

export interface SourceArtifact {
  artifactId?: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  mime: string;
  manifestPath?: string;
  provenance?: SourceProvenance;
}

export interface PublishEditAction {
  action: string;
  when?: string;
  softwareAgent?: string;
  parameters?: Record<string, unknown>;
}

export interface PublishCreativeWorkMetadata {
  title?: string;
  description?: string;
  author?: string;
}

export interface PublishMetadata {
  title?: string;
  description?: string;
  tags?: string[];
  creativeWork?: PublishCreativeWorkMetadata;
  editActions?: PublishEditAction[];
  generatedByNeumaAgent?: boolean;
  aiGenerated?: boolean;
  brandedContent?: boolean;
  perDestination?: Partial<Record<DestinationKind, Record<string, unknown>>>;
}

export type VersioningMode =
  | 'provider-native'
  | 'content-addressable'
  | 'timestamped-folder'
  | 'overwrite';

export interface VersioningPolicy {
  mode: VersioningMode;
  keepRevisionForever?: boolean;
  contentAddressable?: { hashLen: number; sep: string };
  timestampedFolder?: { rootPath: string; tsFormat: 'iso' | 'epoch' };
}

export interface ReformatSpec {
  targetMime?: string;
  aspectRatio?: string;
  maxDurationSeconds?: number;
  videoCodec?: string;
  audioCodec?: string;
  container?: string;
  metadata?: Record<string, unknown>;
}

export interface DestinationConfig {
  kind: DestinationKind;
  connectionId: string;
  approvalRequired: boolean;
  idempotencyKey?: string;
  label?: string;
  versioning?: VersioningPolicy;
  reformatSpec?: ReformatSpec;
  schedule?: { runAt: string };
  target?: Record<string, unknown>;
}

export type ProvenanceState =
  | 'unchecked'
  | 'preserved'
  | 'signed'
  | 'failed'
  | 'waived';

export interface PublishJob {
  id: string;
  workspaceId: string;
  createdBy: string;
  state: JobState;
  source: SourceArtifact;
  destinations: DestinationConfig[];
  metadata: PublishMetadata;
  approval: { required: boolean; channel?: 'frontend' | 'channel' };
  idempotencyKey: string;
  provenanceState: ProvenanceState;
  signedArtifactPath?: string | null;
  manifestPath?: string | null;
  scheduledFor?: string | null;
  workflowVersion: string;
  workflowState: Record<string, unknown>;
  approvedBy?: string | null;
  approvedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DestinationCapabilities {
  supportsResumable: boolean;
  supportsVersioning: boolean;
  requiresReformat: boolean;
  maxBytes?: number;
  acceptedMimePrefixes: string[];
  approvalDefault: boolean;
  resumable?: {
    protocol: string;
    chunkAlignmentBytes?: number;
    minChunkBytes?: number;
    maxChunkBytes?: number;
    sessionTtlMs?: number;
  };
  quota?: Array<{
    kind: string;
    cost: number;
    windowMs?: number;
    limit?: number;
  }>;
}

export interface PublishLegPlan {
  destinationKind: DestinationKind;
  targetRef?: string;
  targetPath?: string;
  uploadBytes: number;
  estimatedBytes?: number;
  willReformat?: boolean;
  alreadyCurrent?: boolean;
  requiresApproval: boolean;
  quotaPreview?: Array<{ kind: string; cost: number }>;
  warnings?: string[];
  metadata?: Record<string, unknown>;
}

export interface PublishLegInput {
  jobId: string;
  legId: string;
  source: SourceArtifact;
  metadata: PublishMetadata;
  destination: DestinationConfig;
}

export interface LegContext {
  signal?: AbortSignal;
  recordChunkProgress(offset: number, etags?: string[]): void;
}

export interface UploadHandle {
  sessionId?: string;
  offsetBytes?: number;
  providerState?: Record<string, unknown>;
}

export interface PublishedRef {
  providerId: string;
  url?: string;
  revision?: string;
  versionId?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishedStatus {
  state: 'processing' | 'available' | 'failed';
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface PublishDestinationAdapter {
  kind: DestinationKind;
  capabilities(): DestinationCapabilities;
  plan(input: PublishLegInput): Promise<PublishLegPlan>;
  upload(input: PublishLegInput, ctx: LegContext): Promise<UploadHandle>;
  finalize(handle: UploadHandle, ctx: LegContext): Promise<PublishedRef>;
  queryStatus(ref: PublishedRef): Promise<PublishedStatus>;
  abort(handle: UploadHandle): Promise<void>;
}

export interface CreateJobInput {
  id?: string;
  workspaceId: string;
  createdBy: string;
  source: SourceArtifact;
  destinations: DestinationConfig[];
  metadata?: PublishMetadata;
  approval?: { required: boolean; channel?: 'frontend' | 'channel' };
  idempotencyKey?: string;
  provenanceState?: ProvenanceState;
  signedArtifactPath?: string | null;
  manifestPath?: string | null;
  scheduledFor?: string | null;
  workflowVersion?: string;
  workflowState?: Record<string, unknown>;
}

export interface JobFilter {
  workspaceId?: string;
  state?: JobState;
  limit?: number;
  offset?: number;
}

export interface DestinationLegRow {
  id: string;
  job_id: string;
  destination_kind: DestinationKind;
  destination_label: string | null;
  connection_id: string;
  idempotency_key: string;
  state: LegState;
  config_json: string;
  plan_json: string | null;
  session_id: string | null;
  chunk_offset_bytes: number;
  total_bytes: number | null;
  etags_json: string | null;
  attempts: number;
  provider_response_json: string | null;
  published_ref_json: string | null;
  error_class: string | null;
  error_message: string | null;
  next_retry_at: string | null;
  locked_by: string | null;
  lease_until: string | null;
  notification_channel_ref: string | null;
  notification_delivered_at: string | null;
  last_progress_at: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}
