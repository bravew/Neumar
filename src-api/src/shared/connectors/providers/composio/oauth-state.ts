import { randomBytes } from 'crypto';

import { ConnectorServiceError } from './errors';

export interface PendingOAuthState {
  connectorId: string;
  scopeKey: string;
  userId: string;
  authConfigId: string;
  expiresAt: number;
}

export class OAuthStateStore {
  private readonly states = new Map<string, PendingOAuthState>();

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly now = () => Date.now(),
  ) {}

  create(input: Omit<PendingOAuthState, 'expiresAt'>): {
    state: string;
    expiresAt: string;
  } {
    this.pruneExpired();
    const state = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + this.ttlMs;
    this.states.set(state, { ...input, expiresAt });
    return { state, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(state: string, connectorId: string): PendingOAuthState {
    const pending = this.states.get(state);
    this.states.delete(state);

    if (!pending) {
      throw new ConnectorServiceError(
        'VALIDATION_FAILED',
        'OAuth state is missing or already used.',
        { status: 400 },
      );
    }

    if (pending.expiresAt <= this.now()) {
      throw new ConnectorServiceError(
        'VALIDATION_FAILED',
        'OAuth state expired.',
        {
          status: 400,
        },
      );
    }

    if (pending.connectorId !== connectorId) {
      throw new ConnectorServiceError(
        'VALIDATION_FAILED',
        'OAuth state does not match connector.',
        { status: 400 },
      );
    }

    return pending;
  }

  cancelConnector(connectorId: string): void {
    for (const [state, pending] of this.states.entries()) {
      if (pending.connectorId === connectorId) this.states.delete(state);
    }
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [state, pending] of this.states.entries()) {
      if (pending.expiresAt <= now) this.states.delete(state);
    }
  }
}
