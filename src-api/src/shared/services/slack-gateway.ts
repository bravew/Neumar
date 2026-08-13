/**
 * Slack Gateway — Bolt.js Socket Mode gateway with EventEmitter pattern
 *
 * Receives DMs and @mentions, normalizes to SlackInboundMessage,
 * emits 'inbound-message'. Handles assistant_thread_started with suggested prompts.
 */

import { EventEmitter } from 'events';

import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SlackGateway');

// ============================================================================
// Types
// ============================================================================

export type GatewayState = 'stopped' | 'starting' | 'running' | 'error';

export interface GatewayStatus {
  state: GatewayState;
  connectedAt: string | null;
  lastMessageAt: string | null;
  error: string | null;
  stats: {
    messagesReceived: number;
    messagesProcessed: number;
    errors: number;
  };
}

export interface SlackInboundMessage {
  teamId: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string;
  text: string;
  type: 'dm' | 'mention' | 'assistant_thread';
}

export interface SlackGatewayConfig {
  botToken: string;
  appToken: string;
  listenToDMs: boolean;
  listenToMentions: boolean;
}

// ============================================================================
// Suggested prompts for assistant_thread_started
// ============================================================================

const SUGGESTED_PROMPTS = [
  {
    title: 'Summarize channel',
    message: 'Summarize the recent messages in this channel',
  },
  { title: 'Search Slack', message: 'Search Slack for messages about...' },
  { title: 'Draft message', message: 'Draft a message to #general about...' },
  { title: 'Start a task', message: 'Create a task to...' },
];

// ============================================================================
// SlackGateway class
// ============================================================================

export class SlackGateway extends EventEmitter {
  private app: App | null = null;
  private client: WebClient | null = null;
  private config: SlackGatewayConfig | null = null;
  private state: GatewayState = 'stopped';
  private connectedAt: string | null = null;
  private lastMessageAt: string | null = null;
  private lastError: string | null = null;
  private stats = {
    messagesReceived: 0,
    messagesProcessed: 0,
    errors: 0,
  };

  async start(config: SlackGatewayConfig): Promise<void> {
    if (this.state === 'running') {
      logger.warn('Gateway already running');
      return;
    }
    if (this.state === 'starting') {
      logger.warn('Gateway already starting');
      return;
    }

    this.state = 'starting';
    this.lastError = null;
    this.config = config;

    try {
      this.app = new App({
        token: config.botToken,
        appToken: config.appToken,
        socketMode: true,
      });

      this.client = new WebClient(config.botToken);
      this.registerEventHandlers();

      await this.app.start();
      this.state = 'running';
      this.connectedAt = new Date().toISOString();
      logger.info('Slack gateway started');
      this.emit('started');
    } catch (err) {
      this.state = 'error';
      this.connectedAt = null;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.stats.errors += 1;
      logger.error('Failed to start Slack gateway', err);
      this.emit('error', err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.app) {
      this.state = 'stopped';
      return;
    }
    try {
      await this.app.stop();
    } catch (err) {
      logger.warn('Error stopping Slack gateway', err);
    } finally {
      this.app = null;
      this.client = null;
      this.config = null;
      this.state = 'stopped';
      this.connectedAt = null;
      logger.info('Slack gateway stopped');
      this.emit('stopped');
    }
  }

  async restart(config: SlackGatewayConfig): Promise<void> {
    await this.stop();
    await this.start(config);
  }

  getStatus(): GatewayStatus {
    return {
      state: this.state,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      error: this.lastError,
      stats: { ...this.stats },
    };
  }

  /** Get the WebClient instance (available while gateway is running) */
  getClient(): WebClient | null {
    return this.client;
  }

  async testConnectivity(config: SlackGatewayConfig): Promise<{
    authValid: boolean;
    gatewayRunning: boolean;
    canSendMessage: boolean;
  }> {
    const client = new WebClient(config.botToken);
    let authValid = false;
    let canSendMessage = false;
    let botId: string | undefined;

    try {
      const auth = await client.auth.test();
      authValid = auth.ok === true;
      botId = auth.bot_id;
    } catch {
      authValid = false;
    }

    const gatewayRunning = this.state === 'running';

    // Bot can send messages if auth is valid and it has a bot_id
    canSendMessage = authValid && gatewayRunning && Boolean(botId);

    return { authValid, gatewayRunning, canSendMessage };
  }

  private registerEventHandlers(): void {
    if (!this.app || !this.config) return;

    const { listenToDMs, listenToMentions } = this.config;

    this.app.event('message', async ({ event, body, client: boltClient }) => {
      this.stats.messagesReceived += 1;
      this.lastMessageAt = new Date().toISOString();

      const ev = event as {
        bot_id?: string;
        subtype?: string;
        channel_type?: string;
        channel: string;
        ts: string;
        thread_ts?: string;
        user?: string;
        text?: string;
      };
      if (ev.bot_id || ev.subtype === 'bot_message') {
        return;
      }
      if (!listenToDMs) return;

      if (ev.channel_type !== 'im') return;

      const msg: SlackInboundMessage = {
        teamId: body.team_id ?? '',
        channelId: ev.channel,
        threadTs: ev.thread_ts ?? ev.ts,
        messageTs: ev.ts,
        userId: ev.user ?? '',
        text: ev.text ?? '',
        type: 'dm',
      };

      this.stats.messagesProcessed += 1;
      this.emit('inbound-message', msg, boltClient);
    });

    this.app.event(
      'app_mention',
      async ({ event, body, client: boltClient }) => {
        this.stats.messagesReceived += 1;
        this.lastMessageAt = new Date().toISOString();

        if (!listenToMentions) return;

        const msg: SlackInboundMessage = {
          teamId: body.team_id ?? '',
          channelId: event.channel,
          threadTs: (event as { thread_ts?: string }).thread_ts ?? event.ts,
          messageTs: event.ts,
          userId: event.user ?? '',
          text: event.text ?? '',
          type: 'mention',
        };

        this.stats.messagesProcessed += 1;
        this.emit('inbound-message', msg, boltClient);
      },
    );

    // assistant_thread_started is not in Bolt typings; use type assertion
    (
      this.app as {
        event: (name: string, fn: (args: unknown) => Promise<void>) => void;
      }
    ).event('assistant_thread_started', async (args: unknown) => {
      const { event, client } = args as {
        event: {
          assistant_thread?: { channel_id?: string; thread_ts?: string };
        };
        client: WebClient;
      };
      const assistantThread = event.assistant_thread;
      if (!assistantThread?.channel_id || !assistantThread?.thread_ts) {
        logger.warn('assistant_thread_started missing channel_id or thread_ts');
        return;
      }

      try {
        await client.apiCall('assistant.threads.setSuggestedPrompts', {
          channel_id: assistantThread.channel_id,
          thread_ts: assistantThread.thread_ts,
          title: 'What can I help you with?',
          prompts: SUGGESTED_PROMPTS,
        });
      } catch (err) {
        this.stats.errors += 1;
        logger.warn('Failed to set suggested prompts', err);
      }
    });
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Convert SlackConfig to SlackGatewayConfig for gateway start/restart/test */
export function toGatewayConfig(config: {
  botToken: string;
  appToken: string;
  gateway?: { listenToDMs?: boolean; listenToMentions?: boolean };
}): SlackGatewayConfig {
  return {
    botToken: config.botToken,
    appToken: config.appToken,
    listenToDMs: config.gateway?.listenToDMs ?? true,
    listenToMentions: config.gateway?.listenToMentions ?? true,
  };
}

// ============================================================================
// Singleton export
// ============================================================================

export const slackGateway = new SlackGateway();
