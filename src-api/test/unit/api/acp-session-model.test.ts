import { describe, expect, it } from 'vitest';

import { applyAcpSessionModel, type AcpSession } from '@/app/api/acp';

function session(overrides: Partial<AcpSession> = {}): AcpSession {
  return {
    id: 'session-1',
    mode: 'default',
    modelId: null,
    identityId: 'user-1',
    ...overrides,
  };
}

describe('ACP session model state', () => {
  it('stores session/set_model modelId on the session', () => {
    const current = session();

    const result = applyAcpSessionModel(
      current,
      { modelId: 'anthropic/claude-sonnet-4-6' },
      1,
    );

    expect(result).toEqual({
      ok: true,
      modelId: 'anthropic/claude-sonnet-4-6',
    });
    expect(current.modelId).toBe('anthropic/claude-sonnet-4-6');
  });

  it('treats default as the session default model', () => {
    const current = session({ modelId: 'openai/gpt-5' });

    const result = applyAcpSessionModel(current, { modelId: 'default' }, 2);

    expect(result).toEqual({ ok: true, modelId: null });
    expect(current.modelId).toBeNull();
  });

  it('rejects missing model params with -32602', () => {
    const current = session();

    const result = applyAcpSessionModel(current, { modelId: '   ' }, 3);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      error: {
        code: -32602,
        message: 'Invalid params: modelId required',
      },
    });
    expect(current.modelId).toBeNull();
  });
});
