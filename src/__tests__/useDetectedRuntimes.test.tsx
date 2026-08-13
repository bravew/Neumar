import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resetDetectedRuntimesCacheForTest,
  useDetectedRuntimes,
} from '@/shared/hooks/useDetectedRuntimes';
import {
  listAgentRuntimes,
  type AgentRuntimeStatus,
  type ListResponse,
} from '@/shared/lib/api/agent-runtimes';

vi.mock('@/shared/lib/api/agent-runtimes', () => ({
  listAgentRuntimes: vi.fn(),
}));

const listAgentRuntimesMock = vi.mocked(listAgentRuntimes);

afterEach(() => {
  resetDetectedRuntimesCacheForTest();
  vi.clearAllMocks();
});

describe('useDetectedRuntimes', () => {
  it('shares one runtime detection request across picker consumers', async () => {
    listAgentRuntimesMock.mockReturnValue(new Promise<ListResponse>(() => {}));

    const { unmount } = renderHook(() => {
      useDetectedRuntimes();
      useDetectedRuntimes();
    });

    await waitFor(() => expect(listAgentRuntimesMock).toHaveBeenCalledTimes(1));
    unmount();
  });

  it('aborts the in-flight detection request after the last consumer unmounts', async () => {
    let signal: AbortSignal | undefined;
    listAgentRuntimesMock.mockImplementation((nextSignal?: AbortSignal) => {
      signal = nextSignal;
      return new Promise<ListResponse>(() => {});
    });

    const { unmount } = renderHook(() => useDetectedRuntimes());

    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('publishes the fetched runtime snapshot', async () => {
    const runtime = runtimeFixture();
    listAgentRuntimesMock.mockResolvedValue(listResponse([runtime]));

    const { result } = renderHook(() => useDetectedRuntimes());

    await waitFor(() => expect(result.current).toEqual([runtime]));
  });
});

function listResponse(runtimes: AgentRuntimeStatus[]): ListResponse {
  return {
    success: true,
    runtimes,
    catalog: [],
    platform: 'darwin',
  };
}

function runtimeFixture(): AgentRuntimeStatus {
  return {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    bin: 'cursor-agent',
    available: true,
    auth: { state: 'authenticated' },
    models: [{ id: 'auto', label: 'auto' }],
    streamFormat: 'json-event-stream',
    eventParser: 'cursor-agent',
    capabilities: {
      execution: true,
      structuredStream: true,
      acp: false,
      rpc: false,
    },
  };
}
