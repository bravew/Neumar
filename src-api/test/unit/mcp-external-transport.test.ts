import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSafeFetch = vi.fn();

vi.mock('@/shared/network-policy/fetch', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));

vi.mock('@/shared/network-policy/schema', () => ({
  trustedLocalPolicy: () => ({ version: 1, default: 'allow' }),
}));

describe('external MCP transport', () => {
  beforeEach(() => {
    mockSafeFetch.mockReset();
  });

  it('lists tools through a bounded JSON-RPC request', async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 200,
      body: Buffer.from(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: { tools: [{ name: 'get_context' }] },
        }),
      ),
    });
    const { listExternalMcpTools } =
      await import('@/shared/mcp/external-client/transport');

    const tools = await listExternalMcpTools({
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    });

    expect(tools).toEqual([{ name: 'get_context' }]);
    expect(mockSafeFetch).toHaveBeenCalledWith(
      'https://mcp.example.com/mcp',
      { version: 1, default: 'allow' },
      expect.objectContaining({
        method: 'POST',
        timeoutMs: 10_000,
        maxRedirects: 2,
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          Accept: 'application/json, text/event-stream',
        }),
      }),
    );
    const request = JSON.parse(
      (mockSafeFetch.mock.calls[0]?.[2] as { body: string }).body,
    ) as { method: string; params: unknown };
    expect(request.method).toBe('tools/list');
    expect(request.params).toEqual({});
  });

  it('accepts SSE first-frame responses', async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 200,
      body: Buffer.from(
        'event: message\n' +
          'data: {"jsonrpc":"2.0","id":"1","result":{"tools":[{"name":"draw"}]}}\n\n',
      ),
    });
    const { listExternalMcpTools } =
      await import('@/shared/mcp/external-client/transport');

    await expect(
      listExternalMcpTools({ url: 'https://mcp.example.com/mcp' }),
    ).resolves.toEqual([{ name: 'draw' }]);
  });

  it('maps auth failures without exposing header values', async () => {
    mockSafeFetch.mockResolvedValueOnce({
      status: 401,
      body: Buffer.from('invalid token: Bearer token'),
    });
    const { ExternalMcpTransportError, callExternalMcpTool } =
      await import('@/shared/mcp/external-client/transport');

    await expect(
      callExternalMcpTool(
        {
          url: 'https://mcp.example.com/mcp',
          headers: { Authorization: 'Bearer token' },
        },
        'get_context',
        {},
      ),
    ).rejects.toMatchObject({
      code: 'auth_required',
      status: 401,
      message: 'MCP server requires authentication',
    } satisfies Partial<ExternalMcpTransportError>);
  });

  it('rejects oversized tool call payloads before network egress', async () => {
    const { callExternalMcpTool } =
      await import('@/shared/mcp/external-client/transport');
    mockSafeFetch.mockClear();

    await expect(
      callExternalMcpTool({ url: 'https://mcp.example.com/mcp' }, 'huge', {
        text: 'x'.repeat(8 * 1024 * 1024),
      }),
    ).rejects.toMatchObject({
      code: 'payload_too_large',
      status: 413,
    });
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });
});
