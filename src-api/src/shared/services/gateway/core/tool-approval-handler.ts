/**
 * Tool Approval Handler
 *
 * Surfaces agent tool-approval requests in messaging channels.
 * Manages pending approvals with timeout.
 */

import { createLogger } from '@/shared/utils/logger';

import type {
  ActionButton,
  ChannelAdapter,
  OutboundContent,
} from '../channels/types';
import * as db from '../shared/db/operations';
import { sendWithRetry } from './outbound-pipeline';

const logger = createLogger('ToolApproval');

interface PendingApproval {
  id: string;
  identityId: string;
  channelId: string;
  chatId: string;
  toolName: string;
  toolInput: string;
  resolve: (approved: boolean) => void;
  timer: NodeJS.Timeout;
}

const MAX_PENDING_APPROVALS = 100;
const pendingApprovals = new Map<string, PendingApproval>();

export function createToolApprovalRequest(
  identityId: string,
  channelId: string,
  chatId: string,
  toolName: string,
  toolInput: string,
  adapter: ChannelAdapter,
  timeoutSeconds: number,
): Promise<boolean> {
  const id = crypto.randomUUID();

  // Enforce size limit — evict oldest if at capacity
  if (pendingApprovals.size >= MAX_PENDING_APPROVALS) {
    const oldestKey = pendingApprovals.keys().next().value;
    if (oldestKey) {
      const oldest = pendingApprovals.get(oldestKey)!;
      clearTimeout(oldest.timer);
      oldest.resolve(false);
      pendingApprovals.delete(oldestKey);
      logger.warn(
        `Evicted oldest pending approval (${oldestKey}) due to size limit`,
      );
    }
  }

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(id);
      resolve(false);
      db.writeAuditLog(
        crypto.randomUUID(),
        identityId,
        channelId,
        'tool_denied',
        {
          toolName,
          reason: 'timeout',
        },
      );
      logger.info(`Tool approval timed out for ${toolName} (${id})`);
    }, timeoutSeconds * 1000);

    pendingApprovals.set(id, {
      id,
      identityId,
      channelId,
      chatId,
      toolName,
      toolInput,
      resolve,
      timer,
    });

    // Send approval request to channel
    const buttons: ActionButton[] = adapter.capabilities.supportsButtons
      ? [
          {
            id: `approve_${id}`,
            label: 'Approve',
            style: 'primary',
            action: 'approve_tool',
            payload: id,
          },
          {
            id: `deny_${id}`,
            label: 'Deny',
            style: 'danger',
            action: 'deny_tool',
            payload: id,
          },
        ]
      : [];

    const content: OutboundContent = {
      text: `**Tool approval required:**\n\`${toolName}\`\n\n\`\`\`\n${truncateInput(toolInput, 500)}\n\`\`\`\n\n${buttons.length === 0 ? 'Reply `/approve` or `/deny` to respond.' : ''}`,
      format: 'markdown',
      buttons,
    };

    sendWithRetry(adapter, chatId, content).catch((err) => {
      logger.error('Failed to send tool approval request', err);
    });
  });
}

export function resolveApproval(
  approvalId: string,
  approved: boolean,
): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;

  clearTimeout(pending.timer);
  pendingApprovals.delete(approvalId);
  pending.resolve(approved);

  db.writeAuditLog(
    crypto.randomUUID(),
    pending.identityId,
    pending.channelId,
    approved ? 'tool_approved' : 'tool_denied',
    { toolName: pending.toolName, approvalId },
  );

  return true;
}

export function clearAllPendingApprovals(): void {
  for (const p of pendingApprovals.values()) {
    clearTimeout(p.timer);
  }
  pendingApprovals.clear();
}

export function getPendingApprovalsForIdentity(
  identityId: string,
): PendingApproval[] {
  return Array.from(pendingApprovals.values()).filter(
    (p) => p.identityId === identityId,
  );
}

function truncateInput(input: string, maxLen: number): string {
  // Sanitize backticks to prevent breaking out of markdown code fences
  const sanitized = input.replaceAll('```', '` ` `');
  if (sanitized.length <= maxLen) return sanitized;
  return sanitized.slice(0, maxLen) + '\n... (truncated)';
}
