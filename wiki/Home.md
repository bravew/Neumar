# Neuma — Desktop AI Agent

> **Your Tireless AI Workhorse** — a cross-platform desktop application that executes natural language tasks through an intelligent two-phase workflow.

Neuma combines a React 19 frontend, a Hono 4 backend, and a Tauri 2 desktop shell into a production-grade AI agent platform. It streams real-time task execution, generates code and artifacts, integrates with your entire development toolchain, and learns from every session through a built-in memory system.

---

## Feature Highlights

| Capability | Details |
|---|---|
| **AI Agents** | Claude Code, Codex, DeepAgents — plug-in registry |
| **Two-Phase Execution** | Plan → approval → execute; user stays in control |
| **Real-Time Streaming** | SSE-based live progress with per-message cost tracking |
| **Artifact Preview** | Interactive HTML/React renderer, PDF viewer, syntax-highlighted code |
| **Memory System** | Hybrid vector + FTS5 search; remembers across sessions |
| **Voice I/O** | TTS/STT with OpenAI, Deepgram, and offline Sherpa-ONNX |
| **Media Generation** | DALL-E, Sora, Gemini, Volcengine image/video |
| **MCP Integration** | 100+ built-in tools + user-configured servers |
| **Linear → PR Pipeline** | Fully autonomous ticket-to-pull-request workflow |
| **Skills System** | Markdown-defined skill packs; marketplace + custom |
| **OAuth Integrations** | Google (Gmail/Drive/Calendar), Slack, Notion |
| **i18n** | English, Chinese, Spanish, French |
| **Multi-Brand** | White-label ready with `branding.json` configuration |

---

## Quick Navigation

### Getting Started
- [[Getting Started]] — Prerequisites, installation, first run
- [[Configuration]] — Branding, environment variables, MCP setup
- [[Contributing]] — Code conventions, PR workflow, testing requirements

### Architecture
- [[Architecture]] — System overview and design decisions
- [[Frontend]] — React 19 + Vite app structure
- [[Backend]] — Hono 4 API server and service layer
- [[Desktop Shell]] — Tauri 2 Rust shell

### Core Systems
- [[Agent System]] — Registry, plugins, two-phase execution
- [[MCP Integration]] — Built-in servers and user configuration
- [[Memory System]] — Long-term memory with hybrid search
- [[Voice Interface]] — TTS/STT pipeline
- [[Skills System]] — Skills format, marketplace, custom skills
- [[OAuth and Integrations]] — Google, Slack, Notion OAuth2

### Automation
- [[Linear Pipeline]] — Autonomous ticket-to-PR workflow

### Reference
- [[API Reference]] — HTTP endpoints and SSE streams
- [[Database Schema]] — SQLite tables and indexes
- [[Security]] — Isolation, encryption, OWASP mitigations
- [[Testing]] — Test suites, coverage, test helpers
- [[Build and Deployment]] — Production builds, CI/CD, platform targets

---

## Tech Stack at a Glance

```
┌─────────────────────────────────────────────────────┐
│  Tauri 2 Desktop Shell (Rust)                       │
│  ┌─────────────────┐  ┌───────────────────────────┐ │
│  │  React 19 + Vite│  │  Hono 4 API (Node.js)     │ │
│  │  TypeScript 5.8 │  │  Claude Agent SDK         │ │
│  │  Tailwind CSS 4 │  │  MCP / Linear / Slack      │ │
│  │  Radix UI       │  │  SQLite + sqlite-vec       │ │
│  └─────────────────┘  └───────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

| Layer | Key Dependencies |
|---|---|
| **Frontend** | React 19, Vite 7, Tailwind CSS 4, Radix UI, react-router-dom 7 |
| **Backend** | Hono 4, @anthropic-ai/claude-agent-sdk, @modelcontextprotocol/sdk, Zod 4 |
| **Desktop** | Tauri 2, tauri-plugin-sql, tauri-plugin-shell, tauri-plugin-fs |
| **Build** | pnpm workspaces, esbuild, @yao-pkg/pkg, TypeScript 5.8 |
| **Testing** | Vitest, React Testing Library |

---

## Port Reference (Development)

| Port | Service |
|---|---|
| `3420` | Vite dev server (frontend) |
| `5126` | Node.js API server |
| `1421` | Vite HMR WebSocket |
| `2620` | Production API sidecar |

---

## Version

Current release: **26.2.24** — see [CHANGELOG](../CHANGELOG.md) for release history.
