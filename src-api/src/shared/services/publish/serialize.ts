import type { PublishDestinationLegRow } from '@/shared/db/types';

import type { LegState } from './state-machine';
import type {
  DestinationConfig,
  DestinationKind,
  PublishedRef,
  PublishJob,
  PublishLegPlan,
} from './types';
import { destinationKindSchema } from './types';

export interface PublishLegSnapshot {
  id: string;
  jobId: string;
  destinationKind: DestinationKind;
  destinationLabel?: string;
  connectionId: string;
  state: LegState;
  approvalRequired: boolean;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  chunkOffsetBytes: number;
  totalBytes?: number;
  attempts: number;
  plan?: PublishLegPlan;
  publishedRef?: PublishedRef;
  errorClass?: string;
  errorMessage?: string;
  nextRetryAt?: string;
  sessionId?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishJobSnapshot {
  job: PublishJob;
  legs: PublishLegSnapshot[];
}

export function serializePublishSnapshot(
  job: PublishJob,
  legs: PublishDestinationLegRow[],
): PublishJobSnapshot {
  return {
    job,
    legs: legs.map(serializePublishLeg),
  };
}

export function serializePublishLeg(
  row: PublishDestinationLegRow,
): PublishLegSnapshot {
  const config = parseJson<DestinationConfig>(row.config_json, {
    kind: destinationKindSchema.parse(row.destination_kind),
    connectionId: row.connection_id,
    approvalRequired: false,
  });
  return {
    id: row.id,
    jobId: row.job_id,
    destinationKind: destinationKindSchema.parse(row.destination_kind),
    destinationLabel: row.destination_label ?? undefined,
    connectionId: row.connection_id,
    state: row.state as LegState,
    approvalRequired:
      Boolean(row.approval_required) || config.approvalRequired === true,
    approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
    chunkOffsetBytes: row.chunk_offset_bytes,
    totalBytes: row.total_bytes ?? undefined,
    attempts: row.attempts,
    plan: parseJson<PublishLegPlan | undefined>(row.plan_json, undefined),
    publishedRef: parseJson<PublishedRef | undefined>(
      row.published_ref_json,
      undefined,
    ),
    errorClass: row.error_class ?? undefined,
    errorMessage: row.error_message ?? undefined,
    nextRetryAt: row.next_retry_at ?? undefined,
    sessionId: row.session_id ?? undefined,
    publishedAt: row.published_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
