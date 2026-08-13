import { getApprovalManager } from '@/core/approval-manager';

import type { BoundedJsonObject } from '@/shared/connectors/bounded-json';
import { createLogger } from '@/shared/utils/logger';

import type { BinderRunContext } from './index';

const logger = createLogger('ConnectorBinder');
const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000;

export type ConnectorApprovalOutcome = 'approved' | 'rejected' | 'timeout';

export interface ConnectorApprovalRequest {
  context: BinderRunContext;
  connectorId: string;
  toolName: string;
  input: BoundedJsonObject;
}

export interface ConnectorApprovalGateway {
  requestConnectorToolApproval(
    request: ConnectorApprovalRequest,
  ): Promise<ConnectorApprovalOutcome>;
}

let approvalGateway: ConnectorApprovalGateway = {
  requestConnectorToolApproval: requestDefaultConnectorToolApproval,
};

export function getConnectorApprovalGateway(): ConnectorApprovalGateway {
  return approvalGateway;
}

export function setConnectorApprovalGatewayForTests(
  next?: ConnectorApprovalGateway,
): void {
  approvalGateway = next ?? {
    requestConnectorToolApproval: requestDefaultConnectorToolApproval,
  };
}

async function requestDefaultConnectorToolApproval(
  request: ConnectorApprovalRequest,
): Promise<ConnectorApprovalOutcome> {
  if (!canDeliverSameUserApproval(request.context)) {
    return 'rejected';
  }

  const manager = getApprovalManager();
  const { approval } = manager.requestApproval({
    type: 'external_action',
    entityType: 'connector_tool',
    entityId: `${request.connectorId}:${request.toolName}`,
    title: `Approve connector tool: ${request.toolName}`,
    description: `Run ${request.toolName} through ${request.connectorId}.`,
    payload: JSON.stringify({
      connectorId: request.connectorId,
      toolName: request.toolName,
      input: request.input,
      surface: request.context.surface,
      platform: request.context.platform,
      runId: request.context.runId,
    }),
    requesterType: request.context.automationOrigin ? 'automation' : 'agent',
    requesterId:
      request.context.identityId ??
      request.context.accountId ??
      request.context.runId,
    expiresInMinutes: Math.ceil(DEFAULT_APPROVAL_TIMEOUT_MS / 60_000),
    orchestrationRunId: request.context.runId,
    runId: request.context.runId,
    riskLevel: 'medium',
  });

  logger.info('connector.tool_approval.requested', {
    approvalId: approval.id,
    connectorId: request.connectorId,
    toolName: request.toolName,
    runId: request.context.runId,
  });

  return waitForApprovalDecision(
    approval.id,
    request.context.abortSignal,
    DEFAULT_APPROVAL_TIMEOUT_MS,
  );
}

function canDeliverSameUserApproval(context: BinderRunContext): boolean {
  if (context.surface === 'channel' && context.platform !== 'desktop') {
    return false;
  }
  return true;
}

function waitForApprovalDecision(
  approvalId: string,
  abortSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<ConnectorApprovalOutcome> {
  return new Promise((resolve) => {
    const manager = getApprovalManager();
    let settled = false;
    const finish = (outcome: ConnectorApprovalOutcome) => {
      if (settled) return;
      settled = true;
      manager.events.off('event', onEvent);
      abortSignal?.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
      resolve(outcome);
    };
    const onEvent = (event: unknown) => {
      if (
        !event ||
        typeof event !== 'object' ||
        (event as { type?: unknown }).type !== 'decided'
      ) {
        return;
      }
      const approval = (
        event as { approval?: { id?: string; status?: string } }
      ).approval;
      if (approval?.id !== approvalId) return;
      finish(approval.status === 'approved' ? 'approved' : 'rejected');
    };
    const onAbort = () => finish('rejected');
    const timeout = setTimeout(() => finish('timeout'), timeoutMs);

    manager.events.on('event', onEvent);
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}
