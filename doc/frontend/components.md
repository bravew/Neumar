---
summary: "React component hierarchy, feature-based organization, compound components, artifacts system, and UI primitives"
read_when:
  - Adding or modifying UI components
  - Understanding the component tree structure
  - Working with the artifacts/file preview system
title: "Component Architecture"
---

# Component Architecture

## Component Hierarchy

```
ErrorBoundary (react-error-boundary)
└── LanguageProvider
    └── ThemeProvider
        └── RouterProvider
        ├── SetupGuard
        │   ├── Home
        │   │   ├── TaskInput (ChatInput, attachment handling)
        │   │   └── AgentMessages (streaming message display)
        │   ├── TaskDetail (V1)
        │   │   ├── SidebarProvider
        │   │   ├── LeftSidebar (session history, navigation)
        │   │   ├── Main content
        │   │   │   ├── MessageList (message rendering + grouping)
        │   │   │   │   ├── MessageItem (individual message)
        │   │   │   │   ├── UserMessage (user input display)
        │   │   │   │   ├── ErrorMessage (error display)
        │   │   │   │   ├── RunningIndicator (agent thinking state)
        │   │   │   │   └── TaskGroupComponent (tool use groups)
        │   │   │   ├── PlanApproval (plan review and approval)
        │   │   │   ├── ToolExecutionItem (tool call display)
        │   │   │   └── QuestionInput (agent follow-up questions)
        │   │   └── RightSidebar (file preview, VirtualComputer)
        │   ├── TaskDetailV2 (AG-UI + CopilotKit V2)
        │   │   ├── AgUiProvider (CopilotKit runtime wrapper)
        │   │   ├── TaskV2Thread (main thread view)
        │   │   │   ├── GroupedMessageList (tool-call grouping, virtualized)
        │   │   │   ├── TaskV2MessageBubble (message rendering)
        │   │   │   ├── TaskV2ToolCallGroup (collapsible tool groups)
        │   │   │   ├── TaskV2ToolCallItems (individual tool display)
        │   │   │   ├── InlineQuestionCard (interactive multi-choice)
        │   │   │   ├── PlanInterruptCard (plan approval via useInterrupt)
        │   │   │   └── RunErrorBubble (error display)
        │   │   ├── WorkspacePanel (tabbed workspace area)
        │   │   │   ├── Preview tab (artifact preview via WorkspaceRouter)
        │   │   │   ├── Files tab (WorkspaceFileTree — directory browser)
        │   │   │   ├── Diff tab (WorkspaceDiffView — side-by-side/unified)
        │   │   │   └── Trace tab (TraceViewer — operation timeline)
        │   │   └── InitialMessageSender (two-phase task initialization)
        │   ├── Home
        │   │   ├── ParallelTaskDashboard (multi-task status strip)
        │   │   └── BackgroundTasksSection (dispatched task list)
        │   ├── Dashboard
        │   │   ├── ActivityFeed (recent activity_events stream)
        │   │   ├── TaskFlowChart (daily created/completed/failed chart)
        │   │   └── CostPanel (observability cost rollup)
        │   ├── Projects
        │   │   └── ProjectCard (project summary with task counts)
        │   ├── ProjectDetail
        │   │   ├── TaskMetadata (project_id, goal_id, priority, labels)
        │   │   ├── SubTasks (parent_task_id child task list)
        │   │   └── TaskComments (threaded task_comments display)
        │   └── Library
        │       ├── LibraryToolbar (search, filter, sort, batch actions)
        │       ├── LibraryTaskRow (task row with status, metadata, checkbox)
        │       └── LibraryDeleteDialog (batch delete confirmation)
        ├── AgentProfiles
        │   ├── ProfileCard (status badge, actions)
        │   ├── ProfileDialog (create/edit form with avatar, config)
        │   ├── SoulSection (extracted soul editor with template picker, lazy evolution data)
        │   └── avatar-options (DiceBear SVG + color picker)
        ├── Setup (onboarding wizard)
        └── Shared components
            ├── ContextUsageIndicator (token budget / context window fill)
            ├── TemplateGallery (searchable grid, filter by category)
            ├── SkillSelector (grouped by category, pinned skills)
            └── SlashCommandMenu (command palette triggered by "/" in ChatInput)
```

## Component Patterns

- **Feature-based grouping** — components are organized by their feature domain, not by type
- **Compound components** — complex UIs like `SettingsModal` use tabbed sub-components
- **Artifacts system** — polymorphic file previews (`components/artifacts/`) dispatch to
  specialized renderers (PDF, code, image, video, audio, DOCX, XLSX, PPTX, fonts, etc.)
- **UI primitives** — `components/ui/` wraps Radix UI with Tailwind styling and `cn()` utility
- **MCP presets** — `MCPSettings` includes a "Presets" tab with a curated gallery of popular
  MCP servers (context7, sequential-thinking, memory, filesystem, brave-search, github,
  puppeteer, fetch, everart, playwright) with one-click install/uninstall
- **Cost breakdown tooltip** — `MessageToolbar` shows per-message cost, input/output tokens,
  and cache usage (read + creation) in an inline tooltip (replaces the previous dropdown menu)

## Agent Profiles UI

The **Agent Profiles** page (`/agent-profiles`) provides full CRUD management:

- `OrgProfileCard` — card-based display with role-based avatar (Lucide icon + color), status indicator (green pulse=active, amber=paused, gray=archived), hover action buttons (Edit, Pause/Play, Delete), and animated delete confirmation overlay. Uses `cardHover` variant for lift effect.
- `ProfileDialog` — comprehensive form for all profile fields (name, role, description, runtime, model, MCP servers, skills, system prompt, delegation limits, avatar)
- `AvatarPicker` — interactive avatar selector with live preview, 12-color palette (indigo, purple, magenta, pink, red, orange, yellow, green, teal, cyan, blue, slate), and 75+ Lucide React icons organized by functional group (AI, Development, Review, Analysis, Testing, Planning, Writing, Communication, Operations, Domain-specific). Selected states with ring indicators.
- `AvatarSvg` — renders the full avatar with colored background; `AvatarPreview` renders icon-only for the picker grid. Both at 58% size with drop shadow, white color, stroke-width 1.8.
- `avatar-options.tsx` — 75+ role-specific Lucide icons, 12 preset colors, `ROLE_DEFAULT_ICONS` mapping (Code Reviewer → scan-eye, Software Engineer → code-2, etc.), `TEMPLATE_AVATARS` mapping soul template IDs to icon+color pairs, default avatar (sparkles + indigo).
- Profile selection dropdown on the Home page merges profile config into the session
- Org view page: animated grid with `staggerContainerSlow` cascading, status filter tabs (all, active, paused, archived), empty state with animated icon, profile count badges

## Template Gallery

`TemplateGallery` is a modal dialog for browsing assistant presets:

- Searchable grid filtered by category (`all`, `dev`, `writing`, `research`, `data`, `design`, `ops`)
- Clicking a template prefills `ChatInput` with its first starter prompt
- Built-in templates: Code Review, Documentation, Research, Analytics, Design, QA, DevOps

## Skill Selector

`SkillSelector` displays skills grouped by category with pinned skills at top:

- `SkillRow` sub-component for consistent display
- Supports skill `trigger` field for trigger key display
- Filter includes trigger text and name

## MCP Skills Picker (Profile Skill Restrictions)

`McpSkillsPicker` (`components/profiles/McpSkillsPicker.tsx`) provides the skill restriction UI for agent profiles, used in both `ProfileDialog`, `ProfileDetailTabs`, and the profile creation wizard (`ConfigureStep`).

| Feature                           | Detail                                                                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **All Allowed / Restrict toggle** | Controls `null` (all skills) vs `string[]` (restricted list). Toggling to "Restrict" initializes an empty array `[]`; toggling to "All Allowed" sets `null`                                                                                           |
| **Stale skill detection**         | Skills in the saved list but no longer installed are shown with a remove affordance and localized hint text                                                                                                                                           |
| **Flex layout**                   | The skills list uses `flex min-h-0 flex-1` to fill available vertical space in the Tools tab                                                                                                                                                          |
| **i18n**                          | All labels sourced from `t.profiles.*` keys (`skillsAllAllowed`, `skillsRestrict`, `skillsAllAllowedDesc`, `skillStaleRemove`, `skillsNoneInstalled`); skill template names are also localized (replaces the previous hardcoded `CATEGORY_SKILL_MAP`) |
| **Max concurrent tasks**          | The Tools tab also includes a max concurrent tasks input with a description line explaining queue behavior (`maxConcurrentTasksDesc`)                                                                                                                 |

The component is rendered in:

- `ToolsTabContent` — profile detail page Tools tab
- `ProfileDialog` — create/edit dialog
- `ConfigureStep` — wizard step 3

## Slash Command System

Typing `/` in `ChatInput` opens the `SlashCommandMenu` — a floating command palette anchored to the input field. The menu filters available commands as the user continues typing (e.g. `/summarize`, `/plan`, `/search`). Selecting a command either injects a prompt template into the input or triggers a direct action (such as switching agent mode).

Key integration points:

- `ChatInput` detects a leading `/` on each keystroke and renders `SlashCommandMenu` as an overlay.
- `SlashCommandMenu` receives the partial query string and a callback invoked on selection; it is fully keyboard-navigable (arrow keys + Enter/Escape).
- Commands are defined in a static registry (`src/config/slash-commands.ts`) and can be extended per-product via `branding.json`.
- The menu is dismissed automatically on blur, Escape, or when the leading `/` is removed.

## DesignMode Components

DesignMode lives under `components/design/` and is routed from `/design`.

| Component                    | Purpose                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `EntryView`                  | Split entry workspace with intent sidebar, gallery tabs, settings shortcut, and regular-mode exit           |
| `DesignEntrySidebar`         | Shared creative intent picker plus detailed new-project panel                                               |
| `EntryTabContent`            | Dispatches Designs, Examples, Design systems, Image templates, Video templates, Skills, and Routines tabs   |
| `GalleryFilters`             | Shared search/category/aspect/surface filter controls for gallery tabs                                      |
| `NewProjectPanel`            | Creates projects for document, image, video, audio, deck, prototype, template, campaign, and other surfaces |
| `DesignSystemPreviewModal`   | Shows design system Showcase, Tokens, DESIGN.md source, fullscreen, share, and default actions              |
| `PromptTemplatePreviewModal` | Loads full prompt template detail and creates image/video projects from templates                           |
| `SkillSourceModal`           | Shows DesignMode skill source and creates projects from skills                                              |
| `ProjectViewWorkflowHeader`  | Shared creative workflow header derived from DesignMode project state                                       |
| `ProjectView`                | Project header, brief drawer, composer, task progress, budget chip, resolved prompt, and debug drawer       |
| `FileWorkspace`              | Project file tree, asset gallery, and file viewer shell                                                     |
| `FileViewer`                 | Preview/source/comment/edit/draw modes, lint, save, target capture, and export drawer                       |
| `AssetGallery`               | Generated asset cards with version, compare, provenance, and open actions                                   |
| `ExportsDrawer`              | Export format selection, lint override handling, and generated export list                                  |

## Shared Creative Workbench Components

DesignMode and VideoMode share a small set of product-facing creative workflow
components under `components/creative/`.

| Component                  | Purpose                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `CreativeIntentEntry`      | First-run intent picker with prompt input for Design, Video, Image, Audio, templates, and import |
| `CreativeWorkflowHeader`   | Status header for Intent, Assets, Plan, Generate, Review, and Export steps                      |
| `CreativeAssetBrowser`     | Searchable asset browser shell with filters, view modes, and selected-count display              |
| `MediaGenerationWorkspace` | Shared prompt, reference, capability, and settings shell for image/video/audio generation         |
| `CreativeFlowViewer`       | Compact flow graph and execution ledger for project state and generated outputs                  |

The shared components are UI shells. Persisted project state still lives in the
owning DesignMode, VideoMode, or Assets Catalog models, with display read models
derived through `src/shared/creative-workflow/`.

DesignMode components follow the same i18n and theme rules as the rest of the frontend:
all user-facing labels come from `t.design`/`t.settings`, and visual styling uses semantic
theme tokens instead of fixed colors.

## Permission & Sub-Agent Components

| Component            | Location                                          | Purpose                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PermissionDialog`   | `components/task/PermissionDialog.tsx`            | Displays tool permission requests with risk-level badges (low=green, medium=amber, high=red), tool name, command snippet (truncated at 150 chars), and three response buttons: Deny, Allow Once, Always Allow. Resolved state shows decision icon. Uses `role="alertdialog"` for accessibility.                  |
| `SubAgentPanel`      | `components/task/SubAgentPanel.tsx`               | Expandable panel showing live sub-agent lifecycle. Summary header with count + running indicator. Per-agent rows with status dot (color-coded), name, live spinner, duration, token count, and cancel button. Returns null when no sub-agents exist.                                                             |
| `RateLimitIndicator` | `components/task/RateLimitIndicator.tsx`          | Displays remaining quota, percentage used with color coding (green → amber → red), time until reset, and budget severity levels.                                                                                                                                                                                 |
| `PermissionSettings` | `components/settings/tabs/PermissionSettings.tsx` | Settings tab for configuring tool permission rules. Three editable rule categories: alwaysAllow, alwaysDeny, alwaysAsk. Autocomplete dropdown with built-in tool suggestions. Supports pattern matching with wildcards (e.g. `"Bash(npm test)"`, `"mcp__*"`). Default allowed tools pre-populated for new users. |
| `HookSettings`       | `components/settings/tabs/HookSettings.tsx`       | Settings tab for configuring tool lifecycle hooks. Supports two hook events: PreToolUse, PostToolUse. Four hook types: command, http, prompt, agent. Pattern matcher field (regex), type-specific fields (command vs URL), and timeout configuration. Hooks stored in DB as nested JSON.                         |

## Channel and Advanced Settings

| Component            | Location                                                  | Purpose                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ChannelSettings`    | `components/settings/tabs/ChannelSettings.tsx`            | Channels tab shell. Manages multi-bot configs through `/channels/configs`, shows per-platform sections for Telegram, Lark/Feishu, Discord, and Slack, and embeds gateway adapter/routing-rule controls. |
| `GatewayChannelList` | `components/settings/tabs/channel/GatewayChannelList.tsx` | Registry-backed gateway adapter list. Calls `GET /channels/`, toggles persisted enablement with `/channels/:id/enable                                                                                   | disable`, and marks adapters for restart via `/channels/:id/reconnect`. |
| `RoutingRulesTable`  | `components/settings/tabs/channel/RoutingRulesTable.tsx`  | Inline CRUD editor for `routing_rules`. Supports editable priority/workspace/pattern cells, channel/intent/profile selects, create, delete confirmation, and localized empty/loading states.            |
| `AdvancedSettings`   | `components/settings/tabs/AdvancedSettings.tsx`           | Desktop-only daemon supervisor UI. Calls Tauri `daemon_*` commands to install/uninstall the background daemon, kickstart it, refresh status, and tail sidecar logs.                                     |

## AG-UI V2 Task Components

The V2 task view uses the AG-UI protocol with CopilotKit V2 runtime for standards-based agent streaming.

| Component              | Location                                   | Purpose                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskDetailV2`         | `app/pages/TaskDetailV2.tsx`               | V2 task page — wraps thread in `AgUiProvider` with CopilotKit                                                                                                                                         |
| `TaskV2Thread`         | `components/task/TaskV2Thread.tsx`         | Main thread view using CopilotKit `useAgent()`; wires all V2 hooks (useThreadSync, usePlanInterrupt, useRunError, usePostRunEffects, useBranchActions); injects `branch-nav` items at fork points     |
| `GroupedMessageList`   | `components/task/GroupedMessageList.tsx`   | Groups consecutive tool-call-only assistant messages into collapsible `ToolCallGroup` blocks; defines `GroupedItem` union including `branch-nav` type; dispatches to `BranchNavigator` at fork points |
| `TaskV2MessageBubble`  | `components/task/TaskV2MessageBubble.tsx`  | V2 message rendering with markdown and tool call display                                                                                                                                              |
| `TaskV2ToolCallGroup`  | `components/task/TaskV2ToolCallGroup.tsx`  | Collapsible group for consecutive tool calls                                                                                                                                                          |
| `TaskV2ToolCallItems`  | `components/task/TaskV2ToolCallItems.tsx`  | Individual tool call display with input/output                                                                                                                                                        |
| `InlineQuestionCard`   | `components/task/InlineQuestionCard.tsx`   | Renders `AskUserQuestion` tool calls as interactive multi-choice cards                                                                                                                                |
| `PlanInterruptCard`    | `components/task/PlanInterruptCard.tsx`    | Plan approval card using CopilotKit's `useInterrupt` hook; renders steps as ordered list with approve/reject                                                                                          |
| `RunErrorBubble`       | `components/task/RunErrorBubble.tsx`       | Error display for AG-UI run errors                                                                                                                                                                    |
| `InitialMessageSender` | `components/task/InitialMessageSender.tsx` | Two-phase initialization: creates task in DB, then sends initial prompt via CopilotKit                                                                                                                |

## Shared Chat Panel Components

`components/shared/chat-panel/` is the reusable chat rendering layer for
mode-specific agent surfaces. It owns the normalized message shape, AG-UI event
adapter, generic bubbles, question cards, tool activity groups, and GenUI card
renderers. Task V2 can keep its virtualized thread shell, while DesignMode and
VideoMode can reuse the same lower-level renderer pieces.

| Component / module       | Purpose                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `ChatPanel`              | Compound shell for header, message list, composer, empty state, and surface-owned slots  |
| `ChatPanelMessageView`   | Switches normalized messages into text, tool, question, action, surface, lifecycle, and state rows |
| `MessageBubble`          | Shared user, assistant, system, and reasoning bubble chrome                              |
| `QuestionFormCard`       | Interactive question form used for `AskUserQuestion`-style follow-up prompts             |
| `ToolActivityGroup`      | Collapsible grouped tool call display with status counts and result previews             |
| `GenUIRenderer`          | Allowlisted GenUI card renderer for media, files, links, status cards, and tables        |
| `GenUITableCard`         | Scroll-safe table renderer used by `GenUIRenderer`                                       |
| `agui-adapter.ts`        | Normalizes AG-UI event streams into `ChatPanelMessage[]`                                 |
| `types.ts`               | Shared message unions and extras for task, video, and design chat surfaces               |

`ChatPanelMessage` supports `text`, `tool`, `question`, `action`, `surface`,
`lifecycle`, and `state` records. Canonical AG-UI events with `kind` values
`"agent.message"`, `"tool_call"`, `"ui.surface_requested"`,
`"ui.surface_responded"`, `"run.lifecycle"`, and `"state_update"` are reduced
into those message variants by `agui-adapter.ts`.

GenUI is intentionally shared here rather than under `components/task/`. Legacy
task imports re-export the shared renderer, Design chat uses it for assistant
turns, and tool result summaries use it before falling back to JSON previews.

## Artifacts V2 — Live Preview Components

The Artifacts V2 system provides streaming, event-sourced artifact rendering directly in chat bubbles and a dedicated side panel. Gated by the `artifactsV2` setting flag.

**Data path:** Backend emits structured `artifact.*` events → `taskEventBus` → SSE → client `isArtifactEvent()` guard → `applyArtifactEvent()` reducer → `ArtifactMap` → `useLiveArtifacts()` → `LiveArtifactPanel` routes by `ArtifactKind`.

### Wire protocol types (`src/shared/types/artifact.ts`)

| Type               | Description                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `ArtifactKind`     | `'html' \| 'svg' \| 'react' \| 'mermaid' \| 'chart' \| 'code' \| 'markdown'`                                       |
| `ArtifactSnapshot` | `{ id, taskId, messageId, kind, title, version, content, language?, createdAt, updatedAt }`                        |
| `ArtifactEvent`    | Discriminated union: `artifact.create`, `artifact.append`, `artifact.replace`, `artifact.patch`, `artifact.delete` |
| `DiffPatch`        | `{ op: 'eq' \| 'ins' \| 'del', text }` — diff-match-patch style full-document walk                                 |

**Versioning rules (enforced by `src/shared/artifacts/reducer.ts`):**

- `artifact.create` — accepted only if `incoming.version > existing.version`
- `artifact.append` — requires `event.version === existing.version + 1`
- `artifact.replace` — requires `event.version > existing.version`
- `artifact.patch` — requires `version === existing + 1`; eq/del ops must match content at cursor; total size capped at `MAX_ARTIFACT_BYTES` (4 MiB)
- Out-of-order events are silently dropped; no queue or replay

### Live panel and renderers (`src/components/artifacts/live/`)

| Component            | Purpose                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LiveArtifactPanel`  | Shell; drives `useLiveArtifacts(taskId, isRunning)`; renders nothing when map empty; auto-selects newest artifact; tab strip for 2+ artifacts; routes by `ArtifactKind` |
| `HtmlSandbox`        | DOMPurify-sanitizes HTML (blocks event-handler attrs); wraps via `wrapHtmlSrcdoc` (nonce + CSP); defers updates with `useDeferredValue`; renders via `IframeSandbox`    |
| `IframeSandbox`      | Low-level `srcdoc` iframe; keyed by `identity` for hard-remount; nonce stable per instance via `useRef`                                                                 |
| `SvgSandbox`         | SVG artifact in a sandboxed container                                                                                                                                   |
| `MermaidArtifact`    | Thin adapter: `source` → `MermaidView`                                                                                                                                  |
| `MarkdownArtifact`   | Markdown artifact via `Streamdown`                                                                                                                                      |
| `CodeArtifact`       | Builds fenced code block string → `Streamdown` with `STREAMDOWN_CODE_PLUGINS` for syntax highlighting                                                                   |
| `InlineFileRenderer` | Renders workspace files mentioned by the agent inline in chat (image, SVG, markdown, HTML, text/code) when `artifactsV2` is enabled                                     |

**`RENDERERS` map (kind → component):**

| Kind                                         | Status                    |
| -------------------------------------------- | ------------------------- |
| `html`, `svg`, `mermaid`, `markdown`, `code` | Live                      |
| `react`, `chart`                             | Placeholder — future work |

### Server-side publishing (`src-api/src/shared/services/artifact-events.ts`)

`publishArtifactEvent(taskId, event)` Zod-validates then calls `taskEventBus.publish()`. Convenience wrappers: `publishArtifactCreate`, `publishArtifactAppend`, `publishArtifactReplace`, `publishArtifactPatch`, `publishArtifactDelete`. Invalid events are logged and dropped.

## Run Tree View

`RunTreeView` (`components/task/RunTreeView.tsx`) shows a persistent, DB-backed hierarchy of agent runs for a task. Unlike `SubAgentPanel` (live-only), the run tree survives page refresh and shows historical fan-out.

**Data source:** `run-tree-store` (Zustand + immer) fetches `GET /runs/:taskId/tree`. Caches with a 2-second freshness window (`STALE_AFTER_MS`) to prevent StrictMode double-fetch races; deduplicates in-flight requests per task; retains prior tree while loading to minimize flicker.

**UI:**

- Renders nothing when the store has no tree for the task.
- Header shows run count and a rollup: total cost, total tokens in/out, and a spinner with running count when runs are in-progress.
- Per node: provider + optional model, status dot (amber=running, green=completed, red=failed, gray=unknown), cost and token ↑↓ counts, expand/collapse chevron.
- Running nodes default to expanded; expanded nodes show error text when present.
- Children indented recursively for nested sub-runs.

**Store types (`src/shared/stores/run-tree-store.ts`):** `RunTreeNode` (hierarchical with `children[]`), `RunTreeRollup` (`totalCost`, `totalTokensIn`, `totalTokensOut`, `runCount`, `runningCount`, `failedCount`), `fetch(taskId)` / `clear(taskId)`.

## Conversation Branching Components

The V2 task view supports conversation branching (edit, regenerate, fork) with inline navigation.

| Component           | Location                                 | Purpose                                                                                                                                                         |
| ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UserMessageBubble` | `components/task/GroupedMessageList.tsx` | User message display with hover-to-edit: inline textarea with Cmd/Ctrl+Enter save. Calls `onEditMessage(messageId, trimmedText)` which triggers branch creation |
| `MessageToolbar`    | `components/task/GroupedMessageList.tsx` | Toolbar on assistant messages with regenerate (`RefreshCw` icon), fork (`GitBranch` icon), copy, and feedback actions                                           |
| `BranchNavigator`   | `components/task/BranchNavigator.tsx`    | Compact inline navigation at fork points — shows `current/total` with prev/next arrows                                                                          |
| `BranchIndicator`   | `components/task/BranchIndicator.tsx`    | Dropdown pattern for branch list (present but not currently used by the main thread view)                                                                       |

**Branch-nav injection:** `TaskV2Thread` checks `branchState.branchMeta` for each message and injects synthetic `GroupedItem` entries of type `'branch-nav'` at fork points. These render as `BranchNavigator` rows between message bubbles.

**Flow overview:**

1. **Edit** — pencil icon on user message → inline textarea → `handleEditMessage` → new branch + re-run
2. **Regenerate** — refresh icon on assistant message → `handleRegenerate` → delete tail on current branch + re-run
3. **Fork** — git-branch icon on assistant message → `handleForkFromHere` → new branch (user continues manually)
4. **Navigate** — `BranchNavigator` arrows → `handleBranchNavigate` → switch visible path at fork point

## ChatInput Decomposition

The `ChatInput` component has been decomposed from a monolithic file into focused sub-components:

| Component / Hook         | Location                                       | Purpose                                                                                                      |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ChatInput`              | `components/shared/ChatInput.tsx`              | Orchestrator — coordinates child components, handles props mapping                                           |
| `ChatInput.types.ts`     | `components/shared/ChatInput.types.ts`         | Central types (`ModelOption`, `ChatInputProps`, `Attachment`), model option builders, file utilities         |
| `ChatInputActions`       | `components/shared/ChatInputActions.tsx`       | Bottom action bar — add files, folder picker, MCP selector, skill selector, model selector, mic, submit/stop |
| `ChatInputAttachments`   | `components/shared/ChatInputAttachments.tsx`   | Attachment management — video frame extraction (client + server fallback), thumbnails, removable chips       |
| `ChatInputChips`         | `components/shared/ChatInputChips.tsx`         | Animated badge strips for selected MCP servers and pinned skills                                             |
| `ChatInputModelSelector` | `components/shared/ChatInputModelSelector.tsx` | Model dropdown grouped by provider with active selection checkmark                                           |
| `CloudStorageAssetPicker` | `components/shared/CloudStorageAssetPicker.tsx` | Full-screen cloud media picker launched from the ChatInput **Cloud media** action; supports connection switching, search, filters, preview, selection, and folder expansion |
| `CloudStoragePickerControls` | `components/shared/CloudStoragePickerControls.tsx` | Connection, search, media-kind, license, folder, and Immich advanced-filter controls for the picker |
| `CloudStorageMediaPreviewDialog` | `components/shared/CloudStorageMediaPreviewDialog.tsx` | Metadata preview for selected cloud media before attaching |
| `useChatInputFiles`      | `components/shared/useChatInputFiles.ts`       | File handling hook — browser picker, clipboard paste, Tauri native drop, folder permission flow              |
| `useChatInputState`      | `components/shared/useChatInputState.ts`       | Stateful logic — MCP server selection, skill pinning, model selection, speech integration, slash commands    |
| `useCloudStorageAttachment` | `components/shared/useCloudStorageAttachment.ts` | Downloads selected cloud-storage items as `File` objects and appends stock attribution text to the prompt |

## Library Page Components

The Library page has been refactored with extracted sub-components:

| Component             | Location                                     | Purpose                                                                                                               |
| --------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `LibraryToolbar`      | `components/library/LibraryToolbar.tsx`      | Search with debounce, filter chips (all/running/completed/error/favorites), sort dropdown, select action bar          |
| `LibraryTaskRow`      | `components/library/LibraryTaskRow.tsx`      | Task row with always-visible checkbox, status icon, metadata (title, favorite, folder, cost, duration, relative time) |
| `LibraryDeleteDialog` | `components/library/LibraryDeleteDialog.tsx` | Batch delete confirmation with option to delete associated task folders                                               |
| `library-utils.ts`    | `components/library/library-utils.ts`        | Utilities: `formatRelativeTime`, `formatCost`, `formatDuration`, `getStatusConfig`                                    |
| `CloudStorageLibraryTab` | `components/library/CloudStorageLibraryTab.tsx` | Library tab for connected cloud storage, self-hosted media, and stock catalogs; switches connections, searches, filters, and opens previews |
| `MediaGridView` | `components/library/MediaGridView.tsx` | Responsive media grid with selection/preview affordances for image, video, audio, document, and folder items |
| `MediaTimelineView` | `components/library/MediaTimelineView.tsx` | Timeline layout and infinite-load surface for media with capture dates |
| `CloudStorageMediaLightbox` | `components/library/CloudStorageMediaLightbox.tsx` | Fullscreen preview with source link, metadata, favorite/delete actions when supported |
| `CloudStorageSearchOptionsDialog` | `components/library/CloudStorageSearchOptionsDialog.tsx` | Immich advanced search filters: search mode, place, camera, date, media type, album/archive/favorite state |
| `LicenseFilter` / `AttributionChip` | `components/library/LicenseFilter.tsx`, `AttributionChip.tsx` | Stock catalog license filters and attribution rendering |

## Speech Components

| Component             | Location                                      | Purpose                                                                                                                                                                                                                                   |
| --------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SpeechSettings`      | `components/settings/tabs/SpeechSettings.tsx` | Settings tab for configuring TTS and STT: provider selection, voice picker, local model download/status, test playback                                                                                                                    |
| `MessageAudioButton`  | `components/shared/MessageAudioButton.tsx`    | Per-message TTS playback button; renders on assistant messages, uses `useSpeech` to synthesize and play back message text                                                                                                                 |
| `ChatInput` (updated) | `components/shared/ChatInput.tsx`             | Voice input button added; toggles push-to-talk recording via `useSpeech.startListening` / `stopListening`, injects final transcript into the input field. Enabled during agent runs with combined send + stop buttons for mid-run replies |

The `SpeechSettings` tab is registered in `SettingsModal.tsx` under the `speech` tab key (added to `constants.tsx`).

## Budget & Cost Control Components

| Component                 | Location                                      | Purpose                                                                                                                                                                     |
| ------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BudgetBanner`            | `components/home/BudgetBanner.tsx`            | Dismissible alert banner shown at the top of the Home page when any budget policy is in alert or blocked state; pulls from `GET /budget/status`; auto-polls every 5 minutes |
| `BudgetPolicies`          | `components/settings/tabs/BudgetPolicies.tsx` | Settings tab for managing budget policies — create/edit/delete rules by scope, period, and spend limit with tiered alert thresholds                                         |
| `UsageSettings` (updated) | `components/settings/tabs/UsageSettings.tsx`  | Usage tab now includes `BudgetPolicies` as a sub-section alongside token usage charts                                                                                       |

`BudgetBanner` uses alert level colors: yellow for `soft` (≥75%), orange for `urgent` (≥90%), red for `blocked` (≥100%).

## Parallel Task Dashboard

`ParallelTaskDashboard` renders on the Home page when **multiple tasks are running** or
**any tasks are queued** (per `useGlobalQueueStats()`).

| Aspect            | Detail                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Visibility**    | Renders only when `runningTasks.length > 1` or `queuedCount > 0`                                                                 |
| **Data sources**  | `useGlobalQueueStats()` (polls `GET /agent/queue/status` every 5s) + local DB `getAllTasks()` filtered by `status === 'running'` |
| **Running cards** | Title/prompt, cost, elapsed time, Navigate to `/task-v2/:id`, Stop via `POST /agent/stop/:sessionId`                             |
| **Queue counts**  | Shows `totalQueued` / `totalRunning` from global stats                                                                           |
| **Polling**       | Refreshes local tasks every 5s only when the strip is visible                                                                    |

## Workspace Panel

The `WorkspacePanel` is a tabbed right-hand workspace area on the V2 task page with four modes:

| Tab         | Component                  | Purpose                                                                                                                              |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Preview** | `WorkspaceRouter`          | Artifact preview with version history, live Vite preview, inline reply                                                               |
| **Files**   | `WorkspaceFileTree`        | Directory tree of the task's `workDir` (depth 3) via `POST /files/readdir`; expand/collapse folders, refresh button, file-type icons |
| **Diff**    | `WorkspaceDiffView` (lazy) | Renders file patches with `diff` + `diff2html`; side-by-side vs line-by-line toggle; multi-file dropdown                             |
| **Trace**   | `TraceViewer`              | Operation timeline with metrics (see below)                                                                                          |

**Mode auto-switching:** When an artifact is selected (`props.artifact` becomes non-null), a `useEffect` automatically switches the active mode to `'preview'`. The initial mode defaults to `'preview'` if an artifact is provided, otherwise `'files'`.

The panel sits in the resizable preview column next to the chat on `/task-v2/:taskId`.

### MediaWorkspace

`MediaWorkspace` (`components/workspace/media/MediaWorkspace.tsx`) is the full workspace renderer for video, audio, and image artifacts. It is routed to by `WorkspaceRouter` when the artifact type is a media type.

| Feature             | Detail                                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Media loading**   | Resolves file paths via `resolveMediaPath()`, streams video/audio directly (no memory bloat), loads images as blob URLs                                                                                                                                |
| **Size guard**      | Non-streamable types (images) are checked against `MAX_PREVIEW_SIZE`; oversized files render `FileTooLarge` with an "open external" button                                                                                                             |
| **Comparison mode** | When 2+ versions exist, a `ComparisonSlider` overlays the previous version against the current using a draggable split                                                                                                                                 |
| **Version history** | `VersionStrip` renders a scrollable strip of 64x64 thumbnail buttons at the bottom, each with a version number badge and (for v1) an "orig" label. Active version auto-scrolls into view. Tooltips show the generation prompt (truncated to 100 chars) |
| **Header toolbar**  | Auto-play toggle (audio/video only), compare toggle, download (Tauri `copyFile` with fallback), open external, copy path, fullscreen toggle, close                                                                                                     |
| **Inline reply**    | When `onSendMessage` is provided, a text input at the bottom allows quick edit prompts (Enter to send, disabled while agent is running)                                                                                                                |
| **Fullscreen**      | Toggles a fixed inset overlay; Escape exits comparison mode first, then fullscreen                                                                                                                                                                     |

## Trace Viewer

The trace viewer provides a real-time operation timeline for agent runs.

| Component             | Location                                        | Purpose                                                                                                                                              |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TraceViewer`         | `components/task/trace/TraceViewer.tsx`         | Container: prefers persisted trace events, falls back to `useTraceStream`, renders metrics summary + filters + timeline                              |
| `TraceMetricsSummary` | `components/task/trace/TraceMetricsSummary.tsx` | Top strip showing total duration, input/output tokens, total cost, and either cache stats (read/write) or operation count; pulse animation when live |
| `TraceTimeline`       | `components/task/trace/TraceTimeline.tsx`       | Virtualized list (`react-virtuoso`) of trace entries with `followOutput: 'auto'` when live                                                           |
| `persisted-adapter`   | `components/task/trace/persisted-adapter.ts`    | Converts backend `PersistedTraceEvent` rows into `TraceEntry` and `TraceSummary`                                                                     |

**Data source:** `TraceViewer` receives `taskId`, `messages`, and `isRunning`. When a task id is available, `useTaskTraceEvents(taskId, isRunning)` loads persisted rows from `/observability/tasks/:id/trace` and subscribes to `/observability/tasks/:id/trace/subscribe`. Persisted rows are de-duplicated and adapted through `persisted-adapter.ts`. If no persisted rows exist, the viewer falls back to `useTraceStream(messages, isRunning)`.

During fallback live runs, a 500ms tick updates in-flight durations for open tool spans. During persisted live runs, backend `trace.event` SSE messages drive the updates.

**Filtering:** 6 filter types with color-coded pills, each showing a count from `summary.byType`:

| Filter     | Color           | Icon          |
| ---------- | --------------- | ------------- |
| `llm`      | `bg-blue-500`   | `Bot`         |
| `tool`     | `bg-orange-500` | `Cpu`         |
| `thinking` | `bg-purple-500` | `Lightbulb`   |
| `user`     | `bg-gray-400`   | `User`        |
| `error`    | `bg-red-500`    | `CircleAlert` |
| `plan`     | `bg-indigo-500` | `Workflow`    |

All filters start active. Toggling a filter off is blocked when only one remains active (the "at least one active" constraint). The `filteredEntries` array and `maxDuration` are recomputed via `useMemo` when filters change.

**Timeline rows:** Each `TraceRowWithState` owns its own expanded state (avoids full-list re-renders on toggle). Rows show type icon/color, name, relative duration bar, duration text (ms/s), optional token and cost badges, running/error indicators. Expandable rows display tool input, tool output, or content in `<pre>` blocks with optional model info.

## File Diff Viewer

| Component        | Location                             | Purpose                                                                                                                                                      |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FileDiffViewer` | `components/task/FileDiffViewer.tsx` | Shows a side-by-side or unified diff of a file snapshot using `diff` + `diff2html`; fetches snapshot content from `GET /files/snapshots/:taskId/:snapshotId` |

`FileDiffViewer` is rendered inside the RightSidebar when a file snapshot is selected from the Changes section. Supports syntax-highlighted unified and split diff views.

## Document Panel

| Component             | Location                            | Purpose                                                                                                                                             |
| --------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DocumentPanel`       | `components/task/DocumentPanel.tsx` | Tabbed panel for task-level documents (Plan, Notes, Design, Custom); inline edit mode with title input and textarea; version badge + history drawer |
| `DocEditor` (sub)     | inside `DocumentPanel.tsx`          | Per-tab editor that fetches `GET /tasks/:taskId/documents/:key`, saves via `POST`, and shows current version metadata                               |
| `HistoryDrawer` (sub) | inside `DocumentPanel.tsx`          | Collapsible list of historical versions fetched from `GET /tasks/:taskId/documents/:key/history`; one-click restore pre-fills the editor            |

`DocumentPanel` is mounted in `RightSidebar` as a collapsible section (section 6, after Changes). The `key` prop includes `taskId + activeDocKey + version` to force remount on tab switch and after saves.

## Automation Enhancements

| Component                          | Location                                              | Purpose                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AutomationTemplateGallery`        | `components/automation/AutomationTemplateGallery.tsx` | Gallery of 7 quick-start automation templates (Daily Standup, Weekly Report, PR Digest, Tech News, Email Digest, Research Alert, Webhook); each card pre-fills the create dialog via `onSelect(preset)` |
| `CronExpressionInput` (updated)    | `components/automation/CronExpressionInput.tsx`       | Enhanced cron editor: `cronstrue` for human-readable description, `cron-parser` for next-run preview (next 3 executions shown inline)                                                                   |
| `AutomationCreateDialog` (updated) | `components/automation/AutomationCreateDialog.tsx`    | Accepts `initialValues?: Partial<CreateAutomationInput>` to support pre-filling from a template selection; shows the gallery when no `initialValues` are provided                                       |

## Provider Model Settings

| Component           | Location                                               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModelSettings`     | `components/settings/tabs/ModelSettings.tsx`           | Settings tab for configuring model overrides per agent provider; includes a "Fetch Models" button that calls `POST /providers/models` to retrieve live model list from the configured API endpoint; provider connectivity test (latency + model round-trip); per-task-type model assignments (planning, execution, titleGeneration, research, codeReview) with tier recommendations (frontier / balanced / fast); and inline model pricing panel per model |
| `ModelPricingPanel` | `components/settings/components/ModelPricingPanel.tsx` | Inline panel nested under each model row in `ModelSettings`; displays billing type badge (`api` / `subscription` / `free`) and per-million-token input/output prices; edit form updates via `PUT /usage/pricing/:modelId`; creates a new pricing record on first save via `POST /usage/pricing`                                                                                                                                                            |

## Usage Dashboard Components

| Component                 | Location                                                  | Purpose                                                                                                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UsageSettings` (updated) | `components/settings/tabs/UsageSettings.tsx`              | Top-level usage tab — chart/table view toggle, source filter (`all`/`desktop`/`channel`), date range picker, clear-all-logs button with confirmation dialog; chart view renders daily + model bar charts and pie charts side-by-side; table view has sub-tabs (logs, providers, models, tools, safety, budget) |
| `UsagePieCharts`          | `components/settings/components/usage/UsagePieCharts.tsx` | Side-by-side pie charts for usage distribution by call type and by model share, using Recharts `PieChart`; respects time range and source filter                                                                                                                                                               |
| `CostPanel`               | `components/dashboard/CostPanel.tsx`                      | Dashboard cost surface backed by `/observability/cost`; supports 7d/30d/90d ranges and provider/model/day grouping; displays total cost, tokens, calls, source label, and proportional bars                                                                                                                    |

## Profile Creation Wizard

New profiles are created via a 4-step wizard rendered by `ProfileDetailPage` when `routeId === 'new'`:

| Component            | Location                                          | Purpose                                                                                                                                                       |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProfileWizard`      | `components/profiles/wizard/ProfileWizard.tsx`    | 4-step wizard container with step indicator, animated slide transitions, and state management. Fetches soul from template API and stores in form for editing. |
| `TemplateStep`       | `components/quickstart/TemplateStep.tsx`          | Step 1: browse and select from pre-built soul templates or choose custom                                                                                      |
| `PersonalizeStep`    | `components/profiles/wizard/PersonalizeStep.tsx`  | Step 2: name, avatar, role, description, system prompt                                                                                                        |
| `ConfigureStep`      | `components/profiles/wizard/ConfigureStep.tsx`    | Step 3: runtime, model, thinking config, soul editor, MCP servers, skills, max concurrent tasks                                                               |
| `WizardSoulEditor`   | `components/profiles/wizard/WizardSoulEditor.tsx` | Collapsible soul editor with 4 sub-tabs (Identity, Voice, Cognition, Boundaries) reusing existing soul tab components                                         |
| `ReviewStep`         | `components/profiles/wizard/ReviewStep.tsx`       | Step 4: read-only summary card with soul preview, edit-back links, and "Create Profile" button                                                                |
| `SoulTemplatePicker` | `components/profiles/SoulTemplatePicker.tsx`      | Modal for applying soul templates to existing profiles                                                                                                        |

When a template is selected, the wizard fetches the full soul via `GET /soul/templates/:id` and stores it in `form.soul` for editing in the Configure step. On creation, the profile is POSTed with the soul already in the payload — no separate `/apply` call is needed. Templates include multilingual name/description, embedded soul definitions, default skills, icon, and greeting examples. Avatar integration via `TEMPLATE_AVATARS` and `DEFAULT_AVATAR`. "Custom" template option for manual creation. Skip at any step to create default "General Helper".

## Animation System

Centralized animation system in `src/config/animation/` providing 40+ reusable Motion for React variants. All animations use GPU-accelerated properties only (`transform` and `opacity`) for smooth 60fps performance.

**Constants** (`constants.ts`): Durations (instant 0.1s → dramatic 0.7s), easing curves (default, out, in, bounce, sharp), spring presets (gentle, default, snappy, bouncy), stagger delays (fast 0.03s → dramatic 0.12s), distance offsets, scale values.

**Variants** (`variants.ts`):

| Category    | Variants                                                           | Usage                         |
| ----------- | ------------------------------------------------------------------ | ----------------------------- |
| Fade        | `fadeIn`, `fadeScale`                                              | Modals, dialogs               |
| Slide       | `slideUp`, `slideDown`, `slideLeft`, `slideRight`                  | Messages, panels, dropdowns   |
| Page        | `pageEnter`, `heroEnter`                                           | Main content, hero elements   |
| List        | `staggerContainer`, `staggerContainerSlow/Fast`, `listItem`        | Card grids, tool lists        |
| Interactive | `cardHover`, `buttonTap`                                           | Hover lift, press feedback    |
| Agent       | `planEnter`, `planStepComplete`, `attentionPulse`, `toolItemEnter` | Plan approval, tool execution |
| Overlay     | `backdrop`, `modalEnter`                                           | Modal backgrounds             |
| Status      | `notificationEnter`, `statusBadge`, `scrollButton`                 | Notifications, badges         |

## Workspace Migration UI

| Component                     | Location                                         | Purpose                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkplaceSettings` (updated) | `components/settings/tabs/WorkplaceSettings.tsx` | Workspace directory management with two-phase migration: immediate settings apply, then optional SSE-streamed session copy. Shows session stats (count + size) before prompting, progress bar during copy, and result summary on completion. Uses `useMigrateWorkspace` hook. |
| `SoulSection` (extracted)     | `components/profiles/SoulSection.tsx`            | Extracted from ProfileDialog. Manages soul editing and template picking via nested dialogs. Lazy-loads evolution data (corrections/learnings) only when the editor opens.                                                                                                     |

**Migration progress bar:** `WorkplaceSettings` tracks `MigrationProgress` from the `useMigrateWorkspace` hook, rendering a progress bar with `percent`, `copied/total` counts, and the current folder name during the `copy` phase. The `phase` field cycles through `scan` → `copy` → `db` → `done`.

**Unmigrated sessions banner:** On mount (and when `workDir` changes), `WorkplaceSettings` auto-detects unmigrated sessions by calling `getSessionStats(appDataDir)`. If sessions exist in the old location, a `pendingMigration` state is set with `sourceDir`, `sessionCount`, and `totalMB`, which renders an alert banner prompting the user to migrate.

## Search Settings

| Component        | Location                                           | Purpose                                                                                                                                                                                                                                 |
| ---------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SearchSettings` | `components/settings/tabs/SearchSettings.tsx`      | Settings tab for configuring multi-provider web search: master toggle, mode selector (auto/always/manual), sortable provider list with priority, general settings (max results, timeout, cache TTL, safe search), and test search input |
| `ProviderCard`   | `components/settings/tabs/search/ProviderCard.tsx` | Per-provider card with name, description (i18n), enable toggle, priority arrows, API key input, base URL, extra config fields, and "No API key required" badge for key-free providers                                                   |

The `SearchSettings` tab is registered in `SettingsModal.tsx` under the `search` tab key. It supports 13 providers across categories: AI-native, SERP, academic, privacy, Chinese, and self-hosted.

---

_See also: [Frontend Overview](index.md) · [State Management](state-management.md) · [i18n & Theming](i18n-and-theming.md) · [Hooks & Utilities](hooks.md) · [Speech System](../backend/speech.md) · [Web Search Service](../backend/search.md)_
