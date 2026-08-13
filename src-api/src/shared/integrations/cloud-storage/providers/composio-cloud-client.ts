/**
 * Shared HTTP client for Composio-backed first-party cloud-storage adapters
 * (Box, Dropbox, OneDrive). Handles:
 *   - Pulling the OAuth access_token from Composio via the credential broker.
 *   - One transparent retry with `force: true` on 401, in case the cached
 *     token has been rotated by Composio's refresh background job.
 *   - Per-call timeouts, AbortSignal forwarding, and CloudStorageError
 *     mapping consistent with the Google Drive local adapter.
 */
import {
  ComposioCredentialError,
  fetchComposioAccessToken,
} from '@/shared/connectors/providers/composio/credentials';

import { CloudStorageError, errorCodeFromStatus } from '../errors';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ComposioCloudFetchInit extends RequestInit {
  /** Force-refresh the cached token before this call. */
  refreshToken?: boolean;
  /** Per-call timeout override (ms). Default 30s. */
  timeoutMs?: number;
}

export class ComposioCloudClient {
  constructor(
    readonly connectorId: string,
    readonly providerLabel: string,
  ) {}

  async fetch(
    url: string,
    init: ComposioCloudFetchInit = {},
  ): Promise<Response> {
    let response = await this.attempt(url, init);
    // Composio occasionally serves a stale token if its refresh races with
    // ours; one force-refresh retry on 401 covers that without looping.
    if (response.status === 401 && !init.refreshToken) {
      response = await this.attempt(url, { ...init, refreshToken: true });
    }
    return response;
  }

  async json<T>(url: string, init: ComposioCloudFetchInit = {}): Promise<T> {
    const response = await this.fetch(url, init);
    if (!response.ok) {
      await this.throwForResponse(response);
    }
    return (await response.json()) as T;
  }

  async raw(url: string, init: ComposioCloudFetchInit = {}): Promise<Response> {
    const response = await this.fetch(url, init);
    if (!response.ok) {
      await this.throwForResponse(response);
    }
    return response;
  }

  private async attempt(
    url: string,
    init: ComposioCloudFetchInit,
  ): Promise<Response> {
    let token: string;
    try {
      token = await fetchComposioAccessToken(this.connectorId, {
        force: init.refreshToken === true,
      });
    } catch (err) {
      if (err instanceof ComposioCredentialError) {
        throw new CloudStorageError('auth_revoked', err.message, {
          status: 401,
        });
      }
      throw err;
    }

    const headers = new Headers(init.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');

    const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Always enforce a timeout, even when the caller supplies a signal —
    // otherwise a long-lived caller signal can leave us waiting on the
    // upstream's TCP timeout. Merge both with AbortSignal.any.
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutController.signal])
      : timeoutController.signal;
    try {
      return await fetch(url, { ...init, headers, signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async throwForResponse(response: Response): Promise<never> {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 400);
    } catch {
      /* body already consumed */
    }
    throw new CloudStorageError(
      errorCodeFromStatus(response.status),
      `${this.providerLabel} API error ${response.status}${detail ? `: ${detail}` : ''}`,
      { status: response.status },
    );
  }
}
