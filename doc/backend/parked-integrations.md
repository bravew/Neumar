---
summary: "Capabilities that are present in the tree but deliberately not finished — live artifact events, the MCP shim, and social publishing — with their integration status and revisit dates"
read_when:
  - Deciding whether to build on artifact events, the MCP shim, or social publishing
  - Removing or reviving a scaffold that looks unused
  - Checking whether an unfinished capability has an owner or a revisit date
title: "Parked Integrations"
---

# Parked Integrations

Three capabilities exist in the tree with working code and tests, but no live
integration end to end. They were reviewed on 2026-10-13 and the maintainer
decided to keep them on 2026-10-14 (issue #221). This page records what each one
is, exactly how far it reaches, and what would finish it. Treat the status here
as the current answer to "is this wired up?".

Removing any of these is a separate decision. Do not delete a scaffold because it
looks unused; check this page first.

## Live artifact events (V2)

**Status:** protocol complete, client complete, no producer. Parked.

The wire protocol, the server-side validators, and the client reducer are all
implemented and tested. Nothing publishes an event, so the feature is inert even
when enabled.

What exists:

- Wire types and the `isArtifactEvent` guard in `src/shared/types/artifact.ts`.
- Server validators and publishers in
  `src-api/src/shared/services/artifact-events.ts`. Every event is parsed through
  `ArtifactEventSchema` before it reaches the bus, and a malformed event is
  dropped with a warning rather than published.
- A pure client reducer in `src/shared/artifacts/reducer.ts`, exposed through
  `useLiveArtifacts()`.
- The panel at `src/components/artifacts/live/LiveArtifactPanel.tsx`.

What is missing:

- **A producer.** `publishArtifactCreate`, `publishArtifactAppend`,
  `publishArtifactReplace`, `publishArtifactPatch`, `publishArtifactDelete` and
  `publishArtifactEvent` have no caller outside their own module and its test. The
  intended producer is an agent tool call or a `PostToolUse` hook, per the flow
  diagram in [Streaming & Observation](../data-flow/streaming.md#artifact-event-protocol-v2).
- **An enabled flag.** `artifactsV2` defaults to `false`
  (`src/shared/db/settings.ts`). The setting is user-visible under
  Settings → General as "Live Artifacts (Beta)".

The client is gated on the flag, and `useLiveArtifacts()` returns an empty map
when it is off, so mounting the panel unconditionally is safe. `TaskDetailV2`
mounts it only when the map is non-empty and no other artifact is selected, and
auto-opens the preview on the first artifact of a run.

To finish it: publish events from wherever a tool produces a renderable artifact,
then verify the panel against a running task with `artifactsV2` on. The protocol
and reducer need no changes to do that.

## MCP shim

**Status:** implemented, tested, never instantiated. Superseded in practice.

`src-api/src/core/agent/mcp-shim.ts` translates MCP tools into OpenAI and Gemini
tool formats. No adapter constructs an `McpShim`, and no plugin declares
`supportsMcp: 'shim'`. Its only caller is
`src-api/test/integration/mcp-shim.test.ts`.

Two other mechanisms do reach non-Claude runtimes with MCP tools, and both were
built after the shim:

- **Subprocess bridge** (`src-api/src/shared/mcp/subprocess-bridge/`) mints
  per-run bearer tokens and renders loopback `mcp_servers` entries into whatever
  config format the CLI reads. Codex gets `--config mcp_servers.*`, Cursor Agent
  gets a workspace `.cursor/mcp.json`, Kimi gets ACP `mcpServers`.
- **Native SDK MCP** — Claude passes `mcpServers` directly to the Agent SDK.

Because the bridge covers the CLI runtimes the shim was written for, the shim is
a candidate for removal rather than for wiring. That is a separate decision;
nothing depends on it today.

See [Agent System — MCP Shim](../backend/agent-system.md#mcp-shim-unused) for the
per-adapter detail.

## Social publishing

**Status:** clients and adapters complete, destinations unregistered. Parked.
**Revisit by:** 2026-11-14.

Eight social clients live in `src-api/src/shared/integrations/social/` (Bluesky,
Instagram, LinkedIn, Mastodon, Threads, TikTok, X, YouTube), with matching
destination adapters in
`src-api/src/shared/services/publish/destinations/social/` and unit tests for
Instagram, LinkedIn, TikTok, X and YouTube.

They are not reachable at runtime. `createDefaultPublishRegistry()` in
`src-api/src/shared/services/publish/registry.ts` registers only the local
archive, Immich, and the Box/Dropbox/OneDrive cloud destinations. No code calls
the `create*Destination` factories outside their tests.

Two gates would also need to open before a social publish could run:

- `PUBLISH_PIPELINE_ENABLED` must be set. `isPublishDestinationEnabled()` returns
  false for every destination when the pipeline flag is off.
- Per-network flags default to off. `socialFlagName()` maps a kind to
  `PUBLISH_SOCIAL_<KIND>_ENABLED`, and `isPublishDestinationEnabled()` reads it
  with a `false` fallback.

To finish it: register the destinations, then confirm each network's credentials,
rate limits and media constraints against the live API. The adapters have only
been exercised against fixtures, so that verification is the real work, not the
registration.

Revisit by 2026-11-14: either pick up the registration and live verification, or
record a decision to remove the clients. Leaving it past that date without a
decision is what this note exists to prevent.
