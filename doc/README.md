# Architecture Documentation

> **Version:** 26.4.8 · **Last Updated:** April 2026
>
> **Branding:** All product names, paths, and identifiers in this documentation are derived from
> brand configuration in [`branding/<slug>/branding.json`](../branding/) (the active brand
> is also mirrored to the root [`/branding.json`](../branding.json)). To rebrand, run
> `pnpm brand:sync -- --brand=<slug>`. Generic placeholders like `<slug>`, `<displayName>`,
> `<identifier>`, and `<binaryName>` refer to the corresponding fields in that file.

## About This Documentation

This is the architecture documentation for a cross-platform desktop AI agent application.
The documentation has been split into focused, topic-based pages for easier reading and
maintenance. Each page covers a specific domain and can be read independently.

## Documentation Map

### System Overview

| Document                                       | Description                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| [System Overview](system/overview.md)          | High-level architecture, dual runtime model, and technology stack |
| [Design Decisions](system/design-decisions.md) | Rationale behind key architectural choices                        |

### Frontend (`src/`)

| Document                                         | Description                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| [Frontend Overview](frontend/index.md)           | Directory structure, entry point, bootstrapping, and routing               |
| [Component Architecture](frontend/components.md) | Component hierarchy, patterns, and organization                            |
| [State Management](frontend/state-management.md) | State patterns, database abstraction layer, and data flow                  |
| [i18n & Theming](frontend/i18n-and-theming.md)   | Internationalization system and design system                              |
| [Hooks & Utilities](frontend/hooks.md)           | Core hooks (`useAgent`, `useProviders`) and utility libraries              |
| [DesignMode Frontend](frontend/design-mode.md)   | `/design` route, galleries, project workspace, preview modes, and settings |

### Backend API (`src-api/`)

| Document                                        | Description                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Backend Overview](backend/index.md)            | Directory structure, server startup, and middleware                                         |
| [API Routes](backend/api-routes.md)             | Complete route reference table                                                              |
| [Agent System](backend/agent-system.md)         | Registry + plugin architecture, BaseAgent, two-phase execution, Claude implementation       |
| [Sandbox System](backend/sandbox.md)            | Sandbox providers, capabilities, and instance pool                                          |
| [Provider Management](backend/providers.md)     | ProviderManager lifecycle and switching                                                     |
| [MCP Integration](backend/mcp.md)               | Model Context Protocol servers and tool integration                                         |
| [Skills System](backend/skills.md)              | Skill format, marketplace, install, and create                                              |
| [Configuration](backend/configuration.md)       | Constants, config loader, and branding system                                               |
| [Media Generation](backend/media-generation.md) | Provider-agnostic image and video generation service                                        |
| [DesignMode Backend](backend/design-mode.md)    | Local creation workspace APIs, catalogs, prompt composition, budgets, and exports           |
| [Auth System](backend/auth.md)                  | OAuth2 integration system — PKCE flow, encrypted token storage, Google/Slack/Notion clients |
| [Cloud Storage](backend/cloud-storage.md)       | Cloud, self-hosted media, stock catalog, and LAN bridge integration                         |
| [Memory System](backend/memory.md)              | Long-term memory with hybrid vector + keyword search                                        |
| [Linear Pipeline](backend/linear-pipeline.md)   | Autonomous ticket-to-PR workflow                                                            |
| [Video Mode Backend](backend/video-mode.md)     | Video project pipeline, timeline editing, preview runtime, render jobs, and plugins         |
| [Channel Plugin System](backend/channels.md)    | Multi-platform bot channels (Telegram, Slack, Discord, Lark)                                |
| [Automation Engine](backend/automation.md)      | Scheduled and event-driven agent workflows                                                  |
| [Multichannel Gateway](backend/gateway.md)      | Gateway adapters, routing, and voice integration                                            |
| [Web Search](backend/search.md)                 | Multi-provider search registry and routing                                                  |
| [Speech](backend/speech.md)                     | TTS/STT architecture, local models, and voice cloning                                       |

### Desktop Shell (`src-tauri/`)

| Document                          | Description                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------- |
| [Desktop Shell](desktop/index.md) | Tauri configuration, Rust core, SQLite, sidecar management, and capabilities |

### Data Flow

| Document                                              | Description                                                |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| [Task Lifecycle](data-flow/task-lifecycle.md)         | Task execution lifecycle and SSE streaming architecture    |
| [Streaming & Observation](data-flow/streaming.md)     | SSE patterns, TaskEventBus, and background task management |
| [Pipeline Lifecycle](data-flow/pipeline-lifecycle.md) | Autonomous Linear-to-PR pipeline data flow                 |

### Extension System

| Document                                 | Description                                              |
| ---------------------------------------- | -------------------------------------------------------- |
| [Plugins & Extensions](plugins/index.md) | Agent plugins, sandbox plugins, and all extension points |

### Build, Testing & Deployment

| Document                             | Description                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| [Build & Deployment](build/index.md) | Development workflow, test suites (Vitest), production build pipeline, CI/CD, and distribution |

### Deployment

| Document                                                               | Description                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [macOS Deployment](deployment/macos.md)                                | Step-by-step guide for deploying on Mac Mini (Apple Silicon) — from clean install to production service |
| [Code Signing & Notarization](deployment/code-signing-notarization.md) | Apple certificates, GitHub secrets, Windows signing, and Tauri updater                                  |

### Security

| Document                      | Description                                                         |
| ----------------------------- | ------------------------------------------------------------------- |
| [Security](security/index.md) | Workspace isolation, path validation, encryption, OWASP mitigations |

### Reference

| Document                                        | Description                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| [Port Reference](reference/ports.md)            | Development and production port assignments                         |
| [File System Layout](reference/file-system.md)  | Project root and application data directory structure               |
| [Database Schema](reference/database-schema.md) | Complete SQLite schema with all tables, indexes, and virtual tables |

---

_For development commands and quick reference, see [CLAUDE.md](../CLAUDE.md)._
