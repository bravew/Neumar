import { describe, expect, it, vi } from 'vitest';

import {
  executeConnectorTool,
  type BinderRunContext,
  type ConnectorBinderPolicy,
} from '@/shared/connectors/binder';
import type { ConnectorDetail } from '@/shared/connectors/catalog';

const context: BinderRunContext = {
  runId: 'run_1',
  surface: 'desktop',
  platform: 'desktop',
  accountId: 'acct_1',
  permissionTier: 'admin',
  connectedAccountId: 'ca_1',
  providerUserId: 'user_1',
};

describe('connector binder execution gate', () => {
  it('denies viewer policy before dispatch', async () => {
    const executor = fakeExecutor();

    await expect(
      executeConnectorTool({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        input: {},
        context,
        policy: denyPolicy('tier-denied'),
        executor,
      }),
    ).rejects.toMatchObject({
      code: 'CONNECTOR_SAFETY_DENIED',
    });
    expect(executor.executeTool).not.toHaveBeenCalled();
  });

  it('executes confirmation tools only after approval is granted', async () => {
    const executor = fakeExecutor();

    await expect(
      executeConnectorTool({
        connectorId: 'github',
        toolName: 'github.github_create_issue',
        input: { title: 'Ship connectors' },
        context,
        policy: allowPolicy('confirm'),
        approvalGateway: {
          requestConnectorToolApproval: vi.fn(async () => 'approved'),
        },
        executor,
      }),
    ).resolves.toEqual({
      output: { ok: true },
      truncated: false,
      logId: 'log_1',
    });
    expect(executor.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'composio',
        input: { title: 'Ship connectors' },
      }),
    );
  });

  it.each(['timeout', 'rejected'] as const)(
    'denies confirmation tools when approval is %s',
    async (outcome) => {
      const executor = fakeExecutor();

      await expect(
        executeConnectorTool({
          connectorId: 'github',
          toolName: 'github.github_create_issue',
          input: {},
          context,
          policy: allowPolicy('confirm'),
          approvalGateway: {
            requestConnectorToolApproval: vi.fn(async () => outcome),
          },
          executor,
        }),
      ).rejects.toMatchObject({
        code: 'CONNECTOR_SAFETY_DENIED',
      });
      expect(executor.executeTool).not.toHaveBeenCalled();
    },
  );

  it('rejects unsafe input before provider dispatch', async () => {
    const executor = fakeExecutor();

    await expect(
      executeConnectorTool({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        input: { token: 'secret' },
        context,
        policy: allowPolicy('auto'),
        executor,
      }),
    ).rejects.toMatchObject({
      code: 'CONNECTOR_INPUT_SCHEMA_MISMATCH',
    });
    expect(executor.executeTool).not.toHaveBeenCalled();
  });

  it('normalizes provider output and preserves truncation markers', async () => {
    const executor = fakeExecutor({
      output: { ok: true, token: 'secret', _truncated: true },
      truncated: true,
    });

    await expect(
      executeConnectorTool({
        connectorId: 'github',
        toolName: 'github.github_search_repositories',
        input: {},
        context,
        policy: allowPolicy('auto'),
        executor,
      }),
    ).resolves.toEqual({
      output: { ok: true, token: '[redacted]', _truncated: true },
      truncated: true,
      logId: 'log_1',
    });
  });

  it('keeps channel scope in the execution context', async () => {
    const executor = fakeExecutor();
    const channelContext: BinderRunContext = {
      runId: 'run_slack',
      surface: 'channel',
      platform: 'slack',
      configId: 'workspace_a',
      accountId: 'slack_user_1',
      permissionTier: 'admin',
      connectedAccountId: 'ca_workspace_a',
      providerUserId: 'slack_user_1',
    };

    await executeConnectorTool({
      connectorId: 'github',
      toolName: 'github.github_search_repositories',
      input: {},
      context: channelContext,
      policy: allowPolicy('auto'),
      executor,
    });

    expect(executor.executeTool).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          platform: 'slack',
          configId: 'workspace_a',
          connectedAccountId: 'ca_workspace_a',
        }),
      }),
    );
  });
});

function allowPolicy(approval: 'auto' | 'confirm'): ConnectorBinderPolicy {
  return {
    canExecute: vi.fn(() => ({
      allow: true,
      requireConfirmation: approval === 'confirm',
      approval,
      policyKey: 'desktop',
    })),
  };
}

function denyPolicy(reason: string): ConnectorBinderPolicy {
  return {
    canExecute: vi.fn(() => ({
      allow: false,
      requireConfirmation: false,
      approval: 'auto',
      policyKey: 'desktop',
      reason,
    })),
  };
}

function fakeExecutor(
  result: { output: unknown; truncated: boolean } = {
    output: { ok: true },
    truncated: false,
  },
) {
  return {
    getDetail: vi.fn(async () => connectedGithub()),
    executeTool: vi.fn(async () => ({ ...result, logId: 'log_1' })),
  };
}

function connectedGithub(): ConnectorDetail {
  return {
    id: 'github',
    name: 'GitHub',
    provider: 'composio',
    category: 'Engineering',
    status: 'connected',
    auth: { provider: 'composio', configured: true },
    allowedToolNames: [
      'github.github_search_repositories',
      'github.github_create_issue',
    ],
    curatedToolNames: [
      'github.github_search_repositories',
      'github.github_create_issue',
    ],
    tools: [
      {
        name: 'github.github_search_repositories',
        title: 'Search repositories',
        inputSchemaJson: { type: 'object', properties: {} },
        safety: {
          sideEffect: 'read',
          approval: 'auto',
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
          sideEffect: 'write',
          approval: 'confirm',
          reason: 'writes issue data',
        },
        refreshEligible: false,
        requiredScopes: [],
      },
    ],
  };
}
