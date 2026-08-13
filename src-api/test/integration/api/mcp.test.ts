import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

// ---- Mock heavy dependencies ----

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockReadFile = vi
  .fn()
  .mockResolvedValue(JSON.stringify({ mcpServers: {} }));
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockAccess = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    access: (...args: unknown[]) => mockAccess(...args),
  },
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  access: (...args: unknown[]) => mockAccess(...args),
}));

const mockInitiateMcpOAuth = vi.fn().mockResolvedValue({
  authUrl: 'https://auth.example.com/authorize?state=abc',
  state: 'abc',
  redirectUri: 'http://127.0.0.1:1234/callback',
});
const mockGetFlowStatus = vi.fn().mockReturnValue({
  status: 'pending',
  serverName: 'test-server',
});
const transportMocks = vi.hoisted(() => {
  class ExternalMcpTransportError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly code: string,
    ) {
      super(message);
      this.name = 'ExternalMcpTransportError';
    }
  }
  return {
    ExternalMcpTransportError,
    listExternalMcpTools: vi.fn(),
    callExternalMcpTool: vi.fn(),
  };
});
const tokenMocks = vi.hoisted(() => {
  class ExternalMcpTokenError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ExternalMcpTokenError';
    }
  }
  return {
    ExternalMcpTokenError,
    getExternalMcpAuthorizationHeader: vi.fn(),
    getExternalMcpTokenMetadata: vi.fn(),
    removeExternalMcpTokens: vi.fn(),
  };
});

vi.mock('@/shared/mcp/remote-oauth', () => ({
  initiateMcpOAuth: (...args: unknown[]) => mockInitiateMcpOAuth(...args),
  getFlowStatus: (...args: unknown[]) => mockGetFlowStatus(...args),
}));

vi.mock('@/shared/mcp/external-client/transport', () => ({
  ExternalMcpTransportError: transportMocks.ExternalMcpTransportError,
  listExternalMcpTools: (...args: unknown[]) =>
    transportMocks.listExternalMcpTools(...args),
  callExternalMcpTool: (...args: unknown[]) =>
    transportMocks.callExternalMcpTool(...args),
}));

vi.mock('@/shared/mcp/external-client/tokens', () => ({
  ExternalMcpTokenError: tokenMocks.ExternalMcpTokenError,
  getExternalMcpAuthorizationHeader: (...args: unknown[]) =>
    tokenMocks.getExternalMcpAuthorizationHeader(...args),
  getExternalMcpTokenMetadata: (...args: unknown[]) =>
    tokenMocks.getExternalMcpTokenMetadata(...args),
  removeExternalMcpTokens: (...args: unknown[]) =>
    tokenMocks.removeExternalMcpTokens(...args),
}));

vi.mock('@/shared/auth/oauth-client', () => ({
  getValidAccessToken: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../config/constants', () => ({
  APP_DISPLAY_NAME: 'Neuma Test',
  getAppMcpConfigPath: vi.fn().mockReturnValue('/tmp/.neuma/mcp.json'),
  getAllMcpConfigPaths: vi.fn().mockReturnValue([
    { name: 'app', path: '/tmp/.neuma/mcp.json' },
    { name: 'claude', path: '/tmp/.claude/settings.json' },
  ]),
}));

// ============================================================================
// GET /config
// ============================================================================

describe('MCP API', () => {
  beforeEach(() => {
    tokenMocks.getExternalMcpAuthorizationHeader
      .mockReset()
      .mockResolvedValue(null);
    tokenMocks.getExternalMcpTokenMetadata.mockReset().mockResolvedValue(null);
    tokenMocks.removeExternalMcpTokens.mockReset().mockResolvedValue(false);
  });

  describe('GET /config', () => {
    it('returns MCP config when file exists', async () => {
      mockAccess.mockResolvedValueOnce(undefined);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ mcpServers: { test: { command: 'node' } } }),
      );

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/config');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('data');
      const data = body.data as Record<string, unknown>;
      expect(data).toHaveProperty('mcpServers');
    });

    it('returns empty config when file does not exist', async () => {
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/config');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      const data = body.data as Record<string, unknown>;
      expect(data).toHaveProperty('mcpServers');
      expect(Object.keys(data.mcpServers as object)).toHaveLength(0);
    });
  });

  // ============================================================================
  // POST /config
  // ============================================================================

  describe('POST /config', () => {
    it('saves MCP config', async () => {
      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request(
        jsonReq('/config', {
          mcpServers: { myServer: { command: 'npx', args: ['-y', 'mcp'] } },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });

    it('rejects invalid config (missing mcpServers)', async () => {
      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request(jsonReq('/config', {}));
      expect(res.status).toBe(400);
    });
  });

  // ============================================================================
  // GET /path
  // ============================================================================

  describe('GET /path', () => {
    it('returns config file path', async () => {
      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/path');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('path');
      expect(typeof body.path).toBe('string');
    });
  });

  // ============================================================================
  // GET /all-configs
  // ============================================================================

  describe('GET /all-configs', () => {
    it('returns configs from all sources', async () => {
      // First config (app) - exists
      mockAccess.mockResolvedValueOnce(undefined);
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ mcpServers: { s1: { command: 'node' } } }),
      );
      // Second config (claude) - does not exist
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/all-configs');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('configs');
      expect(Array.isArray(body.configs)).toBe(true);
    });
  });

  // ============================================================================
  // POST /oauth/initiate
  // ============================================================================

  describe('POST /oauth/initiate', () => {
    it('initiates OAuth flow for valid HTTPS URL', async () => {
      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request(
        jsonReq('/oauth/initiate', {
          serverName: 'notion',
          serverUrl: 'https://mcp.notion.com/mcp',
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('authUrl');
      expect(body).toHaveProperty('state');
    });

    it('rejects non-HTTPS URL', async () => {
      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request(
        jsonReq('/oauth/initiate', {
          serverName: 'local',
          serverUrl: 'http://example.com/mcp',
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', false);
    });

    it('blocks private network URLs (SSRF)', async () => {
      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request(
        jsonReq('/oauth/initiate', {
          serverName: 'internal',
          serverUrl: 'https://192.168.1.1/mcp',
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', false);
    });
  });

  // ============================================================================
  // POST /oauth/start
  // ============================================================================

  describe('POST /oauth/start', () => {
    it('starts OAuth for a configured HTTP MCP server', async () => {
      mockInitiateMcpOAuth.mockClear();
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: {
            figma: { url: 'https://mcp.figma.com/mcp' },
          },
        }),
      );
      mockInitiateMcpOAuth.mockResolvedValueOnce({
        authUrl: 'https://auth.example.com/authorize?state=figma',
        state: 'figma',
        redirectUri: 'http://127.0.0.1:1234/callback',
      });

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request(
        jsonReq('/oauth/start', { serverId: 'figma' }),
      );
      expect(res.status).toBe(200);
      expect(mockInitiateMcpOAuth).toHaveBeenCalledWith(
        'figma',
        'https://mcp.figma.com/mcp',
        expect.any(String),
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        authorizeUrl: 'https://auth.example.com/authorize?state=figma',
        state: 'figma',
        redirectUri: 'http://127.0.0.1:1234/callback',
      });
    });

    it('rejects OAuth start for a stdio MCP server', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: {
            shadcn: { command: 'npx', args: ['-y', 'shadcn-mcp'] },
          },
        }),
      );

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request(
        jsonReq('/oauth/start', { serverId: 'shadcn' }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe(
        'OAuth flow only applies to HTTP/SSE MCP servers',
      );
    });
  });

  describe('POST /external/start-oauth', () => {
    it('returns DesignMode-compatible flow fields', async () => {
      mockInitiateMcpOAuth.mockClear();
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: {
            higgsfield: { url: 'https://mcp.higgsfield.example/mcp' },
          },
        }),
      );
      mockInitiateMcpOAuth.mockResolvedValueOnce({
        authUrl: 'https://auth.example.com/authorize?state=higgsfield',
        state: 'higgsfield',
        redirectUri: 'http://127.0.0.1:5678/callback',
      });

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request(
        jsonReq('/external/start-oauth', { serverId: 'higgsfield' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        success: true,
        authUrl: 'https://auth.example.com/authorize?state=higgsfield',
        authorizeUrl: 'https://auth.example.com/authorize?state=higgsfield',
        state: 'higgsfield',
        flowId: 'higgsfield',
        redirectUri: 'http://127.0.0.1:5678/callback',
      });
    });
  });

  describe('POST /external/disconnect/:serverId', () => {
    it('removes bearer headers and token-like env values from config', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: {
            figma: {
              url: 'https://mcp.figma.com/mcp',
              headers: {
                Authorization: 'Bearer secret-token',
                'X-Trace': 'safe',
              },
              env: {
                FIGMA_TOKEN: 'secret-token',
                SAFE_FLAG: '1',
              },
            },
          },
        }),
      );
      mockWriteFile.mockClear();

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/external/disconnect/figma', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        success: true,
        serverId: 'figma',
        connected: false,
      });
      const [, serialized] = mockWriteFile.mock.calls.at(-1) ?? [];
      const saved = JSON.parse(serialized as string) as {
        mcpServers: {
          figma: {
            headers?: Record<string, string>;
            env?: Record<string, string>;
          };
        };
      };
      expect(saved.mcpServers.figma.headers).toEqual({ 'X-Trace': 'safe' });
      expect(saved.mcpServers.figma.env).toEqual({ SAFE_FLAG: '1' });
      expect(tokenMocks.removeExternalMcpTokens).toHaveBeenCalledWith('figma');
    });

    it('removes encrypted OAuth markers from config', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: {
            figma: {
              url: 'https://mcp.figma.com/mcp',
              oauth: { tokenStore: 'encrypted' },
            },
          },
        }),
      );
      tokenMocks.removeExternalMcpTokens.mockResolvedValueOnce(true);
      mockWriteFile.mockClear();

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/external/disconnect/figma', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const [, serialized] = mockWriteFile.mock.calls.at(-1) ?? [];
      const saved = JSON.parse(serialized as string) as {
        mcpServers: { figma: { oauth?: unknown } };
      };
      expect(saved.mcpServers.figma.oauth).toBeUndefined();
    });

    it('returns not_found for unknown external MCP servers', async () => {
      mockReadFile.mockResolvedValueOnce(JSON.stringify({ mcpServers: {} }));

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/external/disconnect/missing', {
        method: 'POST',
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        success: false,
        error: 'not_found',
        message: 'unknown serverId missing',
      });
    });
  });

  describe('GET /external/status/:serverId', () => {
    it('reports encrypted OAuth token metadata as connected', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: { figma: { url: 'https://mcp.figma.com/mcp' } },
        }),
      );
      tokenMocks.getExternalMcpTokenMetadata.mockResolvedValueOnce({
        serverId: 'figma',
        serverUrl: 'https://mcp.figma.com/mcp',
        authServerBase: 'https://auth.example.com',
        connectedAt: '2026-05-08T00:00:00.000Z',
        updatedAt: '2026-05-08T00:00:00.000Z',
        expiresAt: 1_800_000_000_000,
        scopes: ['files:read'],
        tokenType: 'Bearer',
      });

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/external/status/figma');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        serverId: 'figma',
        connected: true,
        tokenStore: 'encrypted',
        expiresAt: 1_800_000_000_000,
        scopes: ['files:read'],
      });
    });
  });

  describe('POST /external/tools/:serverId/list', () => {
    it('proxies tools/list for a configured HTTP MCP server', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: {
            figma: {
              url: 'https://mcp.figma.com/mcp',
              headers: { Authorization: 'Bearer secret-token' },
            },
          },
        }),
      );
      transportMocks.listExternalMcpTools.mockResolvedValueOnce([
        { name: 'get_file_context' },
      ]);

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/external/tools/figma/list', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      expect(transportMocks.listExternalMcpTools).toHaveBeenCalledWith({
        url: 'https://mcp.figma.com/mcp',
        headers: { Authorization: 'Bearer secret-token' },
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        success: true,
        serverId: 'figma',
        tools: [{ name: 'get_file_context' }],
      });
    });

    it('injects encrypted OAuth tokens for proxied tools/list', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: {
            figma: { url: 'https://mcp.figma.com/mcp' },
          },
        }),
      );
      tokenMocks.getExternalMcpAuthorizationHeader.mockResolvedValueOnce(
        'Bearer encrypted-token',
      );
      transportMocks.listExternalMcpTools.mockResolvedValueOnce([
        { name: 'get_file_context' },
      ]);

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/external/tools/figma/list', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      expect(transportMocks.listExternalMcpTools).toHaveBeenCalledWith({
        url: 'https://mcp.figma.com/mcp',
        headers: { Authorization: 'Bearer encrypted-token' },
      });
    });

    it('does not proxy tools/list for stdio MCP servers', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: {
            shadcn: { command: 'npx', args: ['-y', 'shadcn-mcp'] },
          },
        }),
      );

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/external/tools/shadcn/list', {
        method: 'POST',
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        success: false,
        error: 'bad_request',
        message: 'External MCP proxy only applies to HTTP/SSE servers',
      });
    });
  });

  describe('POST /external/tools/:serverId/call', () => {
    it('proxies tools/call and maps auth failures without leaking headers', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({
          mcpServers: {
            figma: {
              url: 'https://mcp.figma.com/mcp',
              headers: { Authorization: 'Bearer secret-token' },
            },
          },
        }),
      );
      transportMocks.callExternalMcpTool.mockRejectedValueOnce(
        new transportMocks.ExternalMcpTransportError(
          'MCP server requires authentication',
          401,
          'auth_required',
        ),
      );

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request(
        jsonReq('/external/tools/figma/call', {
          name: 'get_file_context',
          arguments: { fileKey: 'abc123' },
        }),
      );
      expect(res.status).toBe(401);
      expect(transportMocks.callExternalMcpTool).toHaveBeenCalledWith(
        {
          url: 'https://mcp.figma.com/mcp',
          headers: { Authorization: 'Bearer secret-token' },
        },
        'get_file_context',
        { fileKey: 'abc123' },
      );
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        success: false,
        error: 'auth_required',
        message: 'MCP server requires authentication',
      });
      expect(JSON.stringify(body)).not.toContain('secret-token');
    });
  });

  // ============================================================================
  // GET /oauth/status/:state
  // ============================================================================

  describe('GET /oauth/status/:state', () => {
    it('returns flow status for a given state', async () => {
      mockGetFlowStatus.mockReturnValueOnce({
        status: 'completed',
        serverName: 'notion',
      });

      const { mcpRoutes } = await import('@/app/api/mcp');
      const res = await mcpRoutes.request('/oauth/status/abc123');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('status');
    });
  });
});
