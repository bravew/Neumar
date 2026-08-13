import { createHash } from 'node:crypto';

import {
  canExecuteConnectorTool,
  policyKeyForConnectorContext,
  type ConnectorExecutionDecision,
  type ConnectorRunContext,
} from '@/shared/auth/connector-policy';
import {
  normalizeConnectorToolOutput,
  validateConnectorToolInput,
  type BoundedJsonObject,
} from '@/shared/connectors/bounded-json';
import { ConnectorJsonError } from '@/shared/connectors/bounded-json';
import type {
  ConnectorDetail,
  ConnectorProvider,
  ConnectorToolApproval,
  ConnectorToolDetail,
} from '@/shared/connectors/catalog';
import { getComposioProvider } from '@/shared/connectors/providers/composio';
import { ConnectorServiceError } from '@/shared/connectors/providers/composio/errors';
import { createLogger } from '@/shared/utils/logger';

import {
  connectorToolToAnthropicTool,
  type AnthropicConnectorTool,
} from './anthropic';
import {
  getConnectorApprovalGateway,
  type ConnectorApprovalGateway,
} from './approval';
import {
  connectorToolToDeepAgentsTool,
  type DeepAgentsConnectorTool,
} from './deepagents';
import { connectorToolToOpenAITool, type OpenAIConnectorTool } from './openai';

export type ConnectorToolShape = 'anthropic' | 'openai' | 'deepagents';

export type RuntimeConnectorTool =
  | AnthropicConnectorTool
  | OpenAIConnectorTool
  | DeepAgentsConnectorTool;

export interface BinderRunContext extends ConnectorRunContext {
  runId: string;
  surface: 'desktop' | 'channel' | 'automation' | 'design_mode' | 'subprocess';
  accountId: string;
  workDir?: string;
  abortSignal?: AbortSignal;
  connectedAccountId?: string;
  providerUserId?: string;
}

export interface ConnectorBinderPolicy {
  canExecute(input: {
    context: BinderRunContext;
    connectorId: string;
    toolName: string;
    tool?: ConnectorToolDetail;
  }): ConnectorExecutionDecision;
}

export interface MaterializedConnectorToolEntry {
  connector: ConnectorDetail;
  tool: ConnectorToolDetail;
  decision: ConnectorExecutionDecision;
}

export interface ConnectorToolExecutionResult {
  output: unknown;
  truncated: boolean;
  logId?: string;
}

interface ConnectorToolExecutor {
  getDetail(
    connectorId: string,
    signal?: AbortSignal,
  ): Promise<ConnectorDetail>;
  executeTool(args: {
    provider: ConnectorProvider;
    connector: ConnectorDetail;
    tool: ConnectorToolDetail;
    input: BoundedJsonObject;
    context: BinderRunContext;
  }): Promise<ConnectorToolExecutionResult>;
}

export interface ExecuteConnectorToolArgs {
  connectorId: string;
  toolName: string;
  input: unknown;
  context: BinderRunContext;
  policy?: ConnectorBinderPolicy;
  approvalGateway?: ConnectorApprovalGateway;
  executor?: ConnectorToolExecutor;
}

const logger = createLogger('ConnectorBinder');
const defaultPolicy: ConnectorBinderPolicy = {
  canExecute: canExecuteConnectorTool,
};
const defaultExecutor: ConnectorToolExecutor = {
  getDetail: (connectorId, signal) =>
    getComposioProvider().getDetail(connectorId, signal),
  executeTool: executeWithDefaultProvider,
};

let cacheRevision = 0;
const materializedToolCache = new Map<string, RuntimeConnectorTool[]>();

export function materializeTools(args: {
  catalog: ConnectorDetail[];
  context: BinderRunContext;
  shape: ConnectorToolShape;
  policy?: ConnectorBinderPolicy;
}): RuntimeConnectorTool[] {
  const cacheKey =
    args.policy === undefined
      ? materializedToolCacheKey(args.context, args.shape)
      : undefined;
  if (cacheKey) {
    const cached = materializedToolCache.get(cacheKey);
    if (cached) return [...cached];
  }

  const tools = materializeConnectorToolEntries(args).map(({ tool }) =>
    convertConnectorTool(tool, args.shape),
  );

  if (cacheKey) materializedToolCache.set(cacheKey, tools);
  return [...tools];
}

export function materializeConnectorToolEntries(args: {
  catalog: ConnectorDetail[];
  context: BinderRunContext;
  policy?: ConnectorBinderPolicy;
}): MaterializedConnectorToolEntry[] {
  const policy = args.policy ?? defaultPolicy;
  const entries: MaterializedConnectorToolEntry[] = [];

  for (const connector of args.catalog) {
    if (connector.status !== 'connected') continue;
    const allowedToolNames = new Set(connector.allowedToolNames);

    for (const tool of connector.tools) {
      if (!allowedToolNames.has(tool.name)) continue;
      if (tool.safety.approval === 'disabled') continue;
      if (!toolVisibleOnSurface(tool, args.context)) continue;

      const decision = policy.canExecute({
        context: args.context,
        connectorId: connector.id,
        toolName: tool.name,
        tool,
      });
      if (!decision.allow || decision.approval === 'disabled') continue;

      entries.push({
        connector,
        tool: withDecisionApproval(tool, decision.approval),
        decision,
      });
    }
  }

  return entries;
}

export async function executeConnectorTool(
  args: ExecuteConnectorToolArgs,
): Promise<ConnectorToolExecutionResult> {
  const startedAt = Date.now();
  const policy = args.policy ?? defaultPolicy;
  const executor = args.executor ?? defaultExecutor;
  const approvalGateway = args.approvalGateway ?? getConnectorApprovalGateway();

  try {
    const connector = await executor.getDetail(
      args.connectorId,
      args.context.abortSignal,
    );
    const tool = findExecutableTool(connector, args.toolName);
    const decision = policy.canExecute({
      context: args.context,
      connectorId: args.connectorId,
      toolName: args.toolName,
      tool,
    });
    if (!decision.allow || decision.approval === 'disabled') {
      throw safetyDenied(args, decision.reason ?? 'policy-denied');
    }
    if (tool.safety.approval === 'disabled') {
      throw safetyDenied(args, 'tool-disabled');
    }

    const input = validateInput(args.input, tool.inputSchemaJson);
    const approval = decision.approval;
    if (approval === 'confirm') {
      const outcome = await approvalGateway.requestConnectorToolApproval({
        context: args.context,
        connectorId: args.connectorId,
        toolName: args.toolName,
        input,
      });
      if (outcome !== 'approved') {
        throw safetyDenied(args, `approval-${outcome}`);
      }
    }

    const result = await executor.executeTool({
      provider: connector.provider,
      connector,
      tool,
      input,
      context: args.context,
    });
    const normalized = normalizeConnectorToolOutput(result.output);
    const response: ConnectorToolExecutionResult = {
      output: normalized.output,
      truncated: result.truncated || normalized.truncated,
      ...(result.logId === undefined ? {} : { logId: result.logId }),
    };
    auditToolExecution({
      args,
      connector,
      tool,
      approval,
      startedAt,
      outcome: 'success',
      truncated: response.truncated,
    });
    return response;
  } catch (error) {
    if (
      error instanceof ConnectorServiceError &&
      error.code === 'CONNECTOR_AUTH_EXPIRED'
    ) {
      invalidateConnectorToolCache('auth-expired');
    }
    auditToolExecution({
      args,
      approval: 'disabled',
      startedAt,
      outcome: 'error',
      error,
    });
    throw error;
  }
}

export function invalidateConnectorToolCache(reason = 'manual'): void {
  cacheRevision += 1;
  materializedToolCache.clear();
  logger.info('connector.tool_cache.invalidated', { reason, cacheRevision });
}

export function __resetConnectorBinderForTests(): void {
  cacheRevision = 0;
  materializedToolCache.clear();
}

function convertConnectorTool(
  tool: ConnectorToolDetail,
  shape: ConnectorToolShape,
): RuntimeConnectorTool {
  if (shape === 'anthropic') return connectorToolToAnthropicTool(tool);
  if (shape === 'openai') return connectorToolToOpenAITool(tool);
  return connectorToolToDeepAgentsTool(tool);
}

function toolVisibleOnSurface(
  tool: ConnectorToolDetail,
  context: BinderRunContext,
): boolean {
  if (context.surface === 'channel' && context.platform !== 'desktop') {
    return tool.safety.sideEffect === 'read' && tool.safety.approval === 'auto';
  }
  if (context.surface === 'design_mode') {
    return (
      tool.refreshEligible &&
      tool.safety.sideEffect === 'read' &&
      tool.safety.approval === 'auto'
    );
  }
  return true;
}

function withDecisionApproval(
  tool: ConnectorToolDetail,
  approval: ConnectorToolApproval,
): ConnectorToolDetail {
  if (tool.safety.approval === approval) return tool;
  return {
    ...tool,
    safety: {
      ...tool.safety,
      approval,
    },
  };
}

function findExecutableTool(
  connector: ConnectorDetail,
  toolName: string,
): ConnectorToolDetail {
  if (connector.status !== 'connected') {
    throw new ConnectorServiceError(
      'CONNECTOR_NOT_CONNECTED',
      `Connector ${connector.id} is not connected.`,
      { details: { connectorId: connector.id, status: connector.status } },
    );
  }
  if (!connector.allowedToolNames.includes(toolName)) {
    throw new ConnectorServiceError(
      'CONNECTOR_TOOL_NOT_FOUND',
      `Connector tool ${toolName} is not allowed.`,
      { details: { connectorId: connector.id, toolName } },
    );
  }
  const tool = connector.tools.find((entry) => entry.name === toolName);
  if (!tool) {
    throw new ConnectorServiceError(
      'CONNECTOR_TOOL_NOT_FOUND',
      `Connector tool ${toolName} was not found.`,
      { details: { connectorId: connector.id, toolName } },
    );
  }
  return tool;
}

function validateInput(
  input: unknown,
  schema: BoundedJsonObject | undefined,
): BoundedJsonObject {
  try {
    return validateConnectorToolInput(input, schema);
  } catch (error) {
    if (error instanceof ConnectorJsonError) {
      throw new ConnectorServiceError(
        'CONNECTOR_INPUT_SCHEMA_MISMATCH',
        error.message,
        {
          details: {
            code: error.code,
            path: error.path,
          },
          cause: error,
        },
      );
    }
    throw error;
  }
}

async function executeWithDefaultProvider(args: {
  provider: ConnectorProvider;
  connector: ConnectorDetail;
  tool: ConnectorToolDetail;
  input: BoundedJsonObject;
  context: BinderRunContext;
}): Promise<ConnectorToolExecutionResult> {
  if (args.provider !== 'composio') {
    throw new ConnectorServiceError(
      'CONNECTOR_EXECUTION_FAILED',
      `Connector provider ${args.provider} is not executable through the v1 binder yet.`,
      {
        details: {
          connectorId: args.connector.id,
          toolName: args.tool.name,
          provider: args.provider,
        },
      },
    );
  }

  const connection = resolveConnectorConnection(args.connector, args.context);
  if (!connection.connectedAccountId) {
    throw new ConnectorServiceError(
      'CONNECTOR_NOT_CONNECTED',
      `Connector ${args.connector.id} does not have a connected account for this run.`,
      { details: { connectorId: args.connector.id } },
    );
  }

  return getComposioProvider().executeTool({
    connectorId: args.connector.id,
    toolName: args.tool.name,
    connectedAccountId: connection.connectedAccountId,
    userId: connection.userId,
    input: args.input,
    signal: args.context.abortSignal,
  });
}

function resolveConnectorConnection(
  connector: ConnectorDetail,
  context: BinderRunContext,
): { connectedAccountId: string | undefined; userId: string } {
  if (context.connectedAccountId) {
    return {
      connectedAccountId: context.connectedAccountId,
      userId: context.providerUserId ?? context.identityId ?? context.accountId,
    };
  }

  const scopeKey = scopeKeyForRunContext(context);
  const scoped = connector.scopeConnections?.find(
    (connection) => connection.scopeKey === scopeKey,
  );
  const fallback = connector.scopeConnections?.[0];
  return {
    connectedAccountId:
      scoped?.connectedAccountId ?? fallback?.connectedAccountId,
    userId: context.providerUserId ?? context.identityId ?? context.accountId,
  };
}

function scopeKeyForRunContext(context: BinderRunContext): string {
  if (context.surface === 'channel' && context.platform && context.configId) {
    return `channel:${context.platform}:${context.configId}`;
  }
  if (context.surface === 'automation' && context.accountId) {
    return `automation:${context.accountId}`;
  }
  return 'desktop:local';
}

function safetyDenied(
  args: ExecuteConnectorToolArgs,
  reason: string,
): ConnectorServiceError {
  return new ConnectorServiceError(
    'CONNECTOR_SAFETY_DENIED',
    `Connector tool ${args.toolName} is not allowed for this run.`,
    {
      details: {
        connectorId: args.connectorId,
        toolName: args.toolName,
        runId: args.context.runId,
        reason,
      },
    },
  );
}

function materializedToolCacheKey(
  context: BinderRunContext,
  shape: ConnectorToolShape,
): string {
  return [
    cacheRevision,
    context.runId,
    shape,
    policyKeyForConnectorContext(context),
  ].join(':');
}

function auditToolExecution(args: {
  args: ExecuteConnectorToolArgs;
  connector?: ConnectorDetail;
  tool?: ConnectorToolDetail;
  approval: ConnectorToolApproval;
  startedAt: number;
  outcome: 'success' | 'error';
  truncated?: boolean;
  error?: unknown;
}): void {
  logger.info('connector.tool_exec', {
    connectorId: args.args.connectorId,
    toolName: args.args.toolName,
    runId: args.args.context.runId,
    surface: args.args.context.surface,
    platform: args.args.context.platform,
    policyKey: policyKeyForConnectorContext(args.args.context),
    sideEffect: args.tool?.safety.sideEffect,
    approval: args.approval,
    durationMs: Date.now() - args.startedAt,
    outcome: args.outcome,
    truncated: args.truncated ?? false,
    accountLabelHash: args.connector?.accountLabel
      ? hashLabel(args.connector.accountLabel)
      : undefined,
    error:
      args.error instanceof Error
        ? { name: args.error.name, message: args.error.message }
        : undefined,
  });
}

function hashLabel(label: string): string {
  return createHash('sha256').update(label).digest('hex').slice(0, 16);
}

export type {
  AnthropicConnectorTool,
  DeepAgentsConnectorTool,
  OpenAIConnectorTool,
};
