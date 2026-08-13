---
summary: "Frontend directory structure, entry point bootstrapping chain, and React Router v7 routing configuration"
read_when:
  - Understanding the frontend project layout
  - Working on app bootstrapping or initialization
  - Adding new routes or pages
title: "Frontend Overview"
---

# Frontend Overview (`src/`)

## Directory Structure

```
src/
├── app/                        # Application core
│   ├── pages/                  # Route page components
│   │   ├── Home.tsx            # Landing / new task page
│   │   ├── TaskDetail.tsx      # Active task view (plan → execution) — V1
│   │   ├── TaskDetailV2.tsx    # AG-UI + CopilotKit V2 task view
│   │   ├── DesignMode/         # DesignMode route (`/design`, `/design/:projectId`)
│   │   ├── Library.tsx         # Task, plugin, cloud storage, and knowledge graph library
│   │   ├── Setup.tsx           # Initial setup wizard
│   │   ├── QuickStartWizard.tsx # 3-step soul template onboarding wizard
│   │   ├── ProfileDetail.tsx   # Dedicated agent profile detail/edit page
│   │   └── OrgView.tsx         # Organization view page
│   ├── App.tsx                 # Root application component
│   └── router.tsx              # React Router v7 configuration
│
├── components/                 # Feature-organized components
│   ├── artifacts/              # File preview renderers (PDF, code, images, etc.)
│   ├── common/                 # Shared visual elements (logo)
│   ├── home/                   # Home page components (AgentMessages, TaskInput)
│   ├── layout/                 # App layout (sidebars, layout context)
│   ├── library/                # Library page components (tasks, plugins, cloud storage, knowledge graph)
│   ├── settings/               # Settings modal with tabbed sections
│   │   └── tabs/
│   │       ├── ConnectorSettings.tsx  # Linear/GitHub/Slack connector config
│   │       ├── MemorySettings.tsx     # Long-term memory configuration + management
│   │       ├── DesignModeSettings.tsx # DesignMode defaults, budgets, and dependencies
│   │       └── ...                    # Other settings tabs
│   ├── design/                 # DesignMode entry, galleries, project workspace, previews, exports
│   ├── settings-modal.tsx      # Settings modal re-export
│   ├── shared/                 # Reusable components
│   │   ├── ChatInput.tsx        # Unified chat input (orchestrator)
│   │   ├── ChatInput.types.ts   # Types, model builders, file utilities
│   │   ├── ChatInputActions.tsx  # Bottom action bar (files, folders, model, submit)
│   │   ├── ChatInputAttachments.tsx # Attachment management + video thumbnails
│   │   ├── ChatInputChips.tsx   # MCP server + skill chip strips
│   │   ├── ChatInputModelSelector.tsx # Model dropdown grouped by provider
│   │   ├── useChatInputFiles.ts # File handling hook (picker, paste, drag-drop)
│   │   ├── useChatInputState.ts # Stateful logic (MCP, skills, model, speech)
│   │   ├── FolderPicker.tsx     # Cowork-style folder dropdown with recent folders + permission consent
│   │   ├── FolderPermissionDialog.tsx  # Permission consent dialog ("Allow … to change files?")
│   │   └── LazyImage.tsx        # Lazy-loaded image component
│   ├── profiles/               # Agent profile management
│   │   ├── detail/             # Profile detail tabs
│   │   │   ├── OverviewTabContent.tsx
│   │   │   ├── ToolsTabContent.tsx
│   │   │   ├── ProfileDetailSidebar.tsx
│   │   │   ├── ProfileDetailTabs.tsx
│   │   │   ├── ProfileSaveBar.tsx
│   │   │   └── QuickSetupCard.tsx
│   │   └── soul/               # Soul editor UI
│   │       ├── SoulEditor.tsx
│   │       ├── SoulIdentityTab.tsx
│   │       ├── SoulVoiceTab.tsx
│   │       ├── SoulCognitionTab.tsx
│   │       ├── SoulBoundariesTab.tsx
│   │       ├── SoulEvolutionTab.tsx
│   │       ├── EditableList.tsx
│   │       ├── KeyValueEditor.tsx
│   │       └── TagInput.tsx
│   ├── quickstart/             # QuickStart wizard steps
│   │   ├── TemplateStep.tsx
│   │   ├── PersonalizeStep.tsx
│   │   └── ConfirmStep.tsx
│   ├── org/                    # Organization components
│   │   └── OrgProfileCard.tsx
│   ├── task/                   # Task execution UI (PlanApproval, ToolExecution, etc.)
│   │   └── trace/              # Trace viewer components
│   │       ├── TraceViewer.tsx       # Container: hooks, metrics, filters, timeline
│   │       ├── TraceTimeline.tsx     # Virtualized trace entry list (react-virtuoso)
│   │       └── TraceMetricsSummary.tsx # Top-strip metrics (duration, tokens, cost)
│   ├── workspace/              # Workspace panel components
│   │   ├── WorkspacePanel.tsx        # Tabbed container (Preview, Files, Diff, Trace)
│   │   ├── WorkspaceFileTree.tsx     # Directory tree browser (depth 3)
│   │   ├── WorkspaceDiffView.tsx     # File diff viewer (side-by-side / unified)
│   │   └── index.ts                  # Public exports
│   └── ui/                     # Radix UI primitives (button, dialog, sheet, etc.)
│
├── config/                     # Application configuration
│   ├── index.ts                # API URLs, port detection, app metadata
│   ├── locale/                 # i18n message files (en, zh, es, fr, hi, pt)
│   └── style/                  # Global CSS and theme variables
│       ├── global.css          # Tailwind base, animations, prose styles
│       └── theme.css           # Design tokens (OKLCH colors, shadows, fonts)
│
├── shared/                     # Shared logic and utilities
│   ├── db/                     # Database abstraction layer
│   │   ├── database.ts         # Dual-backend DB (SQLite / IndexedDB)
│   │   ├── settings.ts         # Settings persistence (cache + DB)
│   │   └── types.ts            # TypeScript interfaces for all entities
│   ├── hooks/                  # Custom React hooks
│   │   ├── useAgent.ts         # Core agent execution hook (V1)
│   │   ├── useAgentSync.ts     # Reactive agent state sync for V2
│   │   ├── useThreadSync.ts    # Direct SSE subscription for AG-UI live reconnection
│   │   ├── useNeumaAGUIEvents.ts # CUSTOM event extraction from AG-UI stream
│   │   ├── usePlanInterrupt.ts # Plan approval workflow (poll, approve, reject)
│   │   ├── useRunError.ts      # Error handling watchdog for AG-UI runs
│   │   ├── usePostRunEffects.ts # Post-run side effects (title, notification, files)
│   │   ├── useProviders.ts     # Provider management hook
│   │   ├── useVitePreview.ts   # Vite preview integration
│   │   ├── useV2Artifacts.ts   # Artifact extraction for V2 workspace panel
│   │   ├── useV2TaskLoader.ts  # Task loading and sidebar state for V2
│   │   ├── useTaskModelSelector.ts # Per-task model selection persistence
│   │   ├── useDispatch.ts      # Background task dispatch (fire-and-forget agent runs)
│   │   ├── useQueueStatus.ts   # Per-profile and global task queue state polling
│   │   ├── useFileDiffs.ts     # File snapshot diff extraction for WorkspaceDiffView
│   │   └── useDesignMode.ts    # DesignMode API client helpers and catalog/project hooks
│   ├── lib/                    # Utility libraries
│   │   ├── api/providers.ts    # Provider API client
│   │   ├── attachments.ts      # File attachment handling
│   │   ├── background-tasks.ts # Background task tracker
│   │   ├── folder-permissions.ts # Pure functions for folder permission CRUD (getRecent, upsert, remove)
│   │   ├── message-tree.ts     # Branch projection: flattenMessageTree, findForkPoints, dbMessagesToAGUI
│   │   ├── paths.ts            # Cross-platform path utilities
│   │   ├── session.ts          # Session ID generation and slugs
│   │   └── utils.ts            # cn() class name utility
│   ├── types/                  # Shared TypeScript type definitions
│   │   └── folder-permissions.ts # FolderPermission, PermissionDialogResult types
│   ├── providers/              # React context providers
│   │   ├── theme-provider.tsx   # Theme, accent color, background style
│   │   ├── language-provider.tsx # i18n with translation function
│   │   ├── agui-provider.tsx    # CopilotKit AG-UI provider (wraps thread)
│   │   └── AgentExternalRuntimeProvider.tsx # V1→assistant-ui bridge runtime
│   └── stores/
│       ├── branch-store.ts      # Zustand store for per-task conversation branching state
│       └── thread-store.ts      # Zustand store for per-task AG-UI message state
│
├── core/                       # Core business logic
│   └── i18n/translations.ts    # Translation type definitions
│
├── types/                      # Global type declarations
│   └── react-markdown.d.ts     # Module augmentation
├── vite-env.d.ts               # Vite env types (ImportMetaEnv: VITE_API_PORT)
│
└── main.tsx                    # Application entry point
```

## Entry Point & Bootstrapping

The application bootstraps through the following chain:

```
index.html
  └── main.tsx
        ├── Initialize settings from database (await)
        ├── ErrorBoundary  ← catches unhandled React errors, shows recovery UI
        │   └── LanguageProvider  ← detects system language, loads translations
        │       └── ThemeProvider ← applies CSS variables, listens to OS theme
        │           └── RouterProvider ← renders matched route (lazy-loaded pages)
        └── Database migration (automatic on first load)
```

Key bootstrap steps:

1. **Settings hydration** — loads cached settings from the database before first render
2. **Error boundary** — `react-error-boundary` wraps the entire tree with a fallback UI
3. **Provider wrapping** — language and theme providers wrap the entire tree
4. **Lazy routing** — page components are code-split via `React.lazy()` with `Suspense` fallbacks
5. **Database migration** — creates/updates tables on first load (SQLite or IndexedDB)

## Routing

Routing uses **react-router-dom v7** with `createBrowserRouter`:

| Path                 | Component          | Guard              | Purpose                                               |
| -------------------- | ------------------ | ------------------ | ----------------------------------------------------- |
| `/`                  | `Home`             | `SetupGuard`       | New task input and agent interaction                  |
| `/task/:taskId`      | `TaskDetail`       | `SetupGuard`       | Active task with plan/execution phases (V1)           |
| `/task-v2/:taskId`   | `TaskDetailV2`     | `SetupGuard`       | AG-UI + CopilotKit V2 task view                       |
| `/design`            | `DesignModeRoute`  | DesignMode setting | DesignMode entry workspace and galleries              |
| `/design/:projectId` | `DesignModeRoute`  | DesignMode setting | DesignMode project workspace                          |
| `/library`           | `Library`          | `SetupGuard`       | Task/plugin/cloud-storage library with search, filters, previews, and knowledge graph |
| `/setup`             | `Setup`            | None               | Initial setup (Claude Code installation check)        |
| `/quickstart`        | `QuickStartWizard` | `SetupGuard`       | Soul template onboarding (3-step wizard)              |
| `/profiles/:id`      | `ProfileDetail`    | `SetupGuard`       | Agent profile detail with soul editor                 |
| `/org`               | `OrgView`          | `SetupGuard`       | Organization view                                     |

All page components are **lazy-loaded** via `React.lazy()` and wrapped in `Suspense` with a
spinner fallback (`PageLoader`). This enables automatic code-splitting — each page bundle is
only downloaded when the route is first visited.

The `SetupGuard` component verifies that required dependencies (like Claude Code CLI) are
available before allowing access to the main application routes.

---

_See also: [Components](components.md) · [State Management](state-management.md) · [Hooks](hooks.md) · [DesignMode Frontend](design-mode.md)_
