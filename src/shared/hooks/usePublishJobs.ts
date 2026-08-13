import { useCallback, useEffect, useMemo, useState } from 'react';

import { API_BASE_URL } from '@/config';

export interface PublishSourceArtifact {
  artifactId?: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  mime: string;
  manifestPath?: string;
}

export interface PublishDestinationInput {
  kind: string;
  connectionId: string;
  approvalRequired: boolean;
  label?: string;
  versioning?: Record<string, unknown>;
  schedule?: { runAt: string };
  target?: Record<string, unknown>;
}

export interface PublishMetadataInput {
  title?: string;
  description?: string;
  tags?: string[];
  [key: string]: unknown;
}

export interface PublishJob {
  id: string;
  workspaceId: string;
  createdBy: string;
  state: string;
  source: PublishSourceArtifact;
  metadata: PublishMetadataInput;
  destinations: PublishDestinationInput[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface PublishLeg {
  id: string;
  jobId: string;
  destinationKind: string;
  destinationLabel?: string;
  connectionId: string;
  state: string;
  approvalRequired: boolean;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  chunkOffsetBytes: number;
  totalBytes?: number;
  errorClass?: string;
  errorMessage?: string;
  nextRetryAt?: string;
  publishedRef?: { providerId: string; url?: string };
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishJobSnapshot {
  job: PublishJob;
  legs: PublishLeg[];
}

export interface PublishDestinationOption {
  kind: string;
  connectionId?: string;
  label?: string;
  capabilities: {
    approvalDefault?: boolean;
    supportsResumable?: boolean;
    supportsVersioning?: boolean;
    acceptedMimePrefixes?: string[];
  };
}

export function publishDestinationOptionId(
  destination: PublishDestinationOption,
): string {
  return `${destination.kind}:${destination.connectionId ?? destination.kind}`;
}

export interface UsePublishJobsFilter {
  workspaceId?: string;
  state?: string;
}

export interface CreatePublishJobInput {
  workspaceId: string;
  createdBy: string;
  source: PublishSourceArtifact;
  destinations: PublishDestinationInput[];
  metadata?: PublishMetadataInput;
}

export function usePublishJobs(filter: UsePublishJobsFilter = {}) {
  const [jobs, setJobs] = useState<PublishJobSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filter.workspaceId) params.set('workspaceId', filter.workspaceId);
    if (filter.state) params.set('state', filter.state);
    return params.toString();
  }, [filter.workspaceId, filter.state]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const suffix = query ? `?${query}` : '';
        const res = await fetch(`${API_BASE_URL}/publish/jobs${suffix}`, {
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { items: PublishJobSnapshot[] };
        if (!signal?.aborted) setJobs(body.items ?? []);
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const createJob = useCallback(async (input: CreatePublishJobInput) => {
    const res = await fetch(`${API_BASE_URL}/publish/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snapshot = (await res.json()) as PublishJobSnapshot;
    setJobs((prev) => [
      snapshot,
      ...prev.filter((item) => item.job.id !== snapshot.job.id),
    ]);
    return snapshot;
  }, []);

  const updateLeg = useCallback(
    async (
      legId: string,
      action: 'approve' | 'reject' | 'reschedule',
      body: Record<string, unknown>,
    ) => {
      const res = await fetch(
        `${API_BASE_URL}/publish/legs/${legId}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { leg: PublishLeg };
      setJobs((prev) => replaceLeg(prev, data.leg));
      return data.leg;
    },
    [],
  );

  const cancelJob = useCallback(async (jobId: string) => {
    const res = await fetch(`${API_BASE_URL}/publish/jobs/${jobId}/cancel`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snapshot = (await res.json()) as PublishJobSnapshot;
    setJobs((prev) =>
      prev.map((item) => (item.job.id === jobId ? snapshot : item)),
    );
    return snapshot;
  }, []);

  return {
    jobs,
    loading,
    error,
    reload: load,
    createJob,
    cancelJob,
    approveLeg: (legId: string, by = 'human:desktop') =>
      updateLeg(legId, 'approve', { by }),
    rejectLeg: (legId: string, reason: string, by = 'human:desktop') =>
      updateLeg(legId, 'reject', { by, reason }),
    rescheduleLeg: (legId: string, runAt: string) =>
      updateLeg(legId, 'reschedule', { runAt }),
  };
}

function replaceLeg(
  jobs: PublishJobSnapshot[],
  leg: PublishLeg,
): PublishJobSnapshot[] {
  return jobs.map((snapshot) =>
    snapshot.job.id === leg.jobId
      ? {
          ...snapshot,
          legs: snapshot.legs.map((candidate) =>
            candidate.id === leg.id ? leg : candidate,
          ),
        }
      : snapshot,
  );
}
