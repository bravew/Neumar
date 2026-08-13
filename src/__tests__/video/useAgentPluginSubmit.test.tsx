import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAgentPluginSubmit } from '@/components/video/useAgentPluginSubmit';
import {
  applyVideoPlugin,
  type VideoPluginSummary,
} from '@/shared/hooks/useVideoPlugins';

vi.mock('@/shared/hooks/useVideoPlugins', () => ({
  applyVideoPlugin: vi.fn(),
}));

const applyVideoPluginMock = vi.mocked(applyVideoPlugin);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useAgentPluginSubmit', () => {
  it('reviews declared capabilities for restricted plugin runs', async () => {
    const sendMessage = vi.fn(async () => {});
    const appendText = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    applyVideoPluginMock.mockResolvedValue({
      plugin: pluginSummary(),
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
    });

    const { result } = renderHook(() =>
      useAgentPluginSubmit({
        activeStep: 'board',
        appendText,
        aspectRatio: '9:16',
        assetContextAssets: [],
        editorSelection: undefined,
        labels: {
          applyFailed: 'Plugin failed: {error}',
          reviewConfirm: 'Review {plugin}?',
        },
        selectedScene: null,
        sendMessage,
        transcriptSelection: null,
      }),
    );

    await act(async () => {
      await result.current(pluginSummary());
    });

    expect(applyVideoPluginMock).toHaveBeenCalledWith('social-reel', {
      approvedCapabilities: ['prompt:inject', 'network:youtube'],
      lastReviewedDigest: 'digest',
      signatureOk: null,
    });
    expect(sendMessage).toHaveBeenCalledWith(
      '@plugin:social-reel\n\nMake a social reel about launch.',
      expect.objectContaining({
        pluginId: 'social-reel',
        approvedPluginCapabilities: ['prompt:inject'],
      }),
    );
  });
});

function pluginSummary(): VideoPluginSummary {
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
    capabilities: ['prompt:inject', 'network:youtube'],
    impliedCapabilities: ['prompt:inject'],
    restricted: true,
    deniedCapabilities: ['prompt:inject'],
    requiresReview: true,
    suggestedPrompt: 'Make a social reel about this project.',
    score: 10,
  };
}
