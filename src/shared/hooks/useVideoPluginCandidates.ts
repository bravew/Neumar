import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

export interface VideoPluginCandidate {
  id: string;
  domain: 'video';
  pluginId?: string;
  projectId: string;
  sessionId?: string;
  title: string;
  description: string;
  confidence: number;
  status: 'active' | 'dismissed' | 'saved';
  manifestDigest?: string;
  draftManifestPath?: string;
  savedPluginId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveVideoPluginCandidateInput {
  title?: string;
  description?: string;
  tags?: string[];
  scope?: 'project' | 'user';
}

export interface SaveVideoPluginCandidateResponse {
  candidate: VideoPluginCandidate;
  plugin: {
    id: string;
    name: string;
    version: string;
    trustTier: string | null;
    manifestDigest: string | null;
  };
  pluginDir: string;
  manifestPath: string;
  videoManifestPath: string;
}

interface VideoPluginCandidatesState {
  candidates: VideoPluginCandidate[];
  loading: boolean;
  error: string | null;
}

export function useVideoPluginCandidates(
  projectId: string,
  enabled: boolean,
): VideoPluginCandidatesState {
  const [state, setState] = useState<VideoPluginCandidatesState>({
    candidates: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !projectId) {
      setState({ candidates: [], loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    async function loadCandidates() {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const params = new URLSearchParams({
          projectId,
          status: 'active',
        });
        const response = await fetch(
          `${API_BASE_URL}/video/plugins/candidates?${params.toString()}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as {
          candidates?: VideoPluginCandidate[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        setState({
          candidates: Array.isArray(payload.candidates)
            ? payload.candidates
            : [],
          loading: false,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          candidates: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void loadCandidates();
    return () => {
      controller.abort();
    };
  }, [enabled, projectId]);

  return state;
}

export async function saveVideoPluginCandidate(
  candidateId: string,
  input: SaveVideoPluginCandidateInput,
): Promise<SaveVideoPluginCandidateResponse> {
  const response = await fetch(
    `${API_BASE_URL}/video/plugins/candidates/${encodeURIComponent(
      candidateId,
    )}/save`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  return readCandidateResponse(response);
}

export async function dismissVideoPluginCandidate(
  candidateId: string,
): Promise<VideoPluginCandidate> {
  const response = await fetch(
    `${API_BASE_URL}/video/plugins/candidates/${encodeURIComponent(
      candidateId,
    )}/dismiss`,
    { method: 'POST' },
  );
  const payload = (await response.json()) as
    | { candidate: VideoPluginCandidate }
    | { error?: string };
  if (!response.ok) {
    throw new Error(
      'error' in payload && payload.error
        ? payload.error
        : `HTTP ${response.status}`,
    );
  }
  if (!('candidate' in payload)) throw new Error('Invalid candidate response');
  return payload.candidate;
}

async function readCandidateResponse(
  response: Response,
): Promise<SaveVideoPluginCandidateResponse> {
  const payload = (await response.json()) as
    | SaveVideoPluginCandidateResponse
    | { error?: string };
  if (!response.ok) {
    throw new Error(
      'error' in payload && payload.error
        ? payload.error
        : `HTTP ${response.status}`,
    );
  }
  if (!('candidate' in payload)) throw new Error('Invalid candidate response');
  return payload;
}
