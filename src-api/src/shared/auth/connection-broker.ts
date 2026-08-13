/**
 * Connection Broker
 *
 * Unified facade over all OAuth connections. Provides a single point
 * of access for integration clients to obtain authenticated fetch
 * wrappers without managing tokens themselves.
 *
 * Internally delegates to token-manager for storage and oauth-client
 * for token refresh. The broker tracks connection state, serialises
 * concurrent refresh requests, and emits events on state changes.
 */

import { EventEmitter } from 'events';

import { createLogger } from '@/shared/utils/logger';

import { refreshAccessToken, revokeConnection } from './oauth-client';
import * as tokenManager from './token-manager';
import type {
  ConnectionEvent,
  ConnectionStatus,
  HealthStatus,
  OAuthProvider,
} from './types';

const logger = createLogger('ConnectionBroker');

// ============================================================================
// Types
// ============================================================================

export interface ConnectionState {
  provider: OAuthProvider;
  status: ConnectionStatus;
  health: HealthStatus;
  lastRefresh: string | null;
  lastHealthCheck: string | null;
  consecutiveRefreshFailures: number;
}

export type AuthenticatedFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

// ============================================================================
// Custom error for revoked connections
// ============================================================================

export class ConnectionRevokedError extends Error {
  constructor(public readonly provider: OAuthProvider) {
    super(`Connection to ${provider} has been revoked. Please re-authorize.`);
    this.name = 'ConnectionRevokedError';
  }
}

// ============================================================================
// ConnectionBroker singleton
// ============================================================================

class ConnectionBroker extends EventEmitter {
  private registry = new Map<OAuthProvider, ConnectionState>();

  /**
   * Mutex map — prevents concurrent refresh requests for the same provider.
   * If a refresh is already in-flight, subsequent callers await the same promise.
   */
  private refreshLocks = new Map<OAuthProvider, Promise<boolean>>();

  // --------------------------------------------------------------------------
  // Initialisation
  // --------------------------------------------------------------------------

  /** Populate the registry from the persisted token store */
  async initialize(): Promise<void> {
    const connections = await tokenManager.getAllConnections();
    for (const conn of connections) {
      this.registry.set(conn.provider, {
        provider: conn.provider,
        status: conn.status,
        health: conn.status === 'active' ? 'unknown' : 'revoked',
        lastRefresh: null,
        lastHealthCheck: null,
        consecutiveRefreshFailures: 0,
      });
    }
    logger.info(`Broker initialised with ${this.registry.size} connection(s)`);
  }

  // --------------------------------------------------------------------------
  // Core API — getServiceClient
  // --------------------------------------------------------------------------

  /**
   * Return an authenticated fetch wrapper for the given provider.
   * The returned function automatically injects the Authorization header
   * and any provider-specific headers (e.g., Notion-Version).
   *
   * Throws `ConnectionRevokedError` if the connection is missing or revoked.
   */
  async getServiceClient(provider: OAuthProvider): Promise<AuthenticatedFetch> {
    const state = this.registry.get(provider);
    if (state?.status === 'revoked') {
      throw new ConnectionRevokedError(provider);
    }

    // Obtain a valid access token (may trigger on-demand refresh for Google)
    const token = await this.getToken(provider);
    if (!token) {
      throw new ConnectionRevokedError(provider);
    }

    return (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);

      if (provider === 'notion') {
        headers.set('Notion-Version', '2022-06-28');
        if (!headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json');
        }
      }

      if (provider === 'slack' && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json; charset=utf-8');
      }

      return fetch(url, { ...init, headers });
    };
  }

  // --------------------------------------------------------------------------
  // Token management (with refresh mutex)
  // --------------------------------------------------------------------------

  /**
   * Get a valid access token for a provider.
   * For Google, handles refresh with a mutex so concurrent callers
   * don't each trigger their own refresh request.
   */
  private async getToken(provider: OAuthProvider): Promise<string | null> {
    const tokens = await tokenManager.getTokens(provider);
    if (!tokens) return null;

    // Slack / Notion tokens don't expire — return directly.
    const refreshable =
      provider === 'google' ||
      provider === 'box' ||
      provider === 'dropbox' ||
      provider === 'onedrive';
    if (!refreshable) return tokens.accessToken;

    if (!tokenManager.isTokenExpired(tokens)) {
      return tokens.accessToken;
    }

    return this.refreshWithLock(provider);
  }

  private async refreshWithLock(
    provider: OAuthProvider,
  ): Promise<string | null> {
    // If a refresh is already in-flight, wait for it
    const existing = this.refreshLocks.get(provider);
    if (existing) {
      const success = await existing;
      if (success) {
        const freshTokens = await tokenManager.getTokens(provider);
        return freshTokens?.accessToken ?? null;
      }
      return null;
    }

    // Start a new refresh
    const refreshPromise = this.doRefresh(provider);
    this.refreshLocks.set(provider, refreshPromise);

    try {
      const success = await refreshPromise;
      if (success) {
        const freshTokens = await tokenManager.getTokens(provider);
        return freshTokens?.accessToken ?? null;
      }
      return null;
    } finally {
      this.refreshLocks.delete(provider);
    }
  }

  private async doRefresh(provider: OAuthProvider): Promise<boolean> {
    try {
      const refreshed = await refreshAccessToken(provider);
      if (refreshed) {
        const state = this.registry.get(provider);
        if (state) {
          state.status = 'active';
          state.lastRefresh = new Date().toISOString();
          state.consecutiveRefreshFailures = 0;
        }
        this.emitEvent({ type: 'refreshed', provider });
        logger.info(`Broker: ${provider} token refreshed`);
        return true;
      }

      this.incrementRefreshFailures(provider);
      return false;
    } catch (err) {
      logger.error(`Broker: ${provider} refresh threw:`, err);
      this.incrementRefreshFailures(provider);
      return false;
    }
  }

  private incrementRefreshFailures(provider: OAuthProvider): void {
    const state = this.registry.get(provider);
    if (!state) return;

    state.consecutiveRefreshFailures++;
    if (state.consecutiveRefreshFailures >= 3) {
      state.status = 'expired';
      state.health = 'revoked';
      this.emitEvent({ type: 'expired', provider });
    }
  }

  // --------------------------------------------------------------------------
  // Connection state queries
  // --------------------------------------------------------------------------

  getConnectionStatus(provider: OAuthProvider): ConnectionState | null {
    return this.registry.get(provider) ?? null;
  }

  getAllConnectionStates(): ConnectionState[] {
    return Array.from(this.registry.values());
  }

  // --------------------------------------------------------------------------
  // Connection lifecycle
  // --------------------------------------------------------------------------

  /** Called when a new connection is established (after OAuth exchange) */
  registerConnection(provider: OAuthProvider): void {
    this.registry.set(provider, {
      provider,
      status: 'active',
      health: 'unknown',
      lastRefresh: null,
      lastHealthCheck: null,
      consecutiveRefreshFailures: 0,
    });
    this.emitEvent({ type: 'connected', provider });
    logger.info(`Broker: ${provider} connection registered`);
  }

  /** Called when a connection is disconnected */
  async disconnectProvider(provider: OAuthProvider): Promise<void> {
    await revokeConnection(provider);
    this.registry.delete(provider);
    this.emitEvent({ type: 'disconnected', provider });
    logger.info(`Broker: ${provider} disconnected`);
  }

  /** Update health status (called by health monitor) */
  updateHealth(
    provider: OAuthProvider,
    health: HealthStatus,
    _error?: string,
  ): void {
    const state = this.registry.get(provider);
    if (!state) return;

    state.health = health;
    state.lastHealthCheck = new Date().toISOString();

    if (health === 'revoked' && state.status !== 'revoked') {
      state.status = 'revoked';
      this.emitEvent({ type: 'revoked', provider });
    }
  }

  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------

  onConnectionChanged(callback: (event: ConnectionEvent) => void): () => void {
    this.on('connection-changed', callback);
    return () => this.off('connection-changed', callback);
  }

  private emitEvent(event: ConnectionEvent): void {
    this.emit('connection-changed', event);
  }
}

// ============================================================================
// Singleton instance
// ============================================================================

let brokerInstance: ConnectionBroker | null = null;

/** Get (or create) the global ConnectionBroker singleton */
export function getConnectionBroker(): ConnectionBroker {
  if (!brokerInstance) {
    brokerInstance = new ConnectionBroker();
  }
  return brokerInstance;
}

/** Initialise the broker — call once at startup after config is loaded */
export async function initConnectionBroker(): Promise<ConnectionBroker> {
  const broker = getConnectionBroker();
  await broker.initialize();
  return broker;
}
