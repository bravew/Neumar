---
summary: "Plugin and extension system — agent plugins, sandbox plugins, and complete list of all extension points"
read_when:
  - Adding a new agent or sandbox provider
  - Understanding all available extension points
  - Working on the plugin/registry architecture
title: "Plugins & Extensions"
---

# Plugin & Extension System

## Agent Plugins

Adding a new agent provider requires:

1. **Create extension** in `src-api/src/extensions/agent/<name>/index.ts`
2. **Extend `BaseAgent`** and implement required methods:
   - `plan(options)` → `AsyncGenerator<AgentMessage>`
   - `execute(options)` → `AsyncGenerator<AgentMessage>`
3. **Register plugin** with metadata and optional hooks:

```typescript
// Example: registering a new agent plugin
agentRegistry.register({
  metadata: {
    type: 'my-agent',
    name: 'My Agent',
    description: 'Custom agent implementation',
    supportsPlan: true,
    supportsStreaming: true,
    supportsSandbox: false,
    transport: 'http',           // sdk | cli | http | process | a2a
    supportsMcp: 'shim',        // native | shim | none
    supportsSkills: 'none',     // native | shim | none
    supportsPlanMode: 'none',   // native | orchestrated | none
    requiresBinary: false,
    requiresApiKey: true,
  },
  factory: (config) => new MyAgent(config),
  testEnvironment: async (config) => ({ healthy: true, ... }),  // optional preflight
  listModels: async (config) => ['model-a', 'model-b'],        // optional discovery
  normalizeConfig: (config) => ({ ...config }),                 // optional validation
});
```

**Built-in agent plugins** include `claude`, `codex`, `open-agent-sdk`, `a2a`,
`gemini-local`, `http-agent`, `openai-compat`, `open-code-local`,
`cursor-local`, `pi-local`, `process-agent`, and the scoped `video` provider
(`mock` is registered only outside production).

## Sandbox Plugins

Adding a new sandbox provider follows the same pattern:

1. **Create extension** in `src-api/src/extensions/sandbox/<name>.ts`
2. **Extend `BaseSandboxProvider`** and implement:
   - `exec(options)` → `SandboxExecResult`
   - `isAvailable()` → `boolean`
3. **Register** with capability declaration (isolation level, networking, pooling)

## Extension Points

| Extension Point                           | Registry                    | Location                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent providers                           | `AgentRegistry`             | `core/agent/registry.ts`                                                                                                                                                                                                                                                                                                                                                                    |
| Sandbox providers                         | `SandboxRegistry`           | `core/sandbox/registry.ts`                                                                                                                                                                                                                                                                                                                                                                  |
| MCP servers (user)                        | Config-based                | `~/.<slug>/mcp.json`                                                                                                                                                                                                                                                                                                                                                                        |
| MCP servers (built-in)                    | Code-based                  | `extensions/mcp/sandbox-server.ts`, `shared/mcp/linear-server.ts`, `shared/mcp/media-server.ts`, `shared/mcp/memory-server.ts`                                                                                                                                                                                                                                                              |
| MCP Shim                                  | Code-based                  | `core/agent/mcp-shim.ts` — bridges MCP tools to non-Claude providers                                                                                                                                                                                                                                                                                                                        |
| Media generation adapters                 | Pattern-based               | `shared/services/media-generation/registry.ts`                                                                                                                                                                                                                                                                                                                                              |
| Plugins (skills + commands + hooks + MCP) | File-based with DB tracking | `~/.<slug>/plugins/`, `~/.<slug>/marketplace/`, project `<workDir>/.plugins`, repo/bundled plugin roots, plus legacy `~/.claude/skills/` flat dirs synthesized as `legacy` plugins. Loader: `shared/plugins/loader.ts`. DB: `installed_plugins`, `plugin_config_values`, and `marketplace_sources`. API: `app/api/plugins.ts`. Manifest schema: `shared/plugins/manifest.ts` (wire-compatible with Anthropic `.claude-plugin/plugin.json`). |
| Video plugins                             | File-based with DB tracking | General plugin directories with `metadata.neuma.surfaces: ['video']` and `metadata.neuma.videoManifest`. Loader: `shared/video/plugins/loader.ts`. Runtime gates: `shared/video/plugins/runtime.ts`. API: `app/api/video-plugins.ts`. Candidate persistence: `video_plugin_candidates`. |
| Model providers                           | `ProviderManager`           | Custom API endpoints                                                                                                                                                                                                                                                                                                                                                                        |
| Connectors                                | Config-based                | `~/.<slug>/linear.enc.json` (Linear/GitHub/Slack)                                                                                                                                                                                                                                                                                                                                           |
| Agent profiles                            | Database                    | `shared/db/operations.ts` — pre-configured agent personas                                                                                                                                                                                                                                                                                                                                   |
| User templates                            | Database                    | `shared/db/operations.ts` — assistant presets                                                                                                                                                                                                                                                                                                                                               |
| Delegation                                | Service                     | `shared/services/delegation.ts` — agent-to-agent task routing                                                                                                                                                                                                                                                                                                                               |
| Session budget                            | Service                     | `shared/services/session-budget.ts` — cost caps and loop detection                                                                                                                                                                                                                                                                                                                          |
| AG-UI protocol                            | Service                     | `shared/services/ag-ui/` — standards-based agent streaming with CopilotKit V2 runtime                                                                                                                                                                                                                                                                                                       |
| Channel workspace                         | Service                     | `shared/channels/workspace.ts` — per-channel, per-user workspace isolation                                                                                                                                                                                                                                                                                                                  |

## Plugin Marketplace

The plugin system distributes skills (and optionally commands, hooks, MCP servers) as Anthropic-spec plugins. A plugin is any directory containing `.claude-plugin/plugin.json` (codex/cursor variants are auto-detected).

### Loader cascade

`loadPlugins()` walks repo-shipped built-ins, project, user, marketplace, bundled-skill, and legacy tiers in parallel and merges by `manifest.name`. Later tiers override earlier ones; collisions are logged.

| Tier          | Root                                                           | Use case                                                       |
| ------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `bundled`     | repo/builtin root, sidecar `resources/plugins/` / bundled skills | Ships with the app; reconciled into `installed_plugins` so users can disable it |
| `project`     | `<workDir>/.plugins/` or caller-provided `projectDir`          | Per-workspace plugins                                          |
| `user`        | `~/.<slug>/plugins/`                                           | Machine-wide installed plugins                                 |
| `marketplace` | `~/.<slug>/marketplace/`                                       | Marketplace cache/staging root                                 |
| `legacy`      | `~/.claude/skills/<name>/SKILL.md`                             | Compat shim — synthesizes a `legacy` plugin per bare directory |

Skills surface namespaced as `pluginName:skillName`; the v1 bare name is preserved on the `bareName` field for legacy callers.

### REST surface (`/plugins`)

| Method · Path                                  | Purpose                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /plugins`                                 | DB-tracked installed plugins; `?scope=…&enabledOnly=1` (Zod-validated query)                                                                                                                                                                                                                             |
| `GET /plugins/discovered`                      | Full disk scan — every plugin the loader sees                                                                                                                                                                                                                                                            |
| `GET /plugins/:id`                             | One installed plugin                                                                                                                                                                                                                                                                                     |
| `GET /plugins/:id/config`                      | Public config values derived from `metadata.neuma.configSchema`; secret fields return hints, never secret values                                                                                                                                                                                         |
| `PUT /plugins/:id/config`                      | Validate and persist config patch values; `secret` fields are stored via the secret store and referenced from `plugin_config_values.secret_name`                                                                                                                                                          |
| `GET /plugins/:id/preview`                     | Serves a design-system plugin's bundled `components.html` for the Library detail modal's sandboxed iframe preview; non-design plugins return 404                                                                                                                                                          |
| `POST /plugins/:id/apply`                      | Apply a plugin to `task`, `design`, or `video` surfaces. Task/design return pinned skills plus redacted config; video returns prompt, gate details, applied snapshot, and redacted config                                                                                                                 |
| `POST /plugins/install`                        | Installs from `local`, `github`, `url`, or `marketplace`. Local refs are allowlisted to `home`/`workDir`/`getAppDir()` via `fs.realpath`; remote and marketplace installs fetch into a temp dir, validate manifest, enforce 50MB/file, 5000-file, and 200MB total caps, and roll back partial installs |
| `POST /plugins/:id/{enable,disable}`           | Toggle the `enabled` flag. Disabled built-ins stay in the DB and are skipped by loaders.                                                                                                                                                                                                                  |
| `DELETE /plugins/:id`                          | Remove install dir, DB row, and config secrets; refuses `bundled` because built-ins are disable-only                                                                                                                                                                                                      |
| `POST /plugins/scaffold`                       | Create a new plugin from a built-in template                                                                                                                                                                                                                                                             |
| `GET /plugins/marketplace/index`               | Legacy registry view over all configured sources; SSRF-validated; 15-min in-memory + on-disk cache at `~/.<slug>/marketplace/<digest>.json`; partial failures surface as 207 Multi-Status                                                                                                                |
| `GET /plugins/marketplaces`                    | List persisted marketplace catalog sources from `marketplace_sources`                                                                                                                                                                                                                                    |
| `POST /plugins/marketplaces`                   | Add a source URL with user-assigned `official` or `restricted` trust. URL must be HTTPS except localhost, pass SSRF checks, and serve valid `marketplace.json`.                                                                                                                                           |
| `POST /plugins/marketplaces/:sourceId/refresh` | Invalidate the source cache, refetch the catalog, and update catalog version / plugin count                                                                                                                                                                                                               |
| `GET /plugins/marketplaces/available`          | Merge all source catalogs into one Available list; each entry is tagged with source id, source name, and user-assigned trust                                                                                                                                                                             |
| `GET /plugins/marketplaces/:sourceId/inspect?entry=…` | Best-effort pre-install inspection for GitHub-backed entries: skills, evals, README, and Open Design workflow metadata                                                                                                                                                                      |
| `DELETE /plugins/marketplaces/:sourceId`       | Remove a marketplace source row                                                                                                                                                                                                                                                                          |

### Marketplace Security

Marketplace registry URLs are untrusted input. The registry fetch path validates
and fetches them through `safeFetch()` instead of platform `fetch()`:

- every redirect hop is validated before connect
- DNS answers are classified and the connection is pinned to the validated IP
- private, loopback, link-local, reserved, and cloud metadata destinations are
  blocked by default
- registry JSON is validated with strict Zod schemas before it is cached
- cache writes are atomic (`.tmp` then rename) so interrupted writes do not
  poison the local marketplace cache
- marketplace source trust is assigned by the user on the source row; trust
  claimed inside the catalog is ignored
- marketplace installs stamp source id, entry name/version, and source trust on
  the `installed_plugins` row for provenance and update hints

Marketplace plugin execution is also gated by sandbox capabilities. The
marketplace path must use a provider whose metadata reports hard enforcement,
non-`none` isolation, and `marketplaceEligible: true`. The normal sandbox
fallback to Native is intentionally not used for marketplace execution.

### Manifest schema (`shared/plugins/manifest.ts`)

Strict Zod (`.strict()` on top-level keys; `.passthrough()` on `metadata` for vendor namespaces). Required: `name` (lower-kebab), `version` (strict semver), `description`. Optional component roots: `skills`, `commands`, `agents`, `hooks`, `mcp`. Neuma extensions live under `metadata.neuma.{minHostVersion, requires.{anyBins,envVars}, signature, configSchema}`.

`metadata.neuma.configSchema` is an optional array of UI-readable configuration fields. Each
field has a `key`, `type` (`string`, `number`, `boolean`, `secret`, or `enum`), and optional
`label`, `help`, `sensitive`, `advanced`, `order`, `required`, `default`, `options`, and
`uiHints`. The frontend detail drawer renders this schema through
`PluginConfigSchemaPreview` so users can inspect plugin configuration requirements before
enabling or installing a plugin. Installed plugins use `PluginConfigEditor`;
non-secret values are stored in `plugin_config_values.value_json`, and `secret`
fields are stored in the app secret store with only the secret name recorded in
SQLite.

### Video plugin manifests

Video plugins use the normal `.claude-plugin/plugin.json` manifest for installation
and add `metadata.neuma.videoManifest` pointing at a domain manifest, usually
`video-plugin.json`. The domain manifest is validated by
`parseVideoPluginManifest()` and loaded only when the generic plugin declares the
`video` surface.

The video manifest defines:

- `specVersion`, `name`, `title`, `version`, and compatibility requirements
- `video.kind`, `video.mode`, supported aspect ratios, and render engine
- pipeline stages made of atoms such as `research-search`, `broll-stock`,
  `ai-image`, `ai-clip`, `music-select`, `timeline-assemble`,
  `reference-analyze`, and `reference-vision`
- capabilities such as `prompt:inject`, `research:web`, `network:stock`,
  `network:music`, `media:generate`, `media:vision`, `video:analyze`, and
  `network:youtube`
- optional inputs, prompt guide text, templates, GenUI surfaces, and network
  policy

Video plugin runs are gated by shared capability grants. Bundled and saved
plugins can run with their trusted digest; imported or changed manifests are
restricted until the current digest is reviewed. After a successful render,
Video Mode can save a non-trivial applied snapshot as a new project or user
plugin and mark it with `trust_tier = 'saved'`.

### Signing (`shared/plugins/verify.ts`)

Manifests may carry `metadata.neuma.signature = { algorithm: 'ed25519', publicKeyId, signature }`. The signature commits to the canonical-JSON of the manifest with the signature field stripped. Trusted publisher keys live in `shared/plugins/trusted-keys.json` (PEM-encoded SPKI). Verdicts on install: `signed` (DB `signature_ok = 1`), `unsigned` (DB `null`), `unknown-key` (DB `null`), `invalid` (DB `0`). Tarball signing is out of scope — first iteration commits to manifest contents only.

### Scaffolder + CLI (`shared/plugins/scaffold.ts`, `cli/scaffold-plugin.ts`)

`pnpm plugin:new <name> [--template basic|with-script|with-mcp] [--dir <path>]`. Templates live under `shared/plugins/templates/`; `__name__` path segments and `.tmpl` suffixes are rewritten at copy time; `compileTmpl` substitutes `{{TOKEN}}` placeholders (standard tokens: `NAME`, `DESCRIPTION`, `HOST_VERSION`, `TODAY`; user-supplied vars merge on top). Generated manifest is validated against `PluginManifestSchema` before any disk write; refuses to overwrite an existing dir.

### Frontend surface

| Page / hook                                  | Purpose                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/app/pages/Library.tsx`                  | Top-level Radix tabs strip — `Tasks` / `Plugins` / `Marketplace`                                                              |
| `components/settings/tabs/PluginSettings.tsx` | Settings -> Extensions -> Plugins surface that reuses installed and marketplace tabs                                           |
| `components/library/InstalledPluginsTab.tsx` | User-installed plugins plus searchable/category-filtered Built-in section; built-ins are enable/disable only and can be opened with `Use` when they target Design or Video |
| `components/library/MarketplaceTab.tsx`      | Available/Sources sub-tabs for browsing merged catalog entries and managing registry URLs                                      |
| `components/library/MarketplaceAvailableView.tsx` | Searchable Available grid with Source, Type, and Tag facets; installed entries flip from `Install` to `Use` and route to the plugin's declared surface |
| `components/library/PluginSourcesPanel.tsx`  | Add/refresh/remove marketplace sources with `official` / `restricted` trust badges                                             |
| `components/library/PluginCard.tsx`          | Shared card with signature glyph                                                                                              |
| `components/library/PluginInstallDialog.tsx` | Confirms install, surfaces `requires.{anyBins,envVars}` permissions, signature status, distinct unsigned-acknowledge checkbox |
| `components/library/AvailablePluginDetailDialog.tsx` | Pre-install catalog detail or installed-mode detail, with `Use` / `Use without prompt` split actions when an installed plugin has an example query |
| `components/library/InstalledPluginDetailDialog.tsx` | Installed/built-in modal with author/about, example query, context bundles, capability permissions, source/provenance, signature status, host requirements, config editor, and design-system preview |
| `components/library/PluginPreview.tsx`       | Lazy-loads `/plugins/:id/preview` into a null-origin sandboxed iframe for design-system plugins                               |
| `components/library/PluginUseButton.tsx`     | Split `Use` action; primary use seeds the plugin example query, dropdown can attach without seeding                           |
| `components/plugins/ActivePluginChip.tsx`    | Shows the currently attached plugin on Chat, Design, and Video surfaces and lets users dismiss it from the route query         |
| `shared/hooks/usePlugins.ts`                 | `useInstalledPlugins` / `useDiscoveredPlugins` / `usePluginActions` / `usePluginConfig` — per-call `AbortController`, unmount cleanup |
| `shared/hooks/useMarketplaceSources.ts`      | Source CRUD, available catalog merge, and pre-install inspection hooks                                                        |
| `shared/hooks/useActivePlugin.ts`            | Reads `?plugin=...&seed=1`, resolves the installed plugin, consumes seed state after the destination composer is initialized, and removes the plugin query when dismissed |

`Use` routes through `shared/plugins/use-plugin.ts`: video plugins open `/video`,
design plugins open `/design`, and all other plugins open `/`. The destination
surface reads the `plugin` query param, pins the plugin into the next run, and
uses `seed=1` only once to populate the composer or new-project form with the
plugin's `metadata.neuma.exampleQuery`.

### i18n

The `plugins` namespace ships in all 6 locales under `src/config/locale/messages/<locale>/plugins.ts`.

---

_See also: [Agent System](../backend/agent-system.md) · [Sandbox System](../backend/sandbox.md) · [MCP Integration](../backend/mcp.md)_
