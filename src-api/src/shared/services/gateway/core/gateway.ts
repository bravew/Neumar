/**
 * Gateway Orchestrator
 *
 * Main entry point for the multi-channel messaging gateway.
 * Manages channel lifecycle, message routing, and shutdown.
 */

import { createLogger } from '@/shared/utils/logger';

import { createChannel, createChannels } from '../channels/registry';
import { RestartPolicy } from '../channels/restart-policy';
import type { ChannelAdapter } from '../channels/types';
import { loadGatewayConfig } from '../shared/config/loader';
import type { GatewayConfig } from '../shared/config/types';
import * as dbOps from '../shared/db/operations';
import {
  loadGuardrailsProvider,
  type GuardrailsProvider,
} from '../shared/guardrails';
import { GatewayMetrics } from '../shared/metrics';
import { CircuitBreaker } from './circuit-breaker';
import { startEventListeners, stopEventListeners } from './event-listener';
import { MessageRouter } from './message-router';
import { clearAllPendingApprovals } from './tool-approval-handler';

const logger = createLogger('Gateway');

export class Gateway {
  private adapters = new Map<string, ChannelAdapter>();
  private restartPolicies = new Map<string, RestartPolicy>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  private reconnectTimers = new Set<ReturnType<typeof setTimeout>>();
  private config: GatewayConfig;
  private guardrails: GuardrailsProvider;
  private metrics: GatewayMetrics;
  private router: MessageRouter | null = null;
  private running = false;
  private shutdownInProgress = false;

  constructor() {
    this.config = loadGatewayConfig();
    this.guardrails = loadGuardrailsProvider(
      this.config.security.guardrails.provider,
      this.config.security.guardrails.failMode,
    );
    this.metrics = new GatewayMetrics();
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Gateway already running');
      return;
    }

    if (!this.config.gateway.enabled) {
      logger.info('Gateway is disabled in config');
      return;
    }

    logger.info('Starting gateway...');

    // Import channel adapters (triggers self-registration)
    await import('../channels/index');

    // Create channel adapters from config
    const channelConfigs: Record<
      string,
      { enabled: boolean; [key: string]: unknown }
    > = {};
    for (const [channelId, channelConfig] of Object.entries(
      this.config.channels,
    )) {
      channelConfigs[channelId] = channelConfig;
      this.metrics.initChannel(channelId);
    }

    const channels = createChannels(channelConfigs);
    for (const channel of channels) {
      this.adapters.set(channel.id, channel);
      this.restartPolicies.set(
        channel.id,
        new RestartPolicy(this.config.channelRestart),
      );
      this.circuitBreakers.set(
        channel.id,
        new CircuitBreaker({
          maxConsecutiveFailures: this.config.channelRestart.maxRetries,
          windowMs: this.config.channelRestart.resetAfterMs,
          halfOpenAfterMs: 300_000,
        }),
      );
    }

    // Create message router
    this.router = new MessageRouter(
      this.config,
      this.guardrails,
      this.adapters,
      this.metrics,
    );

    // Connect channels
    for (const [id, adapter] of this.adapters) {
      await this.connectChannel(id, adapter);
    }

    // Start event listeners
    startEventListeners(this.adapters);

    this.running = true;
    logger.info(
      `Gateway started with ${this.adapters.size} channel(s): ${Array.from(this.adapters.keys()).join(', ')}`,
    );
  }

  async stop(): Promise<void> {
    if (!this.running || this.shutdownInProgress) return;
    this.shutdownInProgress = true;

    logger.info('Stopping gateway...');

    // Stop event listeners
    stopEventListeners();

    // Clean up message router (clears rate limiter interval)
    this.router?.destroy();
    this.router = null;

    // Clear all pending tool approval timers
    clearAllPendingApprovals();

    // Cancel pending reconnect timers
    for (const timer of this.reconnectTimers) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Disconnect all channels
    for (const [id, adapter] of this.adapters) {
      try {
        await adapter.disconnect();
        this.metrics.setChannelStatus(id, 'disabled');
        dbOps.updateChannelStatus(id, 'disconnected');
        logger.info(`Channel ${id} disconnected`);
      } catch (err) {
        logger.error(`Failed to disconnect channel ${id}`, err);
      }
    }

    this.adapters.clear();
    this.running = false;
    this.shutdownInProgress = false;
    logger.info('Gateway stopped');
  }

  private async connectChannel(
    id: string,
    adapter: ChannelAdapter,
  ): Promise<void> {
    const config = (
      this.config.channels as Record<string, { enabled: boolean }>
    )[id];
    if (!config) return;

    try {
      const breaker = this.circuitBreakers.get(id);
      if (!breaker?.canAttempt()) {
        this.metrics.setChannelStatus(id, 'quarantined');
        dbOps.updateChannelStatus(id, 'quarantined', 'Circuit breaker open');
        return;
      }

      adapter.onMessage(async (message) => {
        if (this.router) {
          await this.router.route(message);
        }
      });

      adapter.onError((error, context) => {
        logger.error(`Channel ${id} error (${context})`, error.message);
        this.metrics.recordError(id);
        this.handleChannelError(id, adapter, error);
      });

      adapter.onPresenceChange?.((health) => {
        this.metrics.setChannelStatus(id, health);
        dbOps.updateChannelStatus(id, health);
      });

      await adapter.connect(config);
      this.metrics.setChannelStatus(id, 'connected');
      dbOps.updateChannelStatus(id, 'connected');
      this.restartPolicies.get(id)?.markStable();
      this.circuitBreakers.get(id)?.recordSuccess();
      logger.info(`Channel ${id} connected`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to connect channel ${id}`, errorMsg);
      this.metrics.setChannelStatus(id, 'error');
      dbOps.updateChannelStatus(id, 'error', errorMsg);
      this.circuitBreakers.get(id)?.recordFailure();
      this.scheduleReconnect(id, adapter);
    }
  }

  private handleChannelError(
    id: string,
    adapter: ChannelAdapter,
    _error: Error,
  ): void {
    this.metrics.setChannelStatus(id, 'error');
    dbOps.updateChannelStatus(id, 'error', _error.message);
    const state = this.circuitBreakers.get(id)?.recordFailure();
    if (state === 'open') {
      logger.error(`Channel ${id} quarantined by circuit breaker`);
      this.metrics.setChannelStatus(id, 'quarantined');
      dbOps.updateChannelStatus(id, 'quarantined', _error.message);
      dbOps.writeAuditLog(
        crypto.randomUUID(),
        null,
        id,
        'channel_quarantined',
        {
          error: _error.message,
        },
      );
      this.scheduleReconnect(id, adapter);
      return;
    }
    this.scheduleReconnect(id, adapter);
  }

  private scheduleReconnect(id: string, adapter: ChannelAdapter): void {
    const policy = this.restartPolicies.get(id);
    const breaker = this.circuitBreakers.get(id);
    if (!breaker?.canAttempt()) {
      const nextProbeAt = breaker?.nextProbeAt;
      const delay = Math.max(1000, (nextProbeAt ?? Date.now()) - Date.now());
      logger.warn(
        `Channel ${id} is quarantined; scheduling probe in ${delay}ms`,
      );
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(timer);
        if (this.shutdownInProgress) return;
        void this.connectChannel(id, adapter);
      }, delay);
      this.reconnectTimers.add(timer);
      return;
    }

    if (!policy?.shouldRetry()) {
      logger.error(`Channel ${id} exceeded max retries, giving up`);
      this.metrics.setChannelStatus(id, 'quarantined');
      dbOps.updateChannelStatus(id, 'quarantined', 'Max retries exceeded');
      return;
    }

    const delay = policy.getNextDelay();
    logger.info(`Scheduling reconnect for ${id} in ${delay}ms`);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(timer);
      if (this.shutdownInProgress) return;
      try {
        await adapter.disconnect();
      } catch {
        // Ignore disconnect errors during reconnect
      }
      try {
        await this.connectChannel(id, adapter);
      } catch (err) {
        logger.error(
          `Reconnect failed for channel ${id}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }, delay);
    this.reconnectTimers.add(timer);
  }

  reloadConfig(): void {
    this.config = loadGatewayConfig(true);
    this.guardrails = loadGuardrailsProvider(
      this.config.security.guardrails.provider,
      this.config.security.guardrails.failMode,
    );
  }

  // Public API for admin routes
  getMetrics(): GatewayMetrics {
    return this.metrics;
  }

  getAdapter(channelId: string): ChannelAdapter | undefined {
    return this.adapters.get(channelId);
  }

  getAdapters(): Map<string, ChannelAdapter> {
    return this.adapters;
  }

  isRunning(): boolean {
    return this.running;
  }

  getConfig(): GatewayConfig {
    return this.config;
  }

  getRouter(): MessageRouter | null {
    return this.router;
  }

  async startChannel(channelId: string): Promise<void> {
    const existing = this.adapters.get(channelId);
    if (existing?.isConnected()) {
      logger.warn(`Channel ${channelId} already connected`);
      return;
    }

    // Reimport to get fresh adapter
    const config = (
      this.config.channels as Record<string, { enabled: boolean }>
    )[channelId];
    if (!config) throw new Error(`No config for channel ${channelId}`);

    // Force enabled=true since user explicitly clicked Start
    const startConfig = { ...config, enabled: true };

    await import('../channels/index');
    const adapter = createChannel(channelId, startConfig);
    if (!adapter) throw new Error(`Failed to create adapter for ${channelId}`);

    this.adapters.set(channelId, adapter);
    await this.connectChannel(channelId, adapter);
  }

  async stopChannel(channelId: string): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) return;

    await adapter.disconnect();
    this.adapters.delete(channelId);
    this.metrics.setChannelStatus(channelId, 'disabled');
    dbOps.updateChannelStatus(channelId, 'disconnected');
  }

  async testChannel(
    channelId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const adapter = this.adapters.get(channelId);
    if (adapter?.isConnected()) {
      return { success: true };
    }

    const config = (
      this.config.channels as Record<string, { enabled: boolean }>
    )[channelId];
    if (!config) return { success: false, error: 'No configuration found' };

    // Channel-specific lightweight credential tests (no long-polling needed)
    try {
      if (channelId === 'telegram') {
        return await this.testTelegram(
          config as { botToken?: string; enabled: boolean },
        );
      }

      if (channelId === 'discord') {
        return await this.testDiscord(
          config as {
            botToken?: string;
            applicationId?: string;
            enabled: boolean;
          },
        );
      }

      // Generic fallback: create adapter, connect, disconnect
      const testConfig = { ...config, enabled: true };
      await import('../channels/index');
      const testAdapter = createChannel(channelId, testConfig);
      if (!testAdapter) {
        logger.warn(
          `testChannel: createChannel returned null for '${channelId}'. Config keys: ${Object.keys(config).join(', ')}`,
        );
        return {
          success: false,
          error: 'Adapter creation failed (missing credentials?)',
        };
      }
      await testAdapter.connect(testConfig);
      await testAdapter.disconnect();
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async testTelegram(config: {
    botToken?: string;
    enabled: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    if (!config.botToken) {
      return { success: false, error: 'Bot token is required' };
    }
    // Use Telegram Bot API directly — avoids importing grammy (which fails
    // in CJS bundles due to ESM interop issues with dynamic import)
    const res = await fetch(
      `https://api.telegram.org/bot${config.botToken}/getMe`,
    );
    if (!res.ok) {
      const body = await res.text();
      return {
        success: false,
        error: `Telegram API error ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as {
      ok: boolean;
      result?: { username: string };
    };
    if (!data.ok) {
      return { success: false, error: 'Telegram API returned ok=false' };
    }
    logger.info(`Telegram test passed: @${data.result?.username}`);
    return { success: true };
  }

  /**
   * Lightweight Discord test using REST API only — no gateway/WebSocket connection.
   * Calls GET /users/@me to validate the bot token without opening a gateway session,
   * which would invalidate any existing running bot connection.
   */
  private async testDiscord(config: {
    botToken?: string;
    applicationId?: string;
    enabled: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    if (!config.botToken) {
      return { success: false, error: 'Bot token is required' };
    }
    // Use Discord REST API directly — avoids opening a gateway WebSocket
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${config.botToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        success: false,
        error: `Discord API error ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const user = (await res.json()) as { username: string; id: string };
    logger.info(`Discord test passed: ${user.username} (${user.id})`);
    return { success: true };
  }
}

// Singleton
let gatewayInstance: Gateway | null = null;

export function getGateway(): Gateway {
  if (!gatewayInstance) {
    gatewayInstance = new Gateway();
  }
  return gatewayInstance;
}
