/**
 * Gateway Session Manager
 *
 * Manages per-channel sessions and links to API agent sessions.
 */

import { createLogger } from '@/shared/utils/logger';

import type {
  GatewayIdentity,
  GatewaySession,
  InboundMessage,
} from '../channels/types';
import * as db from '../shared/db/operations';

const logger = createLogger('GatewaySessionMgr');

export function getOrCreateSession(
  message: InboundMessage,
  identity: GatewayIdentity,
): GatewaySession {
  const existing = db.getSession(
    message.channelId,
    message.chatId,
    identity.id,
  );
  if (existing) {
    db.updateSession(existing.id, {
      last_message_at: new Date().toISOString(),
    });
    return existing;
  }

  const id = crypto.randomUUID();
  const session = db.createSession(
    id,
    identity.id,
    message.channelId,
    message.chatId,
  );
  logger.info(
    `Created gateway session ${id} for ${message.channelId}:${message.chatId}`,
  );
  return session;
}

export function updateSessionAgent(
  sessionId: string,
  apiSessionId: string,
  apiTaskId: string,
): void {
  db.updateSession(sessionId, {
    api_session_id: apiSessionId,
    api_task_id: apiTaskId,
  });
}

export function markSessionError(sessionId: string, error: string): void {
  const session = db.getSessionById(sessionId);
  if (!session) return;
  db.updateSession(sessionId, {
    last_error: error,
    error_count: session.error_count + 1,
  });
}
