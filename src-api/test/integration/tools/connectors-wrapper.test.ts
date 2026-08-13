import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  provider: {
    getFastDefinitions: vi.fn(),
    getDetail: vi.fn(),
    executeTool: vi.fn(),
  },
}));

vi.mock('@/shared/connectors/providers/composio', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/connectors/providers/composio')
  >('@/shared/connectors/providers/composio');
  return {
    ...actual,
    getComposioProvider: () => mocks.provider,
  };
});

describe('tools connector wrapper route', () => {
  beforeEach(async () => {
    mocks.provider.getFastDefinitions.mockReset();
    mocks.provider.getDetail.mockReset();
    mocks.provider.executeTool.mockReset();
    mocks.provider.getFastDefinitions.mockReturnValue([githubDefinition()]);
    mocks.provider.getDetail.mockResolvedValue(connectedGithub());
    const { __resetBridgeTokenStoreForTests } =
      await import('@/shared/mcp/subprocess-bridge/token-store');
    __resetBridgeTokenStoreForTests();
    vi.stubEnv('NEUMA_CONNECTORS_PLATFORM_V2', 'true');
  });

  it('returns 404 when connector platform V2 is disabled', async () => {
    vi.stubEnv('NEUMA_CONNECTORS_PLATFORM_V2', 'false');
    const { toolsRoutes } = await import('@/app/api/tools');

    const res = await toolsRoutes.request('/connectors/list');

    expect(res.status).toBe(404);
    expect(mocks.provider.getFastDefinitions).not.toHaveBeenCalled();
  });

  it('rejects missing connector execution tokens', async () => {
    const { toolsRoutes } = await import('@/app/api/tools');
    const res = await toolsRoutes.request('/connectors/execute', {
      method: 'POST',
      body: JSON.stringify({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        input: {},
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(403);
  });

  it('does not treat NEUMA_TOOL_TOKEN as a static route credential', async () => {
    const { mintBridgeToken } =
      await import('@/shared/mcp/subprocess-bridge/token-store');
    const token = mintBridgeToken({
      connector: 'connector',
      connectorScope: {
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
      },
      sessionId: 'run_1',
      policyContext: { platform: 'desktop', permissionTier: 'admin' },
    });
    vi.stubEnv('NEUMA_TOOL_TOKEN', token);
    const { toolsRoutes } = await import('@/app/api/tools');

    const res = await toolsRoutes.request('/connectors/execute', {
      method: 'POST',
      body: JSON.stringify({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        input: {},
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(403);
    expect(mocks.provider.executeTool).not.toHaveBeenCalled();
  });

  it('rejects tokens scoped to a different connector', async () => {
    const { mintBridgeToken } =
      await import('@/shared/mcp/subprocess-bridge/token-store');
    const token = mintBridgeToken({
      connector: 'connector',
      connectorScope: {
        connectorId: 'slack',
        toolName: 'slack.search_messages',
      },
      sessionId: 'run_1',
      policyContext: { platform: 'desktop', permissionTier: 'admin' },
    });
    const { toolsRoutes } = await import('@/app/api/tools');

    const res = await toolsRoutes.request('/connectors/execute', {
      method: 'POST',
      body: JSON.stringify({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        input: {},
      }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.status).toBe(403);
  });

  it('lists only compact refresh-safe tools for scoped DesignMode tokens', async () => {
    const { mintBridgeToken } =
      await import('@/shared/mcp/subprocess-bridge/token-store');
    const token = mintBridgeToken({
      connector: 'connector',
      connectorScope: {
        connectorId: 'github',
      },
      sessionId: 'run_1',
      policyContext: { platform: 'desktop', permissionTier: 'admin' },
    });
    const { toolsRoutes } = await import('@/app/api/tools');

    const res = await toolsRoutes.request('/connectors/list?format=compact', {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      tools: [
        expect.objectContaining({
          connectorId: 'github',
          toolName: 'github.github_search_repositories',
        }),
      ],
    });
  });

  it('delegates valid token executions to the shared binder path', async () => {
    mocks.provider.executeTool.mockResolvedValue({
      output: { ok: true },
      truncated: false,
      logId: 'log_1',
    });
    const { mintBridgeToken } =
      await import('@/shared/mcp/subprocess-bridge/token-store');
    const token = mintBridgeToken({
      connector: 'connector',
      connectorScope: {
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        connectedAccountId: 'ca_1',
        userId: 'user_1',
      },
      sessionId: 'run_1',
      policyContext: { platform: 'desktop', permissionTier: 'admin' },
    });
    const { toolsRoutes } = await import('@/app/api/tools');

    const res = await toolsRoutes.request('/connectors/execute', {
      method: 'POST',
      body: JSON.stringify({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        input: { query: 'neuma' },
      }),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      output: { ok: true },
      truncated: false,
      logId: 'log_1',
    });
    expect(mocks.provider.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        connectedAccountId: 'ca_1',
        userId: 'user_1',
        input: { query: 'neuma' },
      }),
    );
  });
});

function githubDefinition() {
  return {
    id: 'github',
    name: 'GitHub',
    provider: 'composio' as const,
    category: 'Engineering',
    authentication: 'composio' as const,
    allowedToolNames: [
      'github.github_search_repositories',
      'github.github_create_issue',
    ],
    tools: [
      {
        name: 'github.github_search_repositories',
        title: 'Search repositories',
        inputSchemaJson: { type: 'object', properties: {} },
        requiredScopes: [],
        safety: {
          sideEffect: 'read' as const,
          approval: 'auto' as const,
          reason: 'read',
        },
        refreshEligible: true,
      },
      {
        name: 'github.github_create_issue',
        title: 'Create issue',
        inputSchemaJson: { type: 'object', properties: {} },
        requiredScopes: [],
        safety: {
          sideEffect: 'write' as const,
          approval: 'confirm' as const,
          reason: 'write',
        },
        refreshEligible: false,
      },
    ],
  };
}

function connectedGithub() {
  return {
    id: 'github',
    name: 'GitHub',
    provider: 'composio' as const,
    category: 'Engineering',
    status: 'connected' as const,
    accountLabel: '@neuma',
    auth: { provider: 'composio' as const, configured: true },
    allowedToolNames: [
      'github.github_search_repositories',
      'github.github_create_issue',
    ],
    curatedToolNames: [
      'github.github_search_repositories',
      'github.github_create_issue',
    ],
    scopeConnections: [
      {
        scopeKey: 'desktop:local',
        label: 'Desktop',
        accountLabel: '@neuma',
        connectedAccountId: 'ca_1',
        status: 'connected' as const,
      },
    ],
    tools: githubDefinition().tools,
  };
}
