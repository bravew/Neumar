import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeHttpMcp } from '@/shared/channels/slack/mcp/probe';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface CallSpy {
  count: number;
  bodies: Array<{ method: string; params: unknown }>;
}

function stubFetchSequence(
  responses: Array<() => Response | Promise<Response>>,
  spy: CallSpy = { count: 0, bodies: [] },
): CallSpy {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const i = spy.count;
      spy.count++;
      try {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        if (body) spy.bodies.push({ method: body.method, params: body.params });
      } catch {
        /* ignore */
      }
      const next = responses[i];
      if (!next) throw new Error(`unexpected fetch call #${i + 1}`);
      return next();
    }),
  );
  return spy;
}

const initOk = () =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        serverInfo: { name: 'test', version: '1' },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

const toolsOk = (count = 2) =>
  new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: Array.from({ length: count }, (_, i) => ({ name: `t${i}` })),
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

describe('probeHttpMcp', () => {
  it('rejects private IPs via SSRF guard', async () => {
    const r = await probeHttpMcp({ url: 'http://10.0.0.1/mcp' });
    expect(r.ok).toBe(false);
  });

  it('rejects non-HTTPS URLs (except localhost)', async () => {
    const r = await probeHttpMcp({ url: 'http://example.com/mcp' });
    expect(r.ok).toBe(false);
  });

  it('runs initialize then tools/list and returns the tool count', async () => {
    const spy = stubFetchSequence([initOk, () => toolsOk(3)]);
    const r = await probeHttpMcp({ url: 'https://example.com/mcp' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.toolCount).toBe(3);
    expect(spy.bodies.map((b) => b.method)).toEqual([
      'initialize',
      'tools/list',
    ]);
  });

  it('reports HTTP 401 from initialize with an auth-header hint', async () => {
    stubFetchSequence([() => new Response('forbidden', { status: 401 })]);
    const r = await probeHttpMcp({
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/auth header/);
  });

  it('soft-passes when tools/list rejects with -32002 (server not initialized)', async () => {
    stubFetchSequence([
      initOk,
      () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32002, message: 'Server not initialized' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ]);
    const r = await probeHttpMcp({ url: 'https://example.com/mcp' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.toolCount).toBeNull();
  });

  it('parses an SSE first-frame initialize response', async () => {
    const sseInit = `data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}\n\n`;
    stubFetchSequence([
      () =>
        new Response(sseInit, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      () => toolsOk(1),
    ]);
    const r = await probeHttpMcp({ url: 'https://example.com/mcp' });
    expect(r.ok).toBe(true);
  });

  it('treats network errors during initialize as a probe failure', async () => {
    stubFetchSequence([
      () => {
        throw new Error('boom');
      },
    ]);
    const r = await probeHttpMcp({ url: 'https://example.com/mcp' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/could not reach/);
  });

  it('reports JSON-RPC errors from initialize verbatim', async () => {
    stubFetchSequence([
      () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32601, message: 'Method not found' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ]);
    const r = await probeHttpMcp({ url: 'https://example.com/mcp' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Method not found/);
  });
});
