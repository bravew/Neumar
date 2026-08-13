import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentPluginPicker } from '@/components/video/AgentPluginPicker';
import {
  applyVideoPlugin,
  type VideoPluginSummary,
} from '@/shared/hooks/useVideoPlugins';

const hookState = vi.hoisted(() => ({
  plugins: [] as VideoPluginSummary[],
  loading: false,
  error: null as string | null,
}));

vi.mock('@/shared/hooks/useVideoPlugins', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/hooks/useVideoPlugins')
  >('@/shared/hooks/useVideoPlugins');
  return {
    ...actual,
    useVideoPlugins: () => ({
      plugins: hookState.plugins,
      loading: hookState.loading,
      error: hookState.error,
    }),
  };
});

const labels = {
  title: 'Plugins',
  loading: 'Loading plugins...',
  empty: 'No video plugins yet.',
  use: 'Use plugin',
  reviewRequired: 'Review',
  reviewConfirm: 'Review {plugin}?',
  capabilities: '{count} capabilities',
  applyFailed: 'Plugin failed: {error}',
  applyNetworkError: 'Could not reach the server.',
  retry: 'Retry',
};

afterEach(() => {
  hookState.plugins = [];
  hookState.loading = false;
  hookState.error = null;
  vi.unstubAllGlobals();
});

describe('AgentPluginPicker', () => {
  it('renders plugin cards and selects a plugin', () => {
    const plugin = pluginSummary({ requiresReview: false });
    hookState.plugins = [plugin];
    const onSelect = vi.fn();

    render(
      <AgentPluginPicker
        labels={labels}
        disabled={false}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /social reel/i }));

    expect(screen.getByText('Plugins')).toBeInTheDocument();
    expect(screen.getByText(/shorts \/ html/)).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith(plugin);
  });

  it('marks restricted plugins that need capability review', () => {
    hookState.plugins = [pluginSummary({ requiresReview: true })];

    render(
      <AgentPluginPicker labels={labels} disabled={false} onSelect={vi.fn()} />,
    );

    expect(screen.getByLabelText('Review')).toBeInTheDocument();
  });

  it('hydrates apply requests with reviewed capability approval', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        plugin: pluginSummary({ requiresReview: false }),
        prompt: 'Make a social reel about launch.',
        gate: {
          restricted: false,
          grants: [],
          requestedCapabilities: ['prompt:inject'],
          grantedCapabilities: ['prompt:inject'],
          deniedCapabilities: [],
          requiresReview: false,
          promptGuideIncluded: true,
        },
        context: {
          pluginId: 'social-reel',
          pluginInputs: { topic: 'launch' },
          approvedPluginCapabilities: ['prompt:inject'],
          lastReviewedPluginDigest: 'digest',
          pluginSignatureOk: true,
        },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await applyVideoPlugin('social-reel', {
      inputs: { topic: 'launch' },
      approvedCapabilities: ['prompt:inject'],
      lastReviewedDigest: 'digest',
      signatureOk: null,
    });

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [, init] = firstCall as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      inputs: { topic: 'launch' },
      approvedCapabilities: ['prompt:inject'],
      lastReviewedDigest: 'digest',
      signatureOk: null,
    });
  });
});

function pluginSummary(
  overrides: Partial<VideoPluginSummary>,
): VideoPluginSummary {
  return {
    id: 'social-reel',
    name: 'social-reel',
    title: 'Social Reel',
    version: '1.0.0',
    description: 'Create a concise vertical social reel.',
    sourceScope: 'local',
    trustTier: 'local',
    manifestDigest: 'digest',
    engine: { id: 'html' },
    mode: 'shorts',
    kind: 'flow',
    aspectRatios: ['9:16'],
    tags: ['shorts'],
    capabilities: ['prompt:inject'],
    impliedCapabilities: ['prompt:inject'],
    restricted: Boolean(overrides.requiresReview),
    deniedCapabilities: [],
    requiresReview: false,
    suggestedPrompt: 'Make a social reel about this project.',
    score: 10,
    ...overrides,
  };
}
