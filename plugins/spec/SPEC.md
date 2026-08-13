# Neuma Plugin Spec (v1)

This document is the self-contained contract for authoring a plugin that runs
in the Neuma desktop app across its task, design, and video surfaces. Blank
starting points live in [templates/](templates/).

## One plugin, one folder

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # manifest — the only file in this directory
├── skills/
│   └── my-skill/
│       └── SKILL.md         # portable agent skill (Claude Code compatible)
├── design-plugin.json       # optional design sidecar (declared in manifest)
├── video-plugin.json        # optional video sidecar (declared in manifest)
└── task-plugin.json         # optional task sidecar (declared in manifest)
```

The manifest directory may also be `.codex-plugin/` or `.cursor-plugin/`; the
loader accepts all three. Everything else about the folder is yours — assets,
references, examples ship with the plugin and are available to the agent at
run time.

## Manifest (`plugin.json`)

Wire-compatible with Claude Code's plugin manifest. Neuma-specific behavior
lives strictly under `metadata.neuma` so the same folder loads unchanged in
Claude Code.

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "One paragraph, max 500 chars.",
  "displayName": "My Plugin",
  "license": "MIT",
  "keywords": ["example"],
  "skills": "skills",
  "metadata": {
    "neuma": {
      "surfaces": ["design"],
      "designManifest": "./design-plugin.json",
      "configSchema": [
        {
          "key": "apiKey",
          "type": "secret",
          "label": "API key",
          "required": true
        }
      ]
    }
  }
}
```

Field rules (enforced by the loader — see
`src-api/src/shared/plugins/manifest.ts` for the authoritative schema):

- `name` — lower-kebab, `^[a-z0-9][a-z0-9-]{0,63}$`, globally unique per
  install tier. Skills are namespaced as `<name>:<skill>`.
- `version` — semver 2.0.
- `description` — 1–500 chars; shown on marketplace cards.
- `skills` — directory of `<skill>/SKILL.md` folders, default `skills`. The
  path must stay inside the plugin folder.
- `metadata.neuma.surfaces` — any of `task`, `design`, `video`, `chat`.
  **Omit it for general-purpose skill plugins.** Declaring surfaces removes
  the plugin's skills from the blanket agent skill list; they reach runs only
  through that surface's adapter (design catalog, video pipeline, task apply).
- `metadata.neuma.configSchema` — user-editable config fields (string,
  number, boolean, secret, enum). `secret` values are stored encrypted and
  never returned by HTTP APIs.

## Surface sidecars

A sidecar is a JSON file inside the plugin folder, referenced from
`metadata.neuma.<surface>Manifest`. It carries the domain contract; the
manifest stays generic.

- **Design** (`design-plugin.json`): `designSystems: [{ id, path }]` — each
  path points at a folder (or its `DESIGN.md`) inside the plugin. A
  design-system folder follows the package format documented in
  [../builtin/design-systems/_schema/](../builtin/design-systems/_schema/):
  `DESIGN.md`, `tokens.css`, `components.html`, `manifest.json`.
- **Video** (`video-plugin.json`): engine, pipeline stages, aspect ratios,
  declared capabilities. See `plugins/builtin/video-templates/*` for working
  examples and `dev-doc/runbooks/video-mode.md` for the runbook.
- **Task** (`task-plugin.json`): `promptGuide` / `systemPrompt`, pinned
  skills (max 3), pipeline stages, declared capabilities.

## Trust and capabilities

- Install tiers map to trust: `bundled` (ships with the app) → trusted;
  `local` / `imported` / `marketplace` / `github` / `url` → restricted until
  the user grants capabilities.
- Capabilities declared in manifests/sidecars are **requests, not authority**.
  The host prompts the user at apply time; ungrated capabilities are withheld.
- Every applied plugin produces a durable snapshot (manifest digest, granted
  capabilities, public config) so runs are reproducible and auditable.

## Distribution

The official registry (`plugins/registry/official/marketplace.json`) is
generated from `plugins/builtin/` by `scripts/generate-plugin-registry.mjs` —
never hand-edit it; CI fails on drift. Third-party catalogs use the same
Anthropic `marketplace.json` wire format: a JSON document at a stable URL
listing entries with `name`, `source` (relative path, `github:owner/repo`, or
https URL), `description`, `version`, and optional
`metadata.neuma.capabilitiesSummary` for pre-install disclosure.

Users add a catalog URL as a marketplace source with a trust level they
choose. Trust claimed inside a catalog document is ignored.

## Checklist before publishing

1. `plugin.json` parses and `name`/`version`/`description` obey the limits.
2. Every skill folder has a `SKILL.md` with `name` and `description`
   frontmatter.
3. Sidecar paths stay inside the plugin folder (no `..`).
4. Declared capabilities match what the skill actually needs — undeclared
   network/filesystem use fails at run time.
5. ASCII-only file names (signed macOS bundles reject non-ASCII resources).
