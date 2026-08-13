---
summary: "High-level architecture, dual runtime model, technology stack, and core design principles"
read_when:
  - Getting an overview of the entire system
  - Understanding how the three layers (frontend, API, desktop shell) fit together
  - Looking up the technology stack
title: "System Overview"
---

# System Overview

This is a cross-platform desktop AI agent application that executes natural language
tasks through a two-phase workflow: **planning** (the agent proposes steps) → **execution**
(the user approves, the agent runs with tool access). It integrates multiple AI agent backends
(Claude, Codex, DeepAgents, A2A, Gemini Local, OpenCode, Cursor, HTTP Agent, and
additional detected local runtimes) and supports extensibility through
the Model Context Protocol (MCP), an MCP shim for non-Claude providers, a custom skills system,
agent profiles for multi-agent delegation, user templates for quick-start presets,
a provider-agnostic media generation service for image and video creation,
cloud storage and personal media browsing for connected libraries and stock catalogs,
session budget guards for cost and safety control,
an end-to-end speech system for voice input (STT) and text-to-speech output (TTS),
and an **AG-UI protocol layer** with CopilotKit V2 runtime for standards-based agent streaming.

Beyond interactive usage, the application includes an **autonomous ticket-to-PR pipeline** that
integrates with Linear, GitHub, and Slack. When a Linear ticket is assigned, the pipeline
autonomously creates a branch, implements the change, verifies correctness (lint + type-check),
opens a pull request, responds to review feedback, and notifies via Slack for human review —
all without manual intervention until final merge approval.

## Core Principles

| Principle | Description |
|-----------|-------------|
| **Streaming-first** | All long-running operations use async generators and SSE for real-time UI updates |
| **Plugin-based extensibility** | Agent and sandbox providers are registered via a plugin/registry pattern; 7 built-in agent plugins |
| **Multi-agent delegation** | Agent profiles with delegation chains, depth limits, and allowed-delegates whitelists |
| **Session safety** | Per-session cost caps and agent loop detection via SessionBudgetGuard |
| **Workspace isolation** | All file operations are confined to user-configured workspace directories |
| **Dual runtime** | Development runs processes separately; production bundles everything into a single app |
| **Offline-capable persistence** | SQLite (desktop) with IndexedDB fallback (browser) |
| **Long-term memory** | Persistent cross-session memory with hybrid vector + keyword search (sqlite-vec + FTS5) |
| **Autonomous operation** | Linear integration pipeline runs end-to-end without human intervention (except final merge) |
| **Voice I/O** | Provider-agnostic TTS/STT with streaming WebSocket STT, sentence-by-sentence TTS, and offline local models |
| **Cloud media access** | Cloud storage, self-hosted media, stock catalogs, and LAN bridge reads share a common adapter model |
| **AG-UI protocol** | Standards-based agent streaming via AG-UI events + CopilotKit V2 runtime; detached pipeline pattern with late-joiner replay |

## High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         Desktop Application                          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Tauri 2 Shell (Rust)                     │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │   SQLite     │  │  Sidecar Mgr │  │  File System     │  │  │
│  │  │   Plugin     │  │  (API Binary) │  │  Plugin          │  │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │  │
│  └─────────┼─────────────────┼────────────────────────────────┘  │
│            │                 │                                    │
│  ┌─────────▼─────────────────▼────────────────────────────────┐  │
│  │              React 19 Frontend (Webview)                    │  │
│  │                                                             │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │  │
│  │  │  Pages   │  │Components│  │  Hooks   │  │ Providers  │  │  │
│  │  │ (Router) │  │ (UI/Task)│  │(useAgent)│  │(Theme/i18n)│  │  │
│  │  └──────────┘  └──────────┘  └────┬─────┘  └───────────┘  │  │
│  │                                   │ SSE                     │  │
│  └───────────────────────────────────┼─────────────────────────┘  │
│                                      │                            │
│  ┌───────────────────────────────────▼─────────────────────────┐  │
│  │              Node.js API Server (Hono 4)                     │  │
│  │                                                              │  │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────────────┐  │  │
│  │  │  Agent  │  │ Sandbox  │  │ Provider│  │  MCP / Skills │  │  │
│  │  │  Core   │  │  Core    │  │ Manager │  │  Integration  │  │  │
│  │  └────┬────┘  └────┬─────┘  └─────────┘  └──────┬───────┘  │  │
│  │       │             │                            │           │  │
│  │  ┌────▼────┐  ┌─────▼─────┐  ┌──────────────────▼────────┐ │  │
│  │  │ Claude  │  │  Native   │  │  Media Generation Service │ │  │
│  │  │ Codex   │  │  Claude   │  │  (BytePlus/OpenAI/Gemini) │ │  │
│  │  │ Deep... │  │  Codex    │  │  Image + Video adapters   │ │  │
│  │  │ A2A     │  └───────────┘  └───────────────────────────┘ │  │
│  │  │ Gemini  │                                                │  │
│  │  │ HTTP    │  ┌───────────────────────────────────────────┐ │  │
│  │  └────┬────┘  │  Agent Profiles · Templates · Delegation │ │  │
│  │       │       │  Session Budget · MCP Shim               │ │  │
│  │       │       │  AG-UI Protocol · CopilotKit V2 Runtime  │ │  │
│  │       │       └───────────────────────────────────────────┘ │  │
│  │       │                                                      │  │
│  │  ┌────▼────────────────────────────────────────────────────┐ │  │
│  │  │              Memory System (sqlite-vec + FTS5)          │ │  │
│  │  │  Embeddings · Auto-capture · Recall · Session Indexing  │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                              │
      ┌──────────────────┼──────────────────────────────┐
      ▼            ▼            ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│Anthropic │ │ OpenAI   │ │  Google  │ │  MCP     │ │ Integrations │
│  API     │ │ API      │ │  Gemini  │ │ Servers  │ │              │
└──────────┘ └──────────┘ └──────────┘ └──────────┘ │ • Linear     │
                                                     │ • GitHub     │
                                                     │ • Slack      │
                                                     │ • ElevenLabs │
                                                     └──────────────┘
```

## Dual Runtime Model

The application operates differently in development and production environments:

| Aspect | Development | Production |
|--------|-------------|------------|
| **Frontend** | Vite dev server (port 3420) | Bundled into Tauri webview (`dist/`) |
| **API Server** | Node.js process (port 5126) | Native sidecar binary (port 2620) |
| **Database** | SQLite via Tauri plugin | SQLite via Tauri plugin |
| **Browser fallback** | IndexedDB + localStorage | N/A (always Tauri) |
| **Hot reload** | Full HMR via Vite | Not applicable |

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 19, Vite 7, TypeScript 5.8, Tailwind CSS 4, Radix UI, react-router-dom 7, react-markdown, react-error-boundary, @copilotkit/react-core, @assistant-ui/react, @ag-ui/client |
| **Backend API** | Hono 4, Node.js, @anthropic-ai/claude-agent-sdk, @hono/zod-validator, @modelcontextprotocol/sdk, @linear/sdk, Zod 4, better-sqlite3, sqlite-vec, @huggingface/transformers, @hono/node-ws, sherpa-onnx-node, @ag-ui/encoder, @copilotkit/runtime |
| **Desktop Shell** | Tauri 2, Rust, tauri-plugin-sql (SQLite), tauri-plugin-shell, tauri-plugin-fs, tauri-plugin-dialog |
| **Build Tools** | pnpm workspaces, esbuild, @yao-pkg/pkg (local), Bun compile (CI), TypeScript |
| **CI/CD** | GitHub Actions, matrix builds (Linux/Windows/macOS) |

---

*See also: [Design Decisions](design-decisions.md) · [Frontend](../frontend/index.md) · [Backend](../backend/index.md) · [Desktop Shell](../desktop/index.md)*
