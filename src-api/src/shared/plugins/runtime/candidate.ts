import { randomUUID } from 'node:crypto';

import type { AppliedSnapshot } from './snapshot';

export type PluginCandidateStatus = 'active' | 'dismissed' | 'saved';

export interface PluginCandidate<TSnapshotPayload = unknown> {
  id: string;
  domain: string;
  projectId: string;
  sessionId?: string;
  title: string;
  description: string;
  confidence: number;
  status: PluginCandidateStatus;
  appliedSnapshot: AppliedSnapshot<TSnapshotPayload>;
  manifestDigest?: string;
  draftManifestPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePluginCandidateInput<TSnapshotPayload> {
  domain: string;
  projectId: string;
  sessionId?: string;
  title: string;
  description: string;
  confidence: number;
  appliedSnapshot: AppliedSnapshot<TSnapshotPayload>;
  manifestDigest?: string;
  draftManifestPath?: string;
  now?: string;
}

export interface CandidateDetector<TContext, TSnapshotPayload = unknown> {
  detect(
    context: TContext,
  ):
    | PluginCandidate<TSnapshotPayload>
    | Promise<PluginCandidate<TSnapshotPayload> | null>
    | null;
}

export function createPluginCandidate<TSnapshotPayload>(
  input: CreatePluginCandidateInput<TSnapshotPayload>,
): PluginCandidate<TSnapshotPayload> {
  const now = input.now ?? new Date().toISOString();
  return {
    id: randomUUID(),
    domain: input.domain,
    projectId: input.projectId,
    sessionId: input.sessionId,
    title: input.title,
    description: input.description,
    confidence: clampConfidence(input.confidence),
    status: 'active',
    appliedSnapshot: input.appliedSnapshot,
    manifestDigest: input.manifestDigest,
    draftManifestPath: input.draftManifestPath,
    createdAt: now,
    updatedAt: now,
  };
}

export function updatePluginCandidateStatus<TSnapshotPayload>(
  candidate: PluginCandidate<TSnapshotPayload>,
  status: PluginCandidateStatus,
  now: string = new Date().toISOString(),
): PluginCandidate<TSnapshotPayload> {
  return { ...candidate, status, updatedAt: now };
}

function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence));
}
