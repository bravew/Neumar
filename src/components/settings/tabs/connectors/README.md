# Connectors Settings Tab

This folder contains the platform V2 Connectors tab. `SettingsContent.tsx` renders it from the frontend build flag `VITE_NEUMA_CONNECTORS_PLATFORM_V2`, which defaults to enabled. The daemon uses the matching `NEUMA_CONNECTORS_PLATFORM_V2` environment flag, also defaulting to enabled and inlined into packaged sidecars when set during `src-api/scripts/build.mjs`. Do not store this rollout switch in client settings; persisted settings only keep user preferences such as duplicate Composio adapter visibility.

## File split

- `ConnectorsTab.tsx`: tab shell and data hook composition.
- `ComposioApiKeyCard.tsx`: API key tail display, save, and catalog refresh.
- `ConnectorCatalogGrid.tsx`: search, filter, sort, and connector card grid.
- `ConnectorCard.tsx`: compact connector card.
- `ConnectorDetailDrawer.tsx`: detail panel and composition for auth, scopes, permissions, and tools.
- `ConnectorAuthLauncher.tsx`: OAuth launch/cancel.
- `ConnectorChannelScopes.tsx`: per-surface connection status.
- `ConnectorPermissionsSection.tsx`: access policy summary.
- `ConnectorToolList.tsx`: per-tool override controls.
- `NativeOverrideBanner.tsx`: native connector notice.
- `hooks/`: network state for config, catalog, and detail calls.
- `parts.tsx`: small presentational primitives shared by the tab.
- `types.ts`: local aliases for the API connector contract.

The split keeps each component below the component-size budget and keeps network concerns out of presentational pieces. Keep future controls in focused files rather than growing `ConnectorsTab.tsx`.

## Safety expectations

- Never render or store the raw Composio API key. Only the API key tail is shown.
- Only show tool overrides returned by the daemon catalog.
- Treat channel scopes independently; do not collapse by platform alone.
- Keep write/confirm behavior copy aligned with backend policy: channel callers cannot auto-approve connector writes in v1.
- Preserve the legacy tab path until the build flag and daemon flag can be removed.
