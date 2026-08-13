import {
  createChannelSession,
  getChannelSession,
  getChannelSessionById,
  updateChannelSession,
} from '@/shared/db/operations';
import { createSession as createAgentSession } from '@/shared/services/agent';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ChannelSessionManager');

export class ChannelSessionManager {
  async getOrCreate(
    configId: string,
    platform: string,
    sessionKey: string,
    channelUserId: string,
  ): Promise<{ sessionId: string; agentSessionId: string }> {
    let session = getChannelSession(configId, sessionKey);

    if (!session) {
      session = createChannelSession({
        id: crypto.randomUUID(),
        platform,
        config_id: configId,
        session_key: sessionKey,
        channel_user_id: channelUserId,
        status: 'active',
      });
    }

    if (!session.agent_session_id) {
      // Create a new agent session
      const agentSession = createAgentSession('execute');
      session = updateChannelSession(session.id, {
        agent_session_id: agentSession.id,
        last_activity_at: new Date().toISOString(),
      })!;
      logger.info(
        `Created agent session ${agentSession.id} for channel session ${session.id}`,
      );
    } else {
      updateChannelSession(session.id, {
        last_activity_at: new Date().toISOString(),
      });
    }

    return { sessionId: session.id, agentSessionId: session.agent_session_id! };
  }

  updateTask(sessionId: string, taskId: string): void {
    updateChannelSession(sessionId, { agent_task_id: taskId });
  }

  recordError(sessionId: string): void {
    const session = getChannelSessionById(sessionId);
    if (session) {
      updateChannelSession(sessionId, {
        error_count: (session.error_count ?? 0) + 1,
      });
    }
  }
}

let _sessionManager: ChannelSessionManager | null = null;

export function getChannelSessionManager(): ChannelSessionManager {
  return (_sessionManager ??= new ChannelSessionManager());
}
