---
summary: "ProviderManager centralized lifecycle management for agent and sandbox providers, switching, and configuration persistence"
read_when:
  - Working with provider switching logic
  - Understanding how agent and sandbox providers are managed
  - Adding new provider types
title: "Provider Management"
---

# Provider Management

The `ProviderManager` (`src/shared/provider/manager.ts`) centralizes lifecycle management
for both agent and sandbox providers:

```
┌─────────────────────────────────────────┐
│            ProviderManager              │
│                                         │
│  ┌──────────────────┐                  │
│  │ Agent Registry   │ ← Plugin-based   │
│  │  • claude        │   registration   │
│  │  • codex         │                  │
│  │  • deepagents    │                  │
│  │  • a2a           │                  │
│  │  • gemini-local  │                  │
│  │  • http-agent    │                  │
│  │  • openai-compat │                  │
│  └──────────────────┘                  │
│                                         │
│  ┌──────────────────┐                  │
│  │ Sandbox Registry │ ← Same pattern   │
│  │  • native        │                  │
│  │  • claude        │                  │
│  │  • codex         │                  │
│  └──────────────────┘                  │
│                                         │
│  • Provider switching with cleanup      │
│  • Configuration persistence            │
│  • Event system for lifecycle events    │
│  • Availability checking                │
│  • Transport-based filtering            │
│  • Environment testing (preflight)      │
│  • Model discovery per provider         │
└─────────────────────────────────────────┘

## Agent Provider Matrix

| Provider | Transport | MCP Support | Plan Mode | Requires |
|----------|-----------|-------------|-----------|----------|
| Claude | `sdk` | `native` | `native` | API key |
| Codex | `cli` | `none` | `orchestrated` | Binary |
| DeepAgents | `sdk` | `none` | `native` | — |
| A2A | `a2a` | `none` | `native` | Base URL |
| Gemini Local | `cli` | `shim` | `orchestrated` | Binary |
| Cursor Local | `cli` | `none` | `none` | Binary |
| OpenCode Local | `cli` | `none` | `none` | Binary |
| Kimi (local CLI) | `cli` | `native` | `orchestrated` | Binary, `NEUMA_AGENT_KIMI=1` |
| HTTP Agent | `http` | `none` | `none` | Base URL |
| OpenAI-Compat | `http` | `shim` | `none` | API key |
```

The `/agent-runtimes/*` detection catalog is broader than this provider matrix. It
also tracks install/update metadata for local CLIs such as Cursor Agent, Qwen, Devin,
Kilo, Mistral Vibe, DeepSeek TUI, GitHub Copilot CLI, Kiro, Hermes, Kimi, AtomCode, and
Pi. Qoder is present only when `NEUMA_AGENT_QODER=1`, and AtomCode only when
`NEUMA_AGENT_ATOMCODE=1`. See [Agent System — Agent Runtime Detection
Catalog](agent-system.md#agent-runtime-detection-catalog) for per-runtime detail.

## OpenAI-Compatible Presets (Azure & Bedrock)

The following providers are OpenAI-compatible presets with specialized authentication
and SSRF allowlist entries.

### Azure OpenAI (ID: `azure-openai`)

- **Base URL template:** `https://{your-resource}.openai.azure.com/openai/v1`
- **Default models:** `gpt-4o`, `gpt-4o-mini`, `o3-mini`
- **Auth:** `api-key` header (not Bearer), auto-detected by `.openai.azure.com` URL pattern
- Supports dynamic model discovery

### Azure AI Foundry (ID: `azure-foundry`)

- **Base URL template:** `https://{your-resource}.services.ai.azure.com/openai/v1`
- **Default models:** `DeepSeek-R1`, `Meta-Llama-3.1-405B-Instruct`, `Mistral-large`
- **Auth:** `api-key` header, auto-detected by `.services.ai.azure.com` URL pattern
- Supports dynamic model discovery

### Amazon Bedrock (ID: `bedrock`)

- **Base URL:** `https://bedrock-mantle.us-east-1.api.aws/v1` (via Mantle gateway)
- **Default models:** `mistral.mistral-large-3-675b-instruct`, `qwen.qwen3-235b-a22b-2507`, `deepseek.v3.1`
- **Auth:** Standard Bearer token
- Supports dynamic model discovery

### Kimi API (K3) (ID: `moonshot-global`)

Hosted, API-key-based provider — separate from the local "Kimi Code CLI" runtime (see
[Agent System — Runtime Detection Catalog](agent-system.md#agent-runtime-detection-catalog)).
Do not move credentials between the two paths: Kimi Code owns its own OAuth session, while
this preset owns provider configuration and K3 continuation state in Neuma's database.

- **Base URL:** `https://api.moonshot.ai/v1`
- **Default model:** `kimi-k3`
- **Dialect:** `kimi-k3` (explicit — never inferred from model name or URL; a separate
  `moonshot-cn` preset for the Moonshot China endpoint uses the standard dialect and
  predates this integration)
- **Auth:** Standard Bearer token (Moonshot API key)

The `openai-compat` extension's dialect abstraction
(`src-api/src/extensions/agent/openai-compat/dialects/`: `index.ts`, `types.ts`,
`standard.ts`, `kimi-k3.ts`) implements K3-specific behavior on top of the generic
OpenAI-compatible adapter:

- **Always-on reasoning** — K3 always reasons; `reasoning_content` streams to the transient
  thinking UI, never to normal chat messages or telemetry. Effort maps as: Low → `low`,
  Medium or High → `high`, Extra High/Max/unspecified/disabled → `max`.
- **Strict structured output** — `response_format` uses strict JSON Schema.
- **Image guard** — PNG, JPEG, GIF, or WebP input, up to 20 MB.
- **Continuation state** — exact provider assistant envelopes are persisted locally in the
  `provider_conversation_state` table (migration 048,
  `src-api/src/shared/db/provider-conversation-state.ts`) because K3 requires them for
  correct multi-turn continuation. Changing provider, model, or workspace invalidates the
  stored state and Neuma intentionally starts a fresh conversation; switching the dialect
  back to `standard` breaks continuation and must not be done for this preset.

### Implementation Details

- `getAuthHeader(baseUrl, apiKey)` in `provider-headers.ts` handles Azure-specific `api-key` header routing
- SSRF allowlist updated: `.openai.azure.com`, `.services.ai.azure.com`, `bedrock-mantle.`
- Fast model map entries for background services: Azure → `gpt-4o-mini`, Bedrock → `mistral.ministral-3-3b-instruct`
- Provider test endpoint supports Azure/Bedrock with smart parameter handling (`max_completion_tokens` → `max_tokens` fallback)

---

*See also: [Agent System](agent-system.md) · [Sandbox System](sandbox.md) · [Configuration](configuration.md)*
