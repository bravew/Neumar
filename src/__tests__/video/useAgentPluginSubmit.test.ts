import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentPluginSubmit } from '@/components/video/useAgentPluginSubmit';
import type { VideoPluginSummary } from '@/shared/hooks/useVideoPlugins';

const applyVideoPlugin = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/shared/hooks/useVideoPlugins', () => ({ applyVideoPlugin }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

const labels = {
  applyFailed: 'Plugin failed: {error}',
  applyNetworkError: 'Could not reach the server.',
  retry: 'Retry',
  reviewConfirm: 'Review {plugin}?',
};

const plugin = {
  id: 'event-recap',
  title: 'Event Recap',
  requiresReview: false,
  impliedCapabilities: [],
  manifestDigest: 'digest',
} as unknown as VideoPluginSummary;

type AppendText = (role: 'assistant' | 'system', content: string) => void;

function renderSubmit(appendText: AppendText) {
  return renderHook(() =>
    useAgentPluginSubmit({
      activeStep: 'brief',
      appendText,
      aspectRatio: '16:9',
      assetContextAssets: [],
      labels,
      selectedScene: null,
      sendMessage: vi.fn(),
    }),
  );
}

describe('useAgentPluginSubmit error handling', () => {
  beforeEach(() => {
    applyVideoPlugin.mockReset();
    toastError.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('routes a transient network failure to a retry toast, not the conversation', async () => {
    applyVideoPlugin.mockRejectedValue(new TypeError('Failed to fetch'));
    const appendText = vi.fn();
    const { result } = renderSubmit(appendText);

    await act(async () => {
      await result.current(plugin);
    });

    expect(toastError).toHaveBeenCalledWith(
      'Could not reach the server.',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'Retry' }),
      }),
    );
    expect(appendText).not.toHaveBeenCalled();
  });

  it('persists a real apply failure into the conversation', async () => {
    applyVideoPlugin.mockRejectedValue(new Error('HTTP 400'));
    const appendText = vi.fn();
    const { result } = renderSubmit(appendText);

    await act(async () => {
      await result.current(plugin);
    });

    expect(appendText).toHaveBeenCalledWith(
      'system',
      'Plugin failed: HTTP 400',
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('retries the same plugin when the toast action fires', async () => {
    applyVideoPlugin.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderSubmit(vi.fn());

    await act(async () => {
      await result.current(plugin);
    });

    const action = toastError.mock.calls[0]?.[1]?.action;
    expect(action?.label).toBe('Retry');

    applyVideoPlugin.mockClear();
    await act(async () => {
      action?.onClick?.();
    });
    expect(applyVideoPlugin).toHaveBeenCalledWith('event-recap', {});
  });
});
