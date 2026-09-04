import { createHash } from 'node:crypto';

import { recordSecurityEvent } from '@/shared/security/audit';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ExternalMcpAudit');

export function recordExternalMcpAudit(input: {
  action: 'allow' | 'block';
  route: string;
  method: string;
  taskId?: string;
  code?: string;
}): void {
  try {
    recordSecurityEvent({
      taskId: input.taskId,
      eventType: 'external_mcp.command',
      severity: input.action === 'block' ? 'warn' : 'info',
      source: 'external-mcp',
      action: input.action,
      payloadHash: createHash('sha256')
        .update(`${input.method} ${input.route}`)
        .digest('hex'),
      redactedSnippet: `${input.method} ${input.route}${
        input.code ? ` ${input.code}` : ''
      }`,
      metadata: {
        route: input.route,
        method: input.method,
        code: input.code,
      },
    });
  } catch (err) {
    logger.warn('Failed to record external MCP audit event', { err });
  }
}
