import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  provider: {
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

describe('agent connector binding shims', () => {
  it('materializes Claude-compatible connector tools through the binder', async () => {
    const { materializeClaudeConnectorTools } =
      await import('@/extensions/agent/claude/connectors');

    const tools = materializeClaudeConnectorTools({
      catalog: [connectedGithub()],
      context: desktopContext(),
    });

    expect(tools).toContainEqual(
      expect.objectContaining({
        name: 'github.github_search_repositories',
        input_schema: expect.objectContaining({ type: 'object' }),
      }),
    );
  });

  it('executes OpenAI-compatible connector tool calls through the binder', async () => {
    mocks.provider.getDetail.mockResolvedValue(connectedGithub());
    mocks.provider.executeTool.mockResolvedValue({
      output: { ok: true },
      truncated: false,
      logId: 'log_1',
    });
    const { executeTool } =
      await import('@/extensions/agent/openai-compat/tools');

    const result = await executeTool(
      'github.github_search_repositories',
      {},
      '/tmp',
    );

    expect(result).toEqual({
      output: JSON.stringify({
        output: { ok: true },
        truncated: false,
        logId: 'log_1',
      }),
      isError: false,
    });
    expect(mocks.provider.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
      }),
    );
  });

  it('mints Codex loopback tokens without exposing provider credentials', async () => {
    const { mintCodexConnectorToolToken } =
      await import('@/extensions/agent/codex/connectors');
    const { lookupBridgeToken, __resetBridgeTokenStoreForTests } =
      await import('@/shared/mcp/subprocess-bridge/token-store');
    __resetBridgeTokenStoreForTests();

    const token = mintCodexConnectorToolToken({
      context: desktopContext(),
      connectorId: 'github',
      toolName: 'github.github_search_repositories',
      connectedAccountId: 'ca_1',
      providerUserId: 'user_1',
    });

    expect(token).toHaveLength(43);
    expect(lookupBridgeToken(token)).toMatchObject({
      connector: 'connector',
      connectorScope: {
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        connectedAccountId: 'ca_1',
        userId: 'user_1',
      },
    });
  });
});

function desktopContext() {
  return {
    runId: 'run_1',
    surface: 'desktop' as const,
    platform: 'desktop',
    accountId: 'default',
    permissionTier: 'admin' as const,
    connectedAccountId: 'ca_1',
    providerUserId: 'user_1',
  };
}

function connectedGithub() {
  return {
    id: 'github',
    name: 'GitHub',
    provider: 'composio' as const,
    category: 'Engineering',
    status: 'connected' as const,
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
        connectedAccountId: 'ca_1',
        status: 'connected' as const,
      },
    ],
    tools: [
      {
        name: 'github.github_search_repositories',
        title: 'Search repositories',
        inputSchemaJson: { type: 'object', properties: {} },
        safety: {
          sideEffect: 'read' as const,
          approval: 'auto' as const,
          reason: 'read-only',
        },
        refreshEligible: true,
        requiredScopes: [],
      },
      {
        name: 'github.github_create_issue',
        title: 'Create issue',
        inputSchemaJson: { type: 'object', properties: {} },
        safety: {
          sideEffect: 'write' as const,
          approval: 'confirm' as const,
          reason: 'write',
        },
        refreshEligible: false,
        requiredScopes: [],
      },
    ],
  };
}
