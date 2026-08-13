---
summary: "Connectors platform v2 — catalog contract, Composio provider, native cloud connections, per-tier access policy, MCP bridge, and publish destinations"
read_when:
  - Working on the Connectors settings tab or `/connectors` API
  - Adding or wiring a new Composio toolkit / native provider
  - Debugging connector credentials, OAuth state, or per-channel scopes
  - Touching the connectors MCP bridge or native cloud publish destination
title: "Connectors"
---

# Connectors Platform v2

The connectors platform unifies external integrations -- Composio-managed SaaS
catalog, direct OAuth providers (Google Workspace, Box, Dropbox, OneDrive),
and per-tier access policy -- behind a single contract surfaced in
**Settings > Connectors**.

## Source Map

| Area                          | Files                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP routes                   | `src-api/src/app/api/connectors.ts`                                                                                                                                            |
| Catalog contract              | `src-api/src/shared/connectors/catalog.ts`, `seed.ts`                                                                                                                          |
| Bounded JSON I/O              | `src-api/src/shared/connectors/bounded-json.ts`                                                                                                                                |
| Composio provider             | `src-api/src/shared/connectors/providers/composio/{provider,client,config,credentials,credentials-cache,access-token,catalog-cache,toolkits,curated-tools,curation,errors,oauth-state}.ts` |
| Binder (per-runtime tool emit)| `src-api/src/shared/connectors/binder/{anthropic,openai,deepagents,design-mode,approval,index}.ts`                                                                              |
| Feature flag                  | `src-api/src/shared/connectors/feature-flag.ts`                                                                                                                                |
| MCP bridge subprocess         | `src-api/src/shared/mcp/subprocess-bridge/connectors-bridge.ts`, `index.ts`                                                                                                    |
| Per-provider MCP servers      | `src-api/src/shared/mcp/{connectors-server,box-server,dropbox-server,onedrive-server}.ts`                                                                                       |
| Native cloud connections      | `src-api/src/shared/integrations/cloud-storage/providers/{box,dropbox,onedrive}-local-adapter.ts`                                                                              |
| Access policy                 | `src-api/src/shared/auth/connector-policy.ts`, `connection-broker.ts`                                                                                                          |
| Native cloud publish dest     | `src-api/src/shared/services/publish/destinations/native-cloud-destination.ts`                                                                                                 |
| Frontend tab                  | `src/components/settings/tabs/connectors/*`, `src/components/settings/ConnectorAccessControls.tsx`                                                                              |

## Three Sections (UI)

`ConnectorsTab.tsx` renders three grouped sections:

1. **Your accounts** -- `GoogleWorkspaceSection`, `CloudStorageConnectionsSection`. Direct OAuth, local credential store.
2. **Catalog** -- `ComposioSection` (collapsible) wrapping `ComposioApiKeyCard` + `ConnectorCatalogGrid`. Powered by `useComposioConfig` + `useConnectorCatalog` hooks.
3. **Governance** -- `AccessPolicySection` + `ConnectorAccessControls`. Per-connector minimum permission tier for channel runs.

`GOOGLE_WORKSPACE_CONNECTOR_IDS` in `ConnectorsTab.tsx` lists Composio connector ids that are hidden from the catalog grid because they overlap with native Google Workspace integration.

## Composio Provider

`ComposioProvider` (`provider.ts`) wraps `ComposioClient` HTTP calls with:

- **`ComposioConfigStore`** -- persists the API key via settings (`SettingsComposioConfigStore`)
- **`ComposioCatalogCache`** -- caches toolkit listings; cleared on key rotation
- **`OAuthStateStore`** -- short-lived OAuth state for connection redirects
- **`ComposioCredentialsCache`** + `access-token.ts` -- per-account access tokens with TTL invalidation
- **`curated-tools.ts`** -- ranked tool list per connector (drives suggested ordering)
- **`curation.ts`** -- `COMPOSIO_CURATION_OVERLAY` static description / approval overrides

Connection flow returns `ComposioConnectionStart { kind: 'redirect_required', redirectUrl }` -- the desktop opens the URL via Tauri shell, and the provider polls / completes on `ComposioConnectionCompletion`.

## Binder

Runtime-specific binders (`binder/anthropic.ts`, `binder/openai.ts`, `binder/deepagents.ts`, `binder/design-mode.ts`) turn enabled connector tools into the tool schema the underlying agent expects. `binder/approval.ts` injects the per-tool approval gate.

## MCP Bridge

`subprocess-bridge/connectors-bridge.ts` launches a connectors-aware MCP subprocess that hosts the Composio tool catalog as MCP tools. Per-provider MCP servers (`box-server.ts`, `dropbox-server.ts`, `onedrive-server.ts`, `connectors-server.ts`) expose native cloud connections for agents that prefer MCP over direct binder calls.

## Native Cloud Publish Destinations

`destinations/native-cloud-destination.ts` constructs `Box | Dropbox | OneDrive` adapters from local credentials and registers them in `publish/registry.ts`. `destination-options.ts` maps each destination kind to its native cloud connection id so publish jobs route through the local adapter rather than a site proxy.

## Feature Flag

`feature-flag.ts` gates the v2 surfaces. Default-on as of the connectors v2 rollout; legacy connector UI is still importable for fallback.

## Access Policy

`connector-policy.ts` stores `{ connectorId -> minimumTier }`. `connection-broker.ts` resolves the effective tier of the requester (desktop user always overrides) before binding tools. Tiers: `viewer < operator < admin < disabled`.

## Tests

- `src-api/test/integration/api/connectors-v2.test.ts` -- end-to-end route surface
- `src-api/test/unit/connectors/credential-invalidation.test.ts` -- cache eviction on key/account change
