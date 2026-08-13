import { afterEach, describe, expect, it, vi } from 'vitest';

import { kimiPlugin } from '@/extensions/agent/kimi';
import { AcpRuntimeClient } from '@/extensions/agent/shared/acp';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Kimi ACP model discovery', () => {
  it('returns models negotiated for a fresh ACP session and closes the client', async () => {
    const close = vi.fn();
    vi.spyOn(AcpRuntimeClient, 'connect').mockResolvedValue({
      createOrLoadSession: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        loaded: false,
        needsTranscriptReseed: false,
        models: [
          { modelId: 'kimi-k2', name: 'Kimi K2' },
          { modelId: 'kimi-k2-fast', name: 'Kimi K2 Fast' },
        ],
      }),
      close,
    } as unknown as AcpRuntimeClient);

    await expect(
      kimiPlugin.listModels?.({
        provider: 'kimi',
        workDir: process.cwd(),
        providerConfig: { binaryPath: process.execPath },
      }),
    ).resolves.toEqual([
      { id: 'kimi-k2', label: 'Kimi K2' },
      { id: 'kimi-k2-fast', label: 'Kimi K2 Fast' },
    ]);
    expect(close).toHaveBeenCalledOnce();
  });
});
