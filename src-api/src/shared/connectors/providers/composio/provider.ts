import {
  normalizeConnectorJsonObject,
  normalizeConnectorToolOutput,
  validateConnectorToolInput,
} from '@/shared/connectors/bounded-json';
import type {
  ConnectorCatalogDefinition,
  ConnectorCatalogToolDefinition,
  ConnectorDetail,
} from '@/shared/connectors/catalog';
import {
  connectorDefinitionToDetail,
  defineConnectorTool,
} from '@/shared/connectors/catalog';
import {
  getConnectorCatalogDefinitions,
  getConnectorDefinition,
} from '@/shared/connectors/seed';
import { createLogger } from '@/shared/utils/logger';

import { ComposioCatalogCache } from './catalog-cache';
import { ComposioClient } from './client';
import {
  apiKeyTail,
  type ComposioConfigStore,
  SettingsComposioConfigStore,
} from './config';
import { clearCachedAccessToken } from './credentials-cache';
import { curatedToolsFor, featuredToolsFor } from './curated-tools';
import { COMPOSIO_CURATION_OVERLAY } from './curation';
import {
  boundedJsonValueIncludesAuthStaleSignal,
  ConnectorServiceError,
  isConnectorAuthStaleError,
} from './errors';
import { OAuthStateStore } from './oauth-state';
import {
  COMPOSIO_TOOLKITS,
  getToolkitSlugForConnector as getStaticToolkitSlugForConnector,
} from './toolkits';

const logger = createLogger('Connectors');

// Composio error codes that mean "your config is wrong, not our connection".
// Retrying or logging at warn level just produces noise — the operator needs
// to fix the API key or finish setup, not wait for the issue to clear.
const PERMANENT_COMPOSIO_ERROR_CODES = new Set([
  'FORBIDDEN',
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'CONNECTOR_NOT_FOUND',
]);

function isPermanentComposioError(error: unknown): boolean {
  if (!(error instanceof ConnectorServiceError)) return false;
  return PERMANENT_COMPOSIO_ERROR_CODES.has(error.code);
}

function composioErrorCode(error: unknown): string | undefined {
  return error instanceof ConnectorServiceError ? error.code : undefined;
}

interface ComposioToolkitResponse {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  categories?: unknown;
  meta?: {
    description?: unknown;
    categories?: unknown;
    tools_count?: unknown;
    toolsCount?: unknown;
  };
}

export interface ComposioConnectionStart {
  kind: 'redirect_required';
  redirectUrl: string;
  providerConnectionId?: string;
  expiresAt?: string;
}

export interface ComposioConnectionCompletion {
  connectorId: string;
  scopeKey: string;
  connectedAccountId: string;
  accountLabel?: string;
}

export interface ComposioProviderOptions {
  config?: ComposioConfigStore;
  client?: ComposioClient;
  oauthStates?: OAuthStateStore;
  catalogCache?: ComposioCatalogCache;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class ComposioProvider {
  private readonly config: ComposioConfigStore;
  private readonly client: ComposioClient;
  private readonly oauthStates: OAuthStateStore;
  private readonly catalogCache: ComposioCatalogCache;
  private readonly authConfigCreationPromises = new Map<
    string,
    Promise<string>
  >();
  private readonly hydratedAt = new Map<string, number>();
  private static readonly HYDRATION_TTL_MS = 10 * 60 * 1000;
  private fastDefinitions = getConnectorCatalogDefinitions();

  constructor(options: ComposioProviderOptions = {}) {
    this.config = options.config ?? new SettingsComposioConfigStore();
    this.client =
      options.client ??
      new ComposioClient({
        apiKeyProvider: () => this.config.getApiKey(),
        baseUrl: options.baseUrl,
        fetchImpl: options.fetchImpl,
      });
    this.oauthStates = options.oauthStates ?? new OAuthStateStore();
    this.catalogCache = options.catalogCache ?? new ComposioCatalogCache();
    if (this.config.getApiKey()) {
      void this.disableConnectedAccountSecretMasking().catch((error) => {
        logger.warn('composio.config.unmask_failed', { error });
      });
    }
  }

  isConfigured(): boolean {
    return this.config.getApiKey() !== null;
  }

  getPublicConfig(): { configured: boolean; apiKeyTail: string } {
    const key = this.config.getApiKey();
    return { configured: key !== null, apiKeyTail: apiKeyTail(key) };
  }

  setApiKey(key: string | null): void {
    this.config.setApiKey(key);
    this.hydratedAt.clear();
    this.secretMaskingDisabled = false;
    // API-key change invalidates every cached access token: a new key
    // means a new tenant context, and any cached bearer would now belong
    // to a different account.
    clearCachedAccessToken();
    if (key === null) {
      this.fastDefinitions = getConnectorCatalogDefinitions();
    }
    logger.info('composio.config.update', { configured: key !== null });
    if (key !== null) {
      // Composio masks `access_token`/`refresh_token` in GET responses by
      // default (returns the literal string "REDACTED"). First-party
      // adapters need the raw bearer, so flip the project flag once.
      void this.disableConnectedAccountSecretMasking().catch((error) => {
        logger.warn('composio.config.unmask_failed', { error });
      });
    }
  }

  /**
   * `true` once Composio has acknowledged that connected-account secrets
   * are unmasked for this API key. Until this flips, every credential fetch
   * is at risk of returning a masked token. UI surfaces can read this to
   * warn the user that they should retry the flip manually.
   */
  isSecretMaskingDisabled(): boolean {
    return this.secretMaskingDisabled;
  }

  private secretMaskingDisabled = false;

  private async disableConnectedAccountSecretMasking(): Promise<void> {
    const attempt = async (): Promise<void> => {
      await this.client.patchJson('/api/v3.1/org/project/config', {
        mask_secret_keys_in_connected_account: false,
      });
    };
    try {
      await attempt();
    } catch (error) {
      // 4xx responses (bad key, missing project, malformed payload) are
      // permanent — retrying just produces a second copy of the same log.
      // Surface them once at info level so the UI knows masking is still on
      // and stop. Only true transient errors (network, 5xx) get a retry.
      if (isPermanentComposioError(error)) {
        logger.info('composio.config.unmask_unavailable', {
          reason: composioErrorCode(error) ?? 'unknown',
        });
        return;
      }
      logger.warn('composio.config.unmask_retry', { error });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await attempt();
      } catch (retryError) {
        if (isPermanentComposioError(retryError)) {
          logger.info('composio.config.unmask_unavailable', {
            reason: composioErrorCode(retryError) ?? 'unknown',
          });
          return;
        }
        throw retryError;
      }
    }
    this.secretMaskingDisabled = true;
    logger.info('composio.config.unmask_ok');
  }

  /**
   * Resolve the active Composio connected-account id for a connector, if
   * any. First-party MCP servers (Box, Drive, …) use this to look up which
   * account they need credentials for.
   */
  getActiveConnectedAccountId(connectorId: string): string | undefined {
    for (const scoped of Object.values(this.config.getConnectedAccountIds())) {
      const account = scoped[connectorId];
      if (account?.id) return account.id;
    }
    return undefined;
  }

  /**
   * Raw GET on `/connected_accounts/:id`. Used by the credential broker to
   * extract OAuth tokens for first-party MCP servers. Returns the parsed
   * body as-is; callers handle the variable Composio response shape.
   */
  async fetchConnectedAccount(
    connectedAccountId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.client.getJson<Record<string, unknown>>(
      `/api/v3.1/connected_accounts/${encodeURIComponent(connectedAccountId)}`,
      signal,
    );
  }

  /**
   * Force Composio to refresh the upstream OAuth token for a connected
   * account. Returns the refreshed account body (same shape as
   * fetchConnectedAccount). Best-effort: if Composio rejects the endpoint
   * (older deployments) the caller may fall back to a plain GET.
   */
  async refreshConnectedAccount(
    connectedAccountId: string,
  ): Promise<Record<string, unknown>> {
    return this.client.postJson<Record<string, unknown>>(
      `/api/v3/connected_accounts/${encodeURIComponent(connectedAccountId)}/refresh`,
      {},
    );
  }

  getConnectedConnectorIds(): Set<string> {
    const ids = new Set<string>();
    for (const scoped of Object.values(this.config.getConnectedAccountIds())) {
      for (const connectorId of Object.keys(scoped)) ids.add(connectorId);
    }
    return ids;
  }

  getFastDefinitions(): ConnectorCatalogDefinition[] {
    return cloneDefinitions(this.fastDefinitions);
  }

  async refreshCatalog(
    signal?: AbortSignal,
  ): Promise<ConnectorCatalogDefinition[]> {
    if (!this.isConfigured()) return this.getFastDefinitions();

    const definitions = await this.discoverCatalogDefinitions(signal);

    // Catalog refresh replaces every fast definition with a stub from
    // /toolkits, which drops the per-tool list we paginated in via
    // hydrateDefinition. Invalidate the TTL so the next getDetail() actually
    // re-hydrates instead of returning the empty stub.
    this.hydratedAt.clear();
    this.fastDefinitions = definitions;
    const payload = await this.catalogCache.write(definitions);
    this.config.setCatalogCacheIndex({
      path: this.catalogCache.filePath,
      fetchedAt: payload.fetchedAt,
      schemaVersion: payload.schemaVersion,
    });
    logger.info('connector.catalog.refresh', {
      outcome: 'success',
      count: definitions.length,
    });
    return cloneDefinitions(definitions);
  }

  async getDetail(
    connectorId: string,
    signal?: AbortSignal,
  ): Promise<ConnectorDetail> {
    throwIfAborted(signal);
    let definition =
      this.fastDefinitions.find((entry) => entry.id === connectorId) ??
      getConnectorDefinition(connectorId);
    if (!definition) {
      throw new ConnectorServiceError(
        'CONNECTOR_NOT_FOUND',
        `Connector ${connectorId} was not found.`,
        { details: { connectorId } },
      );
    }

    if (definition.provider === 'composio' && this.isConfigured()) {
      const lastHydrated = this.hydratedAt.get(connectorId);
      const isFresh =
        lastHydrated !== undefined &&
        Date.now() - lastHydrated < ComposioProvider.HYDRATION_TTL_MS;
      if (!isFresh) {
        try {
          definition = await this.hydrateDefinition(definition, signal);
          this.upsertFastDefinition(definition);
          this.hydratedAt.set(connectorId, Date.now());
        } catch (error) {
          logger.warn('connector.detail.hydrate_failed', {
            connectorId,
            error,
          });
        }
      }
    }

    const detail = connectorDefinitionToDetail(definition);
    const connections = Object.entries(
      this.config.getConnectedAccountIds(),
    ).flatMap(([scopeKey, scoped]) => {
      const account = scoped[connectorId];
      return account
        ? [
            {
              scopeKey,
              label: labelForScope(scopeKey),
              accountLabel: account.label,
              connectedAccountId: account.id,
              status: 'connected' as const,
            },
          ]
        : [];
    });

    if (connections.length > 0) {
      throwIfAborted(signal);
      return {
        ...detail,
        status: 'connected',
        accountLabel: connections[0]?.accountLabel,
        scopeConnections: connections,
      };
    }

    throwIfAborted(signal);
    return detail;
  }

  async prepareAuthConfig(
    connectorId: string,
  ): Promise<
    | { status: 'ready'; authConfigId: string }
    | { status: 'custom_required'; message: string }
    | { status: 'error'; message: string }
  > {
    try {
      const authConfigId = await this.getOrCreateAuthConfigId(connectorId);
      return { status: 'ready', authConfigId };
    } catch (error) {
      if (error instanceof ConnectorServiceError) {
        return { status: 'error', message: error.message };
      }
      return { status: 'error', message: 'Unable to prepare auth config.' };
    }
  }

  async startConnection(args: {
    connectorId: string;
    callbackBaseUrl: string;
    scopeKey: string;
    userId: string;
  }): Promise<ComposioConnectionStart> {
    const authConfigId = await this.getOrCreateAuthConfigId(args.connectorId);
    const { state, expiresAt } = this.oauthStates.create({
      connectorId: args.connectorId,
      scopeKey: args.scopeKey,
      userId: args.userId,
      authConfigId,
    });
    const callbackUrl = new URL(
      `/connectors/oauth/callback/${encodeURIComponent(args.connectorId)}`,
      args.callbackBaseUrl,
    );
    callbackUrl.searchParams.set('state', state);

    const response = await this.client.postJson<Record<string, unknown>>(
      '/api/v3.1/connected_accounts/link',
      {
        auth_config_id: authConfigId,
        user_id: args.userId,
        callback_url: callbackUrl.toString(),
      },
    );

    const redirectUrl = stringField(response, 'redirect_url');
    if (!redirectUrl) {
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        'Composio did not return an OAuth redirect URL.',
      );
    }

    return {
      kind: 'redirect_required',
      redirectUrl,
      providerConnectionId: stringField(response, 'connected_account_id'),
      expiresAt: stringField(response, 'expires_at') ?? expiresAt,
    };
  }

  async completeOAuthCallback(
    connectorId: string,
    state: string,
    query: URLSearchParams,
  ): Promise<ComposioConnectionCompletion> {
    const pending = this.oauthStates.consume(state, connectorId);
    if (query.get('status') !== 'success') {
      throw new ConnectorServiceError(
        'VALIDATION_FAILED',
        'Composio OAuth flow did not complete successfully.',
        { status: 400 },
      );
    }

    const connectedAccountId =
      query.get('connected_account_id') ?? query.get('connectedAccountId');
    if (!connectedAccountId) {
      throw new ConnectorServiceError(
        'VALIDATION_FAILED',
        'Composio OAuth callback did not include a connected account id.',
        { status: 400 },
      );
    }

    const account = await this.client.getJson<Record<string, unknown>>(
      `/api/v3.1/connected_accounts/${encodeURIComponent(connectedAccountId)}`,
    );
    // Composio's single-resource response is the account object directly; do
    // NOT call unwrapData here — the account has a nested `data` field holding
    // OAuth credentials, and unwrapping would descend into those.
    // Composio's response shape for GET /connected_accounts/:id varies by API
    // version: sometimes a flat object, sometimes wrapped in `data`, sometimes
    // with `auth_config` nested. Try every known location.
    const wrapped = nestedObject(account, 'data');
    const accountBody = wrapped ?? account;
    const userId =
      stringField(accountBody, 'user_id') ??
      stringField(accountBody, 'userId') ??
      stringField(nestedObject(accountBody, 'user'), 'id');
    const authConfigId =
      stringField(accountBody, 'auth_config_id') ??
      stringField(accountBody, 'authConfigId') ??
      stringField(nestedObject(accountBody, 'auth_config'), 'id') ??
      stringField(nestedObject(accountBody, 'authConfig'), 'id');
    const status = stringField(accountBody, 'status')?.toUpperCase();

    // Only block when Composio explicitly tells us the account belongs to a
    // different user / auth config. If those fields are missing (newer API
    // shape), trust the unguessable `state` token already validated above.
    // CSRF safety relies on `state` being a one-shot, TTL-bound nonce — see
    // `OAuthStateStore.consume` in
    // `src-api/src/shared/connectors/providers/composio/oauth-state.ts`,
    // which deletes the entry on first use (one-shot) and rejects replays
    // past the 10-minute TTL. If that contract changes, this branch must
    // re-tighten its checks.
    if (
      (userId && userId !== pending.userId) ||
      (authConfigId && authConfigId !== pending.authConfigId)
    ) {
      logger.warn('connector.oauth.callback.mismatch', {
        connectorId,
        connectedAccountId,
        expected: {
          userId: pending.userId,
          authConfigId: pending.authConfigId,
        },
        actual: { userId, authConfigId },
      });
      throw new ConnectorServiceError(
        'VALIDATION_FAILED',
        'Connected account does not match the pending OAuth request.',
        { status: 400 },
      );
    }
    // Composio sometimes fires the success callback while the upstream
    // provider OAuth is still finalizing — the account stays INITIATED,
    // tokens come back as "REDACTED", and after ~10 minutes Composio
    // marks the account "Connection initiation did not complete within
    // 10 minutes". Reject anything that isn't fully ACTIVE so we never
    // save a half-finished account.
    if (status !== 'ACTIVE') {
      throw new ConnectorServiceError(
        'VALIDATION_FAILED',
        `Connected account is not active (status=${status ?? 'unknown'}). Re-run the OAuth flow.`,
        { status: 400 },
      );
    }

    const accountLabel =
      stringField(accountBody, 'account_label') ??
      stringField(accountBody, 'alias') ??
      stringField(accountBody, 'email') ??
      connectedAccountId;
    this.config.setConnectedAccount(pending.scopeKey, connectorId, {
      id: connectedAccountId,
      label: accountLabel,
      userId: pending.userId,
      authConfigId: pending.authConfigId,
      connectedAt: new Date().toISOString(),
    });

    return {
      connectorId,
      scopeKey: pending.scopeKey,
      connectedAccountId,
      accountLabel,
    };
  }

  cancelPending(connectorId: string): void {
    this.oauthStates.cancelConnector(connectorId);
  }

  async disconnect(connectorId: string): Promise<void> {
    const accountIds = connectedAccountIdsForConnector(
      this.config.getConnectedAccountIds(),
      connectorId,
    );
    for (const accountId of accountIds) {
      await this.deleteConnectedAccount(accountId);
      // Cached bearer token is keyed by connected_account_id and is now
      // dead — clear it so the next first-party request doesn't burn a
      // round-trip on a 401 before re-fetching.
      clearCachedAccessToken(accountId);
    }
    this.config.removeConnectedAccount(connectorId);
    // Hydration may also be stale for this connector — force a fresh
    // pull on the next getDetail() so the UI doesn't show pre-disconnect
    // tools while the user re-authorizes.
    this.hydratedAt.delete(connectorId);
  }

  async executeTool(args: {
    connectorId: string;
    toolName: string;
    connectedAccountId: string;
    userId: string;
    input: unknown;
    signal?: AbortSignal;
  }): Promise<{ output: unknown; truncated: boolean; logId?: string }> {
    const input = validateConnectorToolInput(args.input);
    let response: Record<string, unknown>;
    try {
      response = await this.client.postJson<Record<string, unknown>>(
        `/api/v3.1/tools/execute/${encodeURIComponent(args.toolName)}`,
        {
          user_id: args.userId,
          connected_account_id: args.connectedAccountId,
          arguments: input,
        },
        args.signal,
      );
    } catch (error) {
      if (isConnectorAuthStaleError(error)) {
        this.markAuthenticationExpired(
          args.connectorId,
          args.connectedAccountId,
        );
        throw reconnectRequiredError(args.connectorId, error);
      }
      throw error;
    }

    if (response.successful === false) {
      if (boundedJsonValueIncludesAuthStaleSignal(response)) {
        this.markAuthenticationExpired(
          args.connectorId,
          args.connectedAccountId,
        );
        throw reconnectRequiredError(args.connectorId);
      }
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        'Composio tool execution failed.',
        { details: { connectorId: args.connectorId, toolName: args.toolName } },
      );
    }

    const normalized = normalizeConnectorToolOutput(
      Object.hasOwn(response, 'data') ? response.data : response,
    );
    return {
      output: normalized.output,
      truncated: normalized.truncated,
      logId: stringField(response, 'log_id'),
    };
  }

  private markAuthenticationExpired(
    connectorId: string,
    connectedAccountId: string,
  ): void {
    const connected = this.config.getConnectedAccountIds();
    let removed = 0;
    for (const [scopeKey, scoped] of Object.entries(connected)) {
      if (scoped[connectorId]?.id !== connectedAccountId) continue;
      this.config.removeConnectedAccount(connectorId, scopeKey);
      removed += 1;
    }
    clearCachedAccessToken(connectedAccountId);
    this.hydratedAt.delete(connectorId);
    logger.warn('connector.auth.expired', {
      connectorId,
      connectedAccountId,
      removed,
    });
  }

  private async deleteConnectedAccount(accountId: string): Promise<void> {
    try {
      await this.client.deleteJson<Record<string, unknown>>(
        `/api/v3.1/connected_accounts/${encodeURIComponent(accountId)}`,
      );
    } catch (error) {
      if (
        error instanceof ConnectorServiceError &&
        error.code === 'CONNECTOR_NOT_FOUND'
      ) {
        logger.info('connector.disconnect.remote_missing', { accountId });
        return;
      }
      throw error;
    }
  }

  private async getOrCreateAuthConfigId(connectorId: string): Promise<string> {
    const persisted = this.config.getAuthConfigIds()[connectorId];
    if (persisted) return persisted;

    const existing = this.authConfigCreationPromises.get(connectorId);
    if (existing) return existing;

    const promise = this.discoverOrCreateAuthConfigId(connectorId).finally(
      () => {
        this.authConfigCreationPromises.delete(connectorId);
      },
    );
    this.authConfigCreationPromises.set(connectorId, promise);
    return promise;
  }

  private async discoverOrCreateAuthConfigId(
    connectorId: string,
  ): Promise<string> {
    const toolkitSlug = this.requireToolkitSlug(connectorId);
    const discovered = await this.client.getJson<Record<string, unknown>>(
      `/api/v3.1/auth_configs?toolkit_slug=${encodeURIComponent(toolkitSlug)}`,
    );
    const enabled = readArray(discovered).find((candidate) =>
      isEnabledAuthConfig(candidate),
    );
    const discoveredId = enabled ? stringField(enabled, 'id') : undefined;
    if (discoveredId) {
      this.config.setAuthConfigId(connectorId, discoveredId);
      return discoveredId;
    }

    const created = await this.client.postJson<Record<string, unknown>>(
      '/api/v3.1/auth_configs',
      {
        toolkit: { slug: toolkitSlug },
        auth_config: { type: 'use_composio_managed_auth' },
      },
    );
    const createdBody = unwrapData(created);
    const createdId = stringField(createdBody, 'id');
    if (!createdId) {
      throw new ConnectorServiceError(
        'CONNECTOR_EXECUTION_FAILED',
        'Composio did not return an auth config id.',
      );
    }
    this.config.setAuthConfigId(connectorId, createdId);
    return createdId;
  }

  private async hydrateDefinition(
    definition: ConnectorCatalogDefinition,
    signal?: AbortSignal,
  ): Promise<ConnectorCatalogDefinition> {
    const toolkitSlug =
      definition.providerConnectorId ??
      this.getToolkitSlugForConnector(definition.id);
    if (!toolkitSlug) return definition;

    // Composio's `/api/v3.1/tools` is paginated (~20 items per page). Walk
    // every page so the agent gets the full tool surface, not just the first
    // slice. Cap at MAX_TOOL_PAGES to avoid runaway loops if cursor handling
    // misbehaves; box has ~280 tools so 30 pages × 100 limit is plenty.
    const MAX_TOOL_PAGES = 30;
    const PAGE_LIMIT = 100;
    const discoveredTools: ConnectorCatalogToolDefinition[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const params = new URLSearchParams({
        toolkit_slug: toolkitSlug,
        limit: String(PAGE_LIMIT),
      });
      if (cursor) params.set('cursor', cursor);
      const response = await this.client.getJson<Record<string, unknown>>(
        `/api/v3.1/tools?${params.toString()}`,
        signal,
      );
      const pageTools = readArray(response)
        .map((raw) => toolDefinitionFromComposio(definition.id, raw))
        .filter(
          (tool): tool is ConnectorCatalogToolDefinition => tool !== null,
        );
      discoveredTools.push(...pageTools);

      const nextCursor =
        stringField(response, 'next_cursor') ??
        stringField(response, 'nextCursor') ??
        stringField(response, 'next_page_token');
      if (!nextCursor || pageTools.length === 0) break;
      cursor = nextCursor;
    }
    if (discoveredTools.length === 0) return definition;

    const toolsByName = new Map<string, ConnectorCatalogToolDefinition>();
    for (const tool of definition.tools) toolsByName.set(tool.name, tool);
    for (const tool of discoveredTools) toolsByName.set(tool.name, tool);

    // Allow every discovered tool by default so the agent can discover and
    // invoke them; the binder still enforces per-tool safety (auto / confirm
    // / disabled) at execution time, so writes still gate on user approval
    // and destructive ops stay blocked unless the user explicitly enables
    // them in Settings → Connectors. Operators can tighten this with the
    // per-tool override UI.
    const allowedToolNames = [...definition.allowedToolNames];
    for (const tool of discoveredTools) {
      if (
        tool.safety.approval !== 'disabled' &&
        !allowedToolNames.includes(tool.name)
      ) {
        allowedToolNames.push(tool.name);
      }
    }

    // Apply the per-connector curated overlay (box, dropbox, googledrive,
    // …) — only intersect curated names that actually exist in the
    // discovered tool catalog, so a stale curated entry never breaks
    // discovery for a renamed Composio tool.
    const discoveredNames = new Set(discoveredTools.map((t) => t.name));
    const curatedSeed = definition.curatedToolNames ?? [];
    const curatedOverlay = curatedToolsFor(definition.id).filter((name) =>
      discoveredNames.has(name),
    );
    const curatedToolNames =
      curatedOverlay.length > 0
        ? Array.from(new Set([...curatedSeed, ...curatedOverlay]))
        : curatedSeed.length > 0
          ? curatedSeed
          : allowedToolNames;
    const featuredOverlay = featuredToolsFor(definition.id).filter((name) =>
      discoveredNames.has(name),
    );
    const featuredToolNames =
      definition.featuredToolNames && definition.featuredToolNames.length > 0
        ? [...definition.featuredToolNames]
        : featuredOverlay.length > 0
          ? [...featuredOverlay]
          : undefined;

    return {
      ...definition,
      tools: [...toolsByName.values()],
      allowedToolNames,
      curatedToolNames,
      ...(featuredToolNames ? { featuredToolNames } : {}),
      toolCount: discoveredTools.length,
    };
  }

  private async discoverCatalogDefinitions(
    signal?: AbortSignal,
  ): Promise<ConnectorCatalogDefinition[]> {
    const seedDefinitions = getConnectorCatalogDefinitions();
    const toolkits = await this.listToolkitsSafe(signal);

    if (toolkits.length === 0) {
      const hydrated = await Promise.all(
        seedDefinitions.map((definition) =>
          definition.provider === 'composio'
            ? this.hydrateDefinition(definition, signal)
            : definition,
        ),
      );
      return sortCatalogDefinitions(hydrated);
    }

    const definitionsById = new Map(
      seedDefinitions.map((definition) => [definition.id, definition]),
    );
    const composioSeedByToolkit = new Map(
      seedDefinitions
        .filter((definition) => definition.provider === 'composio')
        .map((definition) => [
          canonicalToolkitSlug(
            definition.providerConnectorId ??
              getStaticToolkitSlugForConnector(definition.id) ??
              definition.id,
          ),
          definition,
        ]),
    );

    for (const toolkit of toolkits) {
      const definition = this.definitionFromToolkitMetadata(
        toolkit,
        composioSeedByToolkit,
      );
      if (!definition) continue;
      definitionsById.set(definition.id, definition);
    }

    return sortCatalogDefinitions([...definitionsById.values()]);
  }

  private async listToolkitsSafe(
    signal?: AbortSignal,
  ): Promise<ComposioToolkitResponse[]> {
    try {
      const response = await this.client.getJson<Record<string, unknown>>(
        '/api/v3.1/toolkits?limit=1000&sort_by=usage',
        signal,
      );
      return readArray(response) as ComposioToolkitResponse[];
    } catch (error) {
      // Bad key / missing project is expected when the user hasn't finished
      // Composio setup — surface that as a quiet info so the rest of the
      // catalog refresh can fall back to the bundled static definitions.
      // Anything else is genuinely surprising and stays at warn.
      if (isPermanentComposioError(error)) {
        logger.info('connector.catalog.toolkits_unavailable', {
          reason: composioErrorCode(error) ?? 'unknown',
        });
      } else {
        logger.warn('connector.catalog.toolkits_failed', { error });
      }
      return [];
    }
  }

  private definitionFromToolkitMetadata(
    toolkit: ComposioToolkitResponse,
    composioSeedByToolkit: Map<string, ConnectorCatalogDefinition>,
  ): ConnectorCatalogDefinition | null {
    const rawSlug = stringField(toolkit as Record<string, unknown>, 'slug');
    if (!rawSlug) return null;

    const toolkitSlug = normalizeToolkitSlug(rawSlug);
    const connectorId = connectorIdForToolkitSlug(toolkitSlug);
    if (!connectorId) return null;

    const seed = composioSeedByToolkit.get(canonicalToolkitSlug(toolkitSlug));
    const name =
      stringField(toolkit as Record<string, unknown>, 'name') ??
      seed?.name ??
      titleFromConnectorId(connectorId);
    const category =
      firstCategoryName(toolkit.meta?.categories) ??
      firstCategoryName(toolkit.categories) ??
      COMPOSIO_TOOLKITS.find(
        (entry) =>
          canonicalToolkitSlug(entry.toolkitSlug) ===
          canonicalToolkitSlug(toolkitSlug),
      )?.category ??
      seed?.category ??
      'Integration';
    const description =
      stringField(toolkit as Record<string, unknown>, 'description') ??
      (toolkit.meta && typeof toolkit.meta.description === 'string'
        ? toolkit.meta.description
        : undefined) ??
      seed?.description ??
      `Connect ${name} through Composio managed OAuth.`;
    const toolCount =
      nonNegativeInteger(toolkit.meta?.tools_count) ??
      nonNegativeInteger(toolkit.meta?.toolsCount) ??
      seed?.toolCount;

    return {
      ...(seed ?? {}),
      id: seed?.id ?? connectorId,
      name,
      provider: 'composio',
      providerConnectorId: toolkitSlug,
      category,
      description,
      authentication: 'composio',
      tools: seed?.tools ?? [],
      allowedToolNames: seed?.allowedToolNames ?? [],
      curatedToolNames: seed?.curatedToolNames ?? seed?.allowedToolNames ?? [],
      ...(seed?.apiKeyUrl === undefined ? {} : { apiKeyUrl: seed.apiKeyUrl }),
      ...(toolCount === undefined ? {} : { toolCount }),
      ...(seed?.featuredToolNames === undefined
        ? {}
        : { featuredToolNames: [...seed.featuredToolNames] }),
      minimumApproval: seed?.minimumApproval ?? 'auto',
    };
  }

  private getToolkitSlugForConnector(connectorId: string): string | null {
    const definition =
      this.fastDefinitions.find((entry) => entry.id === connectorId) ??
      getConnectorDefinition(connectorId);
    return (
      definition?.providerConnectorId ??
      getStaticToolkitSlugForConnector(connectorId) ??
      null
    );
  }

  private requireToolkitSlug(connectorId: string): string {
    const definition =
      this.fastDefinitions.find((entry) => entry.id === connectorId) ??
      getConnectorDefinition(connectorId);
    const toolkitSlug =
      definition?.providerConnectorId ??
      getStaticToolkitSlugForConnector(connectorId);
    if (!definition || definition.provider !== 'composio' || !toolkitSlug) {
      throw new ConnectorServiceError(
        'CONNECTOR_NOT_FOUND',
        `Connector ${connectorId} is not a Composio-managed connector.`,
        { details: { connectorId } },
      );
    }
    return toolkitSlug;
  }

  private upsertFastDefinition(definition: ConnectorCatalogDefinition): void {
    const index = this.fastDefinitions.findIndex(
      (entry) => entry.id === definition.id,
    );
    if (index === -1) {
      this.fastDefinitions = sortCatalogDefinitions([
        ...this.fastDefinitions,
        definition,
      ]);
      return;
    }
    this.fastDefinitions = this.fastDefinitions.map((entry, entryIndex) =>
      entryIndex === index ? definition : entry,
    );
  }
}

function toolDefinitionFromComposio(
  connectorId: string,
  raw: Record<string, unknown>,
): ConnectorCatalogToolDefinition | null {
  const providerToolId =
    stringField(raw, 'slug') ??
    stringField(raw, 'name') ??
    stringField(raw, 'id');
  if (!providerToolId) return null;
  const name = providerToolId.includes('.')
    ? providerToolId
    : `${connectorId}.${providerToolId}`;

  const inputSchema = normalizeToolSchema(
    raw.input_parameters ?? raw.input_schema ?? raw.parameters,
  );

  return defineConnectorTool({
    name,
    title:
      stringField(raw, 'display_name') ??
      stringField(raw, 'displayName') ??
      stringField(raw, 'title') ??
      stringField(raw, 'label') ??
      humanizeToolSlug(providerToolId, connectorId),
    description: stringField(raw, 'description'),
    inputSchemaJson: inputSchema,
    requiredScopes: stringArrayField(raw, 'required_scopes', 'scopes'),
    providerToolId,
    version: stringField(raw, 'version'),
    curation: COMPOSIO_CURATION_OVERLAY[name],
  });
}

function normalizeToolSchema(value: unknown) {
  if (!value) return undefined;
  try {
    return normalizeConnectorJsonObject(value, { redactForbiddenKeys: true });
  } catch {
    return undefined;
  }
}

function nestedObject(
  body: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const value = body?.[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function unwrapData(body: Record<string, unknown>): Record<string, unknown> {
  const data = body.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : body;
}

function readArray(body: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [body.items, body.data, body.tools, body.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      );
    }
  }
  return [];
}

function connectorIdForToolkitSlug(slug: string): string {
  const known = COMPOSIO_TOOLKITS.find(
    (toolkit) =>
      canonicalToolkitSlug(toolkit.toolkitSlug) === canonicalToolkitSlug(slug),
  );
  if (known) return known.connectorId;
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeToolkitSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function canonicalToolkitSlug(slug: string): string {
  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function humanizeToolSlug(slug: string, connectorId: string): string {
  const prefix = connectorId.toLowerCase().replace(/[^a-z0-9]/g, '');
  const stripped = slug
    .toLowerCase()
    .replace(/^[a-z0-9]+\./, '')
    .replace(new RegExp(`^${prefix}[_-]?`, 'i'), '');
  const words = stripped.split(/[_\s-]+/).filter(Boolean);
  if (words.length === 0) return slug;
  return words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word.toLowerCase(),
    )
    .join(' ');
}

function titleFromConnectorId(connectorId: string): string {
  return connectorId
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function firstCategoryName(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const name = (item as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  return undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

function sortCatalogDefinitions(
  definitions: ConnectorCatalogDefinition[],
): ConnectorCatalogDefinition[] {
  const seedOrder = new Map(
    getConnectorCatalogDefinitions().map((definition, index) => [
      definition.id,
      index,
    ]),
  );
  return [...definitions].sort((a, b) => {
    const aOrder = seedOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = seedOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name);
  });
}

function isEnabledAuthConfig(value: Record<string, unknown>): boolean {
  const status = stringField(value, 'status')?.toUpperCase();
  const enabled = value.enabled;
  return status === 'ENABLED' || status === 'ACTIVE' || enabled === true;
}

function reconnectRequiredError(
  connectorId: string,
  cause?: unknown,
): ConnectorServiceError {
  return new ConnectorServiceError(
    'CONNECTOR_AUTH_EXPIRED',
    `Reconnect ${titleFromConnectorId(connectorId)} before running this connector tool again.`,
    {
      status: 412,
      details: { connectorId, action: 'reconnect' },
      cause,
    },
  );
}

function stringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === 'string' && field.length > 0 ? field : undefined;
}

function stringArrayField(
  value: Record<string, unknown>,
  ...keys: string[]
): string[] {
  for (const key of keys) {
    const field = value[key];
    if (Array.isArray(field)) {
      return field.filter(
        (entry): entry is string => typeof entry === 'string',
      );
    }
  }
  return [];
}

function cloneDefinitions(
  definitions: ConnectorCatalogDefinition[],
): ConnectorCatalogDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    allowedToolNames: [...definition.allowedToolNames],
    curatedToolNames: definition.curatedToolNames
      ? [...definition.curatedToolNames]
      : undefined,
    tools: definition.tools.map((tool) => ({
      ...tool,
      requiredScopes: [...tool.requiredScopes],
      safety: { ...tool.safety },
    })),
  }));
}

function connectedAccountIdsForConnector(
  scopedAccounts: ReturnType<ComposioConfigStore['getConnectedAccountIds']>,
  connectorId: string,
): string[] {
  const accountIds = new Set<string>();
  for (const scoped of Object.values(scopedAccounts)) {
    const account = scoped[connectorId];
    if (account?.id) accountIds.add(account.id);
  }
  return [...accountIds];
}

function labelForScope(scopeKey: string): string {
  if (scopeKey.startsWith('desktop:')) return 'Desktop';
  if (scopeKey.startsWith('channel:')) {
    const [, platform] = scopeKey.split(':');
    return platform
      ? `${platform[0]?.toUpperCase()}${platform.slice(1)}`
      : 'Channel';
  }
  return scopeKey;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}
