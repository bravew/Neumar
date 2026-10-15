import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Policy boundary for the OAuth discovery/registration/token requests.
 *
 * Every target in that flow comes from server-supplied metadata, so each one
 * must go through `safeFetch` with a resolved-address policy. The one local
 * exception is the server the user configured, and only for its own origin:
 * metadata that points at loopback, or a redirect that lands there, is a
 * public integration reaching inward and must stay on the external policy.
 *
 * `safeFetch` is mocked so the assertions are about the policy and options the
 * flow chooses, not about a live network.
 */
const mocks = vi.hoisted(() => ({ safeFetch: vi.fn() }));

vi.mock('@/shared/network-policy/fetch', () => ({
  NetworkPolicyDenied: class NetworkPolicyDenied extends Error {
    readonly reason: string;
    readonly url: string;
    constructor(url: string, reason: string) {
      super(`Network policy denied ${url}: ${reason}`);
      this.name = 'NetworkPolicyDenied';
      this.reason = reason;
      this.url = url;
    }
  },
  safeFetch: mocks.safeFetch,
}));

const LOCAL_POLICY = { id: 'trusted-local' };
const EXTERNAL_POLICY = { id: 'external-api' };

vi.mock('@/shared/network-policy/schema', () => ({
  trustedLocalPolicy: () => LOCAL_POLICY,
  externalApiPolicy: () => EXTERNAL_POLICY,
}));

vi.mock('@/shared/mcp/external-client/tokens', () => ({
  saveExternalMcpTokens: vi.fn(),
}));

const { initiateMcpOAuth } = await import('@/shared/mcp/remote-oauth');

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(body)),
    finalUrl: 'https://example.test/',
    redirectChain: ['https://example.test/'],
  };
}

describe('MCP OAuth network policy', () => {
  beforeEach(() => {
    mocks.safeFetch.mockReset();
    mocks.safeFetch.mockResolvedValue(jsonResponse({}, 404));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the external policy to a public server', async () => {
    await expect(
      initiateMcpOAuth('test-server', 'https://mcp.example.test', 'Test App'),
    ).rejects.toThrow();

    expect(mocks.safeFetch).toHaveBeenCalled();
    for (const call of mocks.safeFetch.mock.calls) {
      expect(call[1]).toBe(EXTERNAL_POLICY);
      expect(call[2]).toMatchObject({
        maxRedirects: 0,
        maxBytes: expect.any(Number),
        timeoutMs: expect.any(Number),
      });
    }
  });

  it('uses the local policy only for the configured loopback origin', async () => {
    mocks.safeFetch.mockImplementation(async (url: string) => {
      if (url.includes('oauth-protected-resource')) {
        // The server advertises a metadata document that points inward.
        return jsonResponse({
          authorization_servers: ['http://localhost:9/evil'],
        });
      }
      return jsonResponse({}, 404);
    });

    await expect(
      initiateMcpOAuth('test-server', 'http://localhost:9', 'Test App'),
    ).rejects.toThrow();

    const byUrl = new Map(
      mocks.safeFetch.mock.calls.map((call) => [String(call[0]), call[1]]),
    );
    // The configured server itself is local.
    expect(
      byUrl.get('http://localhost:9/.well-known/oauth-protected-resource'),
    ).toBe(LOCAL_POLICY);
    // A different loopback origin named by that metadata is not.
    for (const [url, policy] of byUrl) {
      if (url.startsWith('http://localhost:9/evil')) {
        expect(policy).toBe(EXTERNAL_POLICY);
      }
    }
  });

  it('recognises a bracketed IPv6 loopback server as local', async () => {
    await expect(
      initiateMcpOAuth('test-server', 'http://[::1]:9', 'Test App'),
    ).rejects.toThrow();

    expect(mocks.safeFetch.mock.calls.length).toBeGreaterThan(0);
    expect(mocks.safeFetch.mock.calls[0]![1]).toBe(LOCAL_POLICY);
  });
});
