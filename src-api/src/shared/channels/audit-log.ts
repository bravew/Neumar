import { insertChannelAuditLog } from '@/shared/db/operations';

export class AuditLog {
  async write(
    action: string,
    channelUserId: string | null,
    platform: string | null,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      // Extract configId from details if provided by callers
      const configId =
        typeof details.configId === 'string' ? details.configId : undefined;
      insertChannelAuditLog({
        id: crypto.randomUUID(),
        channel_user_id: channelUserId,
        platform,
        config_id: configId,
        action,
        details: JSON.stringify(details),
      });
    } catch {
      // Non-fatal — audit log failures should not block message processing
    }
  }
}

let _auditLog: AuditLog | null = null;

export function getAuditLog(): AuditLog {
  return (_auditLog ??= new AuditLog());
}
