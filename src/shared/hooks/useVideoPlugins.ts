import { useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

export interface VideoPluginSummary {
  id: string;
  name: string;
  title: string;
  version: string;
  description: string;
  sourceScope: string;
  trustTier: string;
  manifestDigest: string;
  engine: { id: string; templateRef?: unknown };
  mode: string;
  kind: string;
  aspectRatios: string[];
  tags: string[];
  capabilities: string[];
  impliedCapabilities: string[];
  restricted: boolean;
  deniedCapabilities: string[];
  requiresReview: boolean;
  suggestedPrompt: string;
  score: number;
}

export interface VideoPluginApplyContext {
  pluginId: string;
  pluginInputs: Record<string, unknown>;
  approvedPluginCapabilities: string[];
  lastReviewedPluginDigest: string | null;
  pluginSignatureOk: boolean | null;
}

export interface VideoPluginApplyResponse {
  plugin: VideoPluginSummary;
  prompt: string;
  gate: {
    restricted: boolean;
    grants: unknown[];
    requestedCapabilities: string[];
    grantedCapabilities: string[];
    deniedCapabilities: string[];
    requiresReview: boolean;
    promptGuideIncluded: boolean;
  };
  context: VideoPluginApplyContext;
}

export interface VideoPluginApplyRequest {
  inputs?: Record<string, unknown>;
  approvedCapabilities?: string[];
  lastReviewedDigest?: string | null;
  signatureOk?: boolean | null;
}

interface VideoPluginsState {
  plugins: VideoPluginSummary[];
  loading: boolean;
  error: string | null;
}

export function useVideoPlugins(query = ''): VideoPluginsState {
  const [state, setState] = useState<VideoPluginsState>({
    plugins: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadPlugins() {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set('query', query.trim());
        const suffix = params.size > 0 ? `?${params.toString()}` : '';
        const response = await fetch(`${API_BASE_URL}/video/plugins${suffix}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          plugins?: VideoPluginSummary[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || `HTTP ${response.status}`);
        }
        setState({
          plugins: Array.isArray(payload.plugins) ? payload.plugins : [],
          loading: false,
          error: null,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          plugins: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void loadPlugins();

    return () => {
      controller.abort();
    };
  }, [query]);

  return state;
}

export async function applyVideoPlugin(
  pluginId: string,
  request: VideoPluginApplyRequest = {},
): Promise<VideoPluginApplyResponse> {
  const response = await fetch(
    `${API_BASE_URL}/video/plugins/${encodeURIComponent(pluginId)}/apply`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  );
  const payload = (await response.json()) as
    | VideoPluginApplyResponse
    | { error?: string };
  if (!response.ok) {
    throw new Error(
      'error' in payload && payload.error
        ? payload.error
        : `HTTP ${response.status}`,
    );
  }
  return payload as VideoPluginApplyResponse;
}
