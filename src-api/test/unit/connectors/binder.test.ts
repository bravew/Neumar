import { describe, expect, it, vi } from 'vitest';

import {
  __resetConnectorBinderForTests,
  invalidateConnectorToolCache,
  materializeTools,
  type BinderRunContext,
  type ConnectorBinderPolicy,
} from '@/shared/connectors/binder';
import { listDesignModeConnectorTools } from '@/shared/connectors/binder/design-mode';
import type { ConnectorDetail } from '@/shared/connectors/catalog';

const context: BinderRunContext = {
  runId: 'run_1',
  surface: 'desktop',
  platform: 'desktop',
  accountId: 'acct_1',
  permissionTier: 'admin',
};

describe('connector binder materialization', () => {
  it('materializes Anthropic, OpenAI, and DeepAgents tool shapes', () => {
    const policy = allowAllPolicy();
    const [anthropic] = materializeTools({
      catalog: [connectedGithub()],
      context,
      shape: 'anthropic',
      policy,
    });
    const openai = materializeTools({
      catalog: [connectedGithub()],
      context,
      shape: 'openai',
      policy,
    });
    const deepagents = materializeTools({
      catalog: [connectedGithub()],
      context,
      shape: 'deepagents',
      policy,
    });

    expect(anthropic).toMatchObject({
      name: 'github.github_search_repositories',
      input_schema: { type: 'object' },
    });
    expect(openai).toContainEqual(
      expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({
          name: 'github.github_create_issue',
          description: expect.stringContaining('[needs confirmation]'),
          parameters: expect.objectContaining({ type: 'object' }),
        }),
      }),
    );
    expect(deepagents).toContainEqual(
      expect.objectContaining({
        name: 'github.github_search_repositories',
        schema: expect.objectContaining({ type: 'object' }),
        metadata: expect.objectContaining({ connectorTool: true }),
      }),
    );
  });

  it('filters disconnected, disabled, unallowed, and policy-denied tools', () => {
    const policy: ConnectorBinderPolicy = {
      canExecute: vi.fn((input) => ({
        allow: input.toolName !== 'github.github_create_issue',
        requireConfirmation: false,
        approval:
          input.toolName === 'github.github_create_issue' ? 'confirm' : 'auto',
        policyKey: 'desktop',
        reason:
          input.toolName === 'github.github_create_issue'
            ? 'test-denied'
            : undefined,
      })),
    };

    const tools = materializeTools({
      catalog: [
        {
          ...connectedGithub(),
          allowedToolNames: [
            'github.github_search_repositories',
            'github.github_create_issue',
          ],
        },
        { ...connectedGithub(), id: 'github-off', status: 'available' },
      ],
      context,
      shape: 'openai',
      policy,
    });

    expect(toOpenAINames(tools)).toEqual(['github.github_search_repositories']);
  });

  it('hides non-refresh-safe tools from DesignMode compact lists', () => {
    const list = listDesignModeConnectorTools({
      catalog: [connectedGithub()],
      context,
      policy: allowAllPolicy(),
    });

    expect(list.tools.map((tool) => tool.toolName)).toEqual([
      'github.github_search_repositories',
    ]);
  });

  it('invalidates cached materializations for status or override changes', () => {
    __resetConnectorBinderForTests();
    const first = materializeTools({
      catalog: [connectedGithub()],
      context,
      shape: 'openai',
    });
    const stale = materializeTools({
      catalog: [],
      context,
      shape: 'openai',
    });
    invalidateConnectorToolCache('test');
    const fresh = materializeTools({
      catalog: [],
      context,
      shape: 'openai',
    });

    expect(first.length).toBeGreaterThan(0);
    expect(stale).toHaveLength(first.length);
    expect(fresh).toHaveLength(0);
  });
});

function allowAllPolicy(): ConnectorBinderPolicy {
  return {
    canExecute: vi.fn((input) => ({
      allow: true,
      requireConfirmation: input.toolName === 'github.github_create_issue',
      approval:
        input.toolName === 'github.github_create_issue' ? 'confirm' : 'auto',
      policyKey: 'desktop',
    })),
  };
}

function connectedGithub(): ConnectorDetail {
  return {
    id: 'github',
    name: 'GitHub',
    provider: 'composio',
    category: 'Engineering',
    status: 'connected',
    accountLabel: '@neuma',
    scopeConnections: [
      {
        scopeKey: 'desktop:local',
        label: 'Desktop',
        accountLabel: '@neuma',
        connectedAccountId: 'ca_1',
        status: 'connected',
      },
    ],
    auth: { provider: 'composio', configured: true },
    allowedToolNames: [
      'github.github_search_repositories',
      'github.github_create_issue',
      'github.github_delete_repository',
    ],
    curatedToolNames: [
      'github.github_search_repositories',
      'github.github_create_issue',
    ],
    tools: [
      {
        name: 'github.github_search_repositories',
        title: 'Search repositories',
        description: 'Search repositories visible to the connected account.',
        inputSchemaJson: { type: 'object', properties: {} },
        safety: {
          sideEffect: 'read',
          approval: 'auto',
          reason: 'read-only',
        },
        refreshEligible: true,
        requiredScopes: ['repo:read'],
      },
      {
        name: 'github.github_create_issue',
        title: 'Create issue',
        description: 'Create a GitHub issue.',
        inputSchemaJson: { type: 'object', properties: {} },
        safety: {
          sideEffect: 'write',
          approval: 'confirm',
          reason: 'writes issue data',
        },
        refreshEligible: false,
        requiredScopes: ['issues:write'],
      },
      {
        name: 'github.github_delete_repository',
        title: 'Delete repository',
        inputSchemaJson: { type: 'object', properties: {} },
        safety: {
          sideEffect: 'destructive',
          approval: 'disabled',
          reason: 'destructive',
        },
        refreshEligible: false,
        requiredScopes: ['repo:delete'],
      },
    ],
  };
}

function toOpenAINames(tools: unknown[]): string[] {
  return tools.map(
    (tool) =>
      (
        tool as {
          function: { name: string };
        }
      ).function.name,
  );
}
