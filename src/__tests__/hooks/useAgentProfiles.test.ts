/**
 * useAgentProfiles hook tests.
 *
 * Tests fetch, caching, and refresh behavior.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config', () => ({
  API_BASE_URL: 'http://localhost:5126',
}));

const mockProfiles = [
  {
    id: 'prof-1',
    name: 'Research Agent',
    status: 'active',
    model: 'claude-3-5-sonnet',
  },
  {
    id: 'prof-2',
    name: 'Code Agent',
    status: 'active',
    model: 'claude-3-5-sonnet',
  },
];

describe('useAgentProfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockProfiles),
    });
  });

  it('fetches profiles on mount', async () => {
    const { useAgentProfiles } =
      await import('@/shared/hooks/useAgentProfiles');
    const { result } = renderHook(() => useAgentProfiles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles).toHaveLength(2);
    expect(result.current.profiles[0]?.name).toBe('Research Agent');
  });

  it('fetches with status filter', async () => {
    const { useAgentProfiles } =
      await import('@/shared/hooks/useAgentProfiles');
    renderHook(() => useAgentProfiles('paused'));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('status=paused'),
        expect.anything(),
      ),
    );
  });

  it('exposes refresh function', async () => {
    const { useAgentProfiles } =
      await import('@/shared/hooks/useAgentProfiles');
    const { result } = renderHook(() => useAgentProfiles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(typeof result.current.refresh).toBe('function');
  });

  it('handles fetch errors gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { useAgentProfiles } =
      await import('@/shared/hooks/useAgentProfiles');
    const { result } = renderHook(() => useAgentProfiles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Should not crash — profiles should be empty or cached
  });
});
