import type { ChannelHealth } from '../channels/types';

/**
 * Gateway Metrics
 *
 * Collects and exposes gateway performance metrics.
 */

export interface ChannelMetrics {
  status: ChannelHealth | 'disconnected' | 'error';
  messagesIn: number;
  messagesOut: number;
  errors: number;
  avgLatencyMs: number;
  lastHeartbeat: string | null;
}

export interface MetricsSnapshot {
  channels: Record<string, ChannelMetrics>;
  activeAgentRuns: number;
  totalAgentRuns: number;
  totalTokensUsed: number;
  guardrailBlocks: number;
  rateLimitHits: number;
  uptime: number;
}

export class GatewayMetrics {
  private startTime = Date.now();
  private channels = new Map<string, ChannelMetrics>();
  private _totalAgentRuns = 0;
  private _activeAgentRuns = 0;
  private _totalTokensUsed = 0;
  private _guardrailBlocks = 0;
  private _rateLimitHits = 0;

  initChannel(
    channelId: string,
    status: ChannelMetrics['status'] = 'disconnected',
  ): void {
    if (!this.channels.has(channelId)) {
      this.channels.set(channelId, {
        status,
        messagesIn: 0,
        messagesOut: 0,
        errors: 0,
        avgLatencyMs: 0,
        lastHeartbeat: null,
      });
    }
  }

  setChannelStatus(channelId: string, status: ChannelMetrics['status']): void {
    const m = this.channels.get(channelId);
    if (m) m.status = status;
  }

  recordInbound(channelId: string): void {
    const m = this.channels.get(channelId);
    if (m) m.messagesIn++;
  }

  recordOutbound(channelId: string): void {
    const m = this.channels.get(channelId);
    if (m) m.messagesOut++;
  }

  recordError(channelId: string): void {
    const m = this.channels.get(channelId);
    if (m) m.errors++;
  }

  recordAgentRun(): void {
    this._totalAgentRuns++;
    this._activeAgentRuns++;
  }

  recordAgentRunComplete(): void {
    this._activeAgentRuns = Math.max(0, this._activeAgentRuns - 1);
  }

  recordTokenUsage(tokens: number): void {
    this._totalTokensUsed += tokens;
  }

  recordGuardrailBlock(): void {
    this._guardrailBlocks++;
  }

  recordRateLimited(): void {
    this._rateLimitHits++;
  }

  heartbeat(channelId: string): void {
    const m = this.channels.get(channelId);
    if (m) m.lastHeartbeat = new Date().toISOString();
  }

  getSnapshot(): MetricsSnapshot {
    const channelData: Record<string, ChannelMetrics> = {};
    for (const [id, m] of this.channels) {
      channelData[id] = { ...m };
    }

    return {
      channels: channelData,
      activeAgentRuns: this._activeAgentRuns,
      totalAgentRuns: this._totalAgentRuns,
      totalTokensUsed: this._totalTokensUsed,
      guardrailBlocks: this._guardrailBlocks,
      rateLimitHits: this._rateLimitHits,
      uptime: Math.round((Date.now() - this.startTime) / 1000),
    };
  }

  get activeChannelCount(): number {
    let count = 0;
    for (const m of this.channels.values()) {
      if (m.status === 'connected') count++;
    }
    return count;
  }

  get totalChannelCount(): number {
    return this.channels.size;
  }

  get messagesToday(): number {
    let total = 0;
    for (const m of this.channels.values()) {
      total += m.messagesIn + m.messagesOut;
    }
    return total;
  }

  get errorsToday(): number {
    let total = 0;
    for (const m of this.channels.values()) {
      total += m.errors;
    }
    return total;
  }
}
