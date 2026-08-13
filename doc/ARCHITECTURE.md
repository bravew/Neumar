# Architecture Document

> **This document has been split into focused, topic-based pages for easier reading and maintenance.**
>
> See **[doc/README.md](README.md)** for the full documentation index.

## Quick Links

| Topic | Document |
|-------|----------|
| **System Overview** | [system/overview.md](system/overview.md) — High-level architecture, dual runtime, tech stack |
| **Design Decisions** | [system/design-decisions.md](system/design-decisions.md) — Rationale behind key choices |
| **Frontend** | [frontend/index.md](frontend/index.md) — Directory structure, routing, bootstrapping |
| **Components** | [frontend/components.md](frontend/components.md) — Component hierarchy and patterns |
| **State Management** | [frontend/state-management.md](frontend/state-management.md) — State, database abstraction |
| **i18n & Theming** | [frontend/i18n-and-theming.md](frontend/i18n-and-theming.md) — Translations and design system |
| **Hooks** | [frontend/hooks.md](frontend/hooks.md) — useAgent, useProviders, utilities |
| **Backend** | [backend/index.md](backend/index.md) — Server, middleware, directory structure |
| **API Routes** | [backend/api-routes.md](backend/api-routes.md) — Complete route reference (V1 agent + V2 AG-UI + CopilotKit) |
| **Agent System** | [backend/agent-system.md](backend/agent-system.md) — Registry, BaseAgent, two-phase execution |
| **Sandbox** | [backend/sandbox.md](backend/sandbox.md) — Sandbox providers and pool |
| **Providers** | [backend/providers.md](backend/providers.md) — Provider management |
| **MCP** | [backend/mcp.md](backend/mcp.md) — MCP servers and tool integration |
| **Skills** | [backend/skills.md](backend/skills.md) — Skills format and marketplace |
| **Configuration** | [backend/configuration.md](backend/configuration.md) — Constants and branding system |
| **Media Generation** | [backend/media-generation.md](backend/media-generation.md) — Image and video generation |
| **Cloud Storage** | [backend/cloud-storage.md](backend/cloud-storage.md) — Cloud providers, self-hosted media, stock catalogs, LAN bridge |
| **Memory** | [backend/memory.md](backend/memory.md) — Long-term memory system |
| **Linear Pipeline** | [backend/linear-pipeline.md](backend/linear-pipeline.md) — Autonomous ticket-to-PR |
| **Channel Plugins** | [backend/channels.md](backend/channels.md) — Telegram, Lark/Feishu, Discord, Slack — unified security pipeline, sessions, audit log |
| **Approvals** | [reference/database-schema.md](reference/database-schema.md#migration-015-approvals) — Human-in-the-loop approval gates (plan, delegation, budget override) |
| **WebUI / Remote Access** | [backend/auth.md](backend/auth.md#webui-jwt-auth-remote-access-mode) — JWT auth, `--webui` static serving, `--remote` mode, PWA |
| **Desktop Shell** | [desktop/index.md](desktop/index.md) — Tauri, Rust, sidecar management |
| **Task Lifecycle** | [data-flow/task-lifecycle.md](data-flow/task-lifecycle.md) — Execution flow |
| **Streaming** | [data-flow/streaming.md](data-flow/streaming.md) — SSE, TaskEventBus, AG-UI protocol, background tasks |
| **Pipeline Lifecycle** | [data-flow/pipeline-lifecycle.md](data-flow/pipeline-lifecycle.md) — Autonomous pipeline flow |
| **Agent Profiles & Delegation** | [backend/agent-system.md](backend/agent-system.md#agent-profiles) — Multi-agent profiles, delegation service, session budget |
| **Plugins** | [plugins/index.md](plugins/index.md) — Extension points |
| **Build** | [build/index.md](build/index.md) — Build pipeline, CI/CD, distribution |
| **Security** | [security/index.md](security/index.md) — Isolation, encryption, OWASP |
| **macOS Deployment** | [deployment/macos.md](deployment/macos.md) — Clean install to production on Mac Mini |
| **Port Reference** | [reference/ports.md](reference/ports.md) — Port assignments |
| **File System** | [reference/file-system.md](reference/file-system.md) — Directory layout |
| **Database Schema** | [reference/database-schema.md](reference/database-schema.md) — Complete SQL schema |

---

*Version: 26.3.27 · Last Updated: March 2026*
