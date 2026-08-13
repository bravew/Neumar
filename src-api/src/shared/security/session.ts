/**
 * SecuritySession — per-run, per-agent security context.
 *
 * Bundles together:
 *  - sessionId / taskId for audit correlation
 *  - profileId of the network policy in force
 *  - canary token unique to this session
 *  - audit recorder bound to this session's ids
 *
 * One SecuritySession is created when an agent run starts. Adapters,
 * sandboxes, network policy, and tool-output defense all consult the same
 * session so that a leaked canary, a denied egress, and a blocked tool result
 * can be correlated.
 */

import { randomUUID } from 'crypto';

import {
  type NetworkPolicyAuditInput,
  type SecurityEventInput,
  recordNetworkPolicyAudit,
  recordSecurityEvent,
} from '@/shared/security/audit';
import { type CanaryToken, generateCanary } from '@/shared/security/canary';

export interface SecuritySessionAudit {
  recordEvent(event: Omit<SecurityEventInput, 'sessionId' | 'taskId'>): void;
  recordNetwork(
    input: Omit<NetworkPolicyAuditInput, 'sessionId' | 'taskId'>,
  ): void;
}

export interface SecuritySession {
  readonly sessionId: string;
  readonly taskId?: string;
  readonly profileId?: string;
  readonly canary: CanaryToken;
  readonly audit: SecuritySessionAudit;
}

export interface CreateSecuritySessionOptions {
  /**
   * Stable session id used for audit correlation and canary derivation.
   * If omitted, a random UUID is generated.
   */
  sessionId?: string;
  taskId?: string;
  /** Network policy profile id this session is bound to. */
  profileId?: string;
}

export function createSecuritySession(
  options: CreateSecuritySessionOptions = {},
): SecuritySession {
  const sessionId = options.sessionId ?? randomUUID();
  const canary = generateCanary(sessionId);

  const audit: SecuritySessionAudit = {
    recordEvent(event) {
      recordSecurityEvent({
        ...event,
        sessionId,
        taskId: options.taskId,
      });
    },
    recordNetwork(input) {
      recordNetworkPolicyAudit({
        ...input,
        sessionId,
        taskId: options.taskId,
      });
    },
  };

  // Mint event so we can correlate later events back to a session start. We
  // record only the canary fingerprint, never the raw token.
  audit.recordEvent({
    eventType: 'canary.mint',
    severity: 'info',
    source: 'SecuritySession',
    action: 'mint',
    redactedSnippet: `canary fingerprint=${canary.fingerprint}`,
    metadata: { profileId: options.profileId },
  });

  return {
    sessionId,
    taskId: options.taskId,
    profileId: options.profileId,
    canary,
    audit,
  };
}
