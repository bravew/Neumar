# 01: Research

Everything in this doc was observed on 2026-09-30 by using muse.ai in Chrome (a
signed-in account, used read-only: no messages sent and no settings changed) and the
local Neumar build at `http://localhost:3420/`. Personal content visible in the muse.ai
account is intentionally left out.

## 1. muse.ai teardown

muse.ai is Meta's personal AI agent, announced 2026-09-08 for iOS, Android, and
the web in the US. Its model is to message it
like a person, connect apps, and let it act, checking in before sensitive steps. It
passed 3.4M downloads in a few weeks, and early reviews singled out its polished,
simple design.

### 1.1 Shell and navigation

```
┌──┬────────────┬──────────────────────────────────────────┐
│ ◉│ 🔍 Search ⋯│                                  [Invite]│
│  │ Main chat  │          (conversation column,          │
│  │ Side chats+│           ~600 px, centered)            │
│💬│  • Goal…  ●│                                          │
│🔍│            │                                          │
│📰│            │                                          │
│💡│            │                                          │
│☑ │            │                                          │
│▦ │            │       [ + Message …            🎤 ]      │
│  │            │                                          │
│⬇ │            │                                          │
│≡ │            │                                          │
└──┴────────────┴──────────────────────────────────────────┘
 rail  context panel            page
```

- **Icon rail (about 56 px)** with six destinations: Chat, Search, Feed, Ideas, Goals,
  Library. Hover shows a tooltip, and the active item gets a filled pill. The top holds
  the agent's avatar. The bottom holds *Download apps* and a **≡ menu** containing
  Keyboard shortcuts, Download apps, Report an issue, and Settings (⌘,).
- **Context panel.** Content depends on the rail item: the chat list for Chat and
  Artifacts/Media categories for Library. Pages that don't need a list (Ideas, Goals,
  Feed) hide it and use the full width.
- **Chat is always reachable.** A panel toggle next to the avatar docks the *Chats*
  panel on the left of any page, so conversation continues while the user browses
  Ideas or the Library. Each Feed post has a **Discuss** action that opens chat with
  that item as context.
- **One main chat plus named side chats.** The main thread is continuous, and a goal
  gets its own side chat marked with an unread dot. There is no "New conversation"
  sprawl.
- **Search (⌘K)** is a floating palette that opens with Recents already listed, so it
  works before the user types anything.
- **Shortcuts are few and memorable:** ⌘. opens or closes all panels, ⌘B steps
  through side-panel states, ⌘J chats, ⌘K searches, ⇧⌘K searches in the current chat,
  ⌘, opens settings, ⌘/ shows shortcuts, `/` runs slash commands, ⇧Esc focuses the
  composer, and ⇧⌘D starts dictation.

### 1.2 Surfaces

- **Ideas.** A gallery of capabilities phrased as *outcomes in the user's voice*, each
  with a one-line promise and one sentence of how it works, grouped under headings
  (Health & Fitness, Productivity…). Each item's `⋯` menu offers **Let's do it**,
  **More like this**, and **Not interested**. It is a feature catalog that reads like
  advice.
- **Goals.** *Tracking* (recurring or scheduled items) above *Goals* (long-running
  objectives), then **Create a goal** with 7 life categories. This is how automations
  are presented to non-technical users.
- **Library.** *Artifacts* (All, Documents, Web artifacts) and *Media* (Images, Videos,
  Podcasts), plus *System files* pinned at the bottom. A single primary action
  (**Create an artifact**) sits top right, with a **Select** mode for bulk actions.
  Empty state: one icon and "No artifacts yet".
- **Feed.** An AI-written digest with an editable *feed prompt* shown at the top: the
  controlling instruction is visible and editable where it takes effect.

### 1.3 Settings

A **centered modal** of about 650×490 px over the dimmed app. The left nav is flat,
with 10 items and no groups: General, Connectors, Wallet, Secure store, Permissions,
Messaging channels, Devices, Data controls, Help & support, Legal info. Log out is at
the bottom.

| Page | Pattern worth copying |
|---|---|
| General | Account card linking out, usage meter with a reset date, Language row, Appearance: 3-way Light/Dark/System segmented control plus an accent-color swatch row |
| Connectors | Search field, then **Connected** (drill-in rows) and **Available** (logo + name + blue **Connect** text button). No credential forms on the page. |
| Permissions | **Connector defaults** and **Web access defaults**, each a 2-option radio card ("Ask for some actions" / "Always ask") with one line of explanation. Then **Manage permissions** rows with counts: Connectors 1 ›, Websites 0 ›, Artifacts 0 ›, Scheduled tasks 2 ›, Direct network protocols 8 › |
| Messaging channels | One sentence ("Chat with your agent in other messaging apps") and an Available list |
| Secure store | One sentence and an **Add** button |
| Devices | Friendly empty state |
| Data controls | Privacy explainer card, one toggle with a caption, *Import memory* ›, *Download your agent data* ›, and a red **Reset** row with its consequence stated below it |

Patterns across these pages: every group is a rounded card of rows; each row is a
label, an optional one-line caption, and a single control or a chevron; there is at
most one primary button per page; destructive actions go last, in red, with their
consequence spelled out.

### 1.4 The smooth feel, and what produces it

1. **The shell never moves.** The rail and context panel stay mounted across routes,
   and only the page region changes.
2. **Skeletons with the real layout's shape.** Switching to Ideas showed grey
   placeholder rows matching the final list for a moment, never a spinner or a blank
   page.
3. **Short, quiet transitions.** The page swaps with a brief fade, and the modal and
   palette scale in slightly. Nothing slides a long distance.
4. **Navigation is state, not a reload.** Opening the chat panel keeps the Ideas page
   exactly where it was, including scroll position.
5. **Overlays keep the user in place.** Settings, search, and shortcuts all open over
   the current page and close back to it.
6. **Unread dots instead of toasts.** Background work reports back quietly, for
   example the blue dot on the Chat rail icon and on a side chat.

## 2. Neumar audit (localhost:3420 plus source)

| # | Observation | Evidence | Principle broken |
|---|---|---|---|
| A1 | Two starter-chip rows under the home composer, three categories duplicated | `Home.tsx:472` `StarterChips`, `Home.tsx:573` `QuickActions`; `modes.builtin.ts` `taskStarterChips` | 4, simplicity |
| A2 | Modes (Tasks/Design/Video/Automate) hidden in a dropdown above a red "New task" button | `sidebar-shell/ModeSwitcher.tsx` | 2 |
| A3 | Settings takes over the full screen and loses page context | `SettingsModal.tsx` `fixed inset-0` | 1.4-5 |
| A4 | 11 items × 27 categories, sub-tabs, and third-level tabs (Extensions → MCP → Installed/Presets/Settings; Capabilities → Memory → Settings/Search/Stored/Audit) | `settings/navigation.ts`, `settings/types.ts` | 2 |
| A5 | Models page lists 25 providers and a task-routing matrix before the default-model picker is complete | `tabs/ModelSettings.tsx` (820 lines), `ModelRoutingSection.tsx` | 3 |
| A6 | Connectors is a dense catalog: the default build renders the platform V2 `ConnectorsTab` (Composio API-key card, catalog grid, detail drawer with scopes, access policy, and per-tool overrides). OAuth client-ID forms remain in the legacy `ConnectorSettings.tsx` (694) and inline in `SlackConnectionSection` and `CloudStorageProviderSection` | `tabs/connectors/` (1,558 lines), `CONNECTOR_PLATFORM_V2_ENABLED` in `src/config/index.ts`, `OAuthCredentialsForm.tsx` | 3 |
| A7 | Permissions expects tool patterns (`Bash(git *)`, `mcp__*`) | `tabs/PermissionSettings.tsx` | 3, 4 |
| A8 | General mixes language, plan mode, "Batch Mode (Experimental)", "Advanced Mode", "Live Artifacts (Beta)", notifications, and desktop OS permissions | `tabs/GeneralSettings.tsx` | 3 |
| A9 | Library tabs mix content (Tasks, and Assets when enabled) with config (Installed, Marketplace, Cloud storage, Publish) and a visualization (Knowledge Graph) | `pages/Library.tsx` tab values `tasks`, `assets` (only if `assetsEnabled`), `plugins`, `marketplace`, `cloud-storage`, `publish`, `graph` | 2 |
| A10 | Task right panel opens with 8 developer sections | `task/RightSidebar.tsx` (1,726 lines) | 3 |
| A11 | Replies and panels show absolute `/Volumes/.../sessions/<uuid>/output/...` paths | Task page | 4 |
| A12 | Three first-run screens in sequence with different styles: CLI install (`/setup`), onboarding (rendered by `SetupGuard`), and profile quickstart (`/quickstart`, forced by `SetupGuard` when `quickstart_step` is not done) | `Setup.tsx`, `Onboarding.tsx`, `QuickStartWizard.tsx`, `components/setup-guard.tsx` | simplicity |
| A13 | "No tasks yet — start one to get going" shows while recents are loading, and permanently on pages that pass no tasks | `recents/TasksRecents.tsx`: the empty branch is `if (filtered.length === 0)` and the component has no loading prop. Ten pages render `<LeftSidebar tasks={[]} />` (Dashboard, Approvals, Projects, ProjectDetail, OrgView, ProfileDetail, ChatPlaceholder, and three Video pages) | 5 |
| A14 | The first paint is an empty dark canvas before the greeting and composer appear | Home, first load | 5 |
| A15 | Closing Settings left both screens visible, which matches the CSS: old and new `.page-fade` views both animate for 180ms at the same time | `global.css` `::view-transition-old(.page-fade)` and `::view-transition-new(.page-fade)`; `SettingsModal` `transition={{ duration: 0.15 }}`. `RouteViewTransition` uses `<ViewTransition default="none" update="page-fade">` | 6 |
| A16 | The first click on a recent task didn't navigate; the second did | `TasksRecents.handleSelect` returns when `loadingTaskId` is set, then clears it after `VIEW_TRANSITION_SETTLE_MS` | 5 |
| A17 | The home composer has 7 controls (+, Folder, plugin, Auto, model, rocket, send); the task composer has a different set | `components/shared/ChatInput*` | 1 |
| A18 | "Dashboard" and "Approvals" are top-level nav items, although approvals happen inside tasks | `modes.builtin.ts` tasks sections | 2 |
| A19 | The sidebar re-mounts on every route: each page renders its own `SidebarProvider` and `LeftSidebar` inside the routed `<Outlet />` | 15 files under `src/app/pages/`; `AppRouteProviders.tsx` has no shell | 1.4-1 |
| A20 | ⌘, works only where the sidebar footer is mounted, and settings open from ten separate `SettingsModal` instances | `SidebarFooter.tsx` is the only `open-settings` listener; `rg '<SettingsModal'` | 1.4-5 |

**Already in place to reuse:**

- ⌘K is `mod+k` in `SearchCommandDialog`. `BuiltinShortcuts` also binds
  `mod+shift+p` to `open-search`.
- ⌘B is `mod+b` in `SidebarShell` (`sidebar.toggle`) and calls `toggleLeft`.
- ⌘/ is `ShortcutOverlay` (`mod+/`). ⌘, is `mod+,` and dispatches
  `open-settings`, handled in `SidebarFooter`.
- ⌘1…⌘n are registered by `ModeSwitcher` from each mode's `shortcutSlot`.
  There is no ⌘N (new task) binding.
- `useShortcut` takes `id`, `chord`, `scope`, `descriptionKey`, `group`, and
  `handler`.
- `ModeRegistry` drives the sidebar. Current `shortcutSlot` values are tasks
  1, design 2, automate 3, chat 4, video 5 (`modes.builtin.ts`).
- Settings search is `SettingsNav.tsx`. `advancedMode` and `planMode` are
  fields on `Settings`. `planMode` is `'off' | 'auto' | 'on'` with the comment
  off = skip planning, auto = auto-approve, on = wait for approval. The
  default is `'on'`.
- `ComposerPermissionPicker` already maps picker ids onto that field:
  `ask` → `off`, `plan` → `on`, `auto` → `auto`. `autoAcceptEdits` and
  `bypass` are `supported: false`. It saves the global settings object.
- File checkpoints: `POST /agent/rewind` (`src-api/src/app/api/agent.ts`)
  rewinds files to a user message through the Claude SDK, dry-run by default.
  No frontend calls it. `FileDiffViewer` reads `/files/snapshots/:taskId`
  for display only.
- Route transitions are `RouteViewTransition`: `<ViewTransition default="none"
  update="page-fade">`. The sidebar has `view-transition-name: sidebar` and
  `animation: none`. Reduced motion sets view-transition animation duration to
  `0.01ms`, not `0ms`, so `animationend` still fires.

## 3. External best practice

- **Progressive disclosure.** NN/G's guidance is to reveal more only as the
  user asks, because each extra layer hides the control. GitLab's Pajamas
  system states the operational cap used here: two levels. "Advanced" is for
  depth and risk. "More" is for volume. The two-level rule in this plan is
  the GitLab cap plus NN/G's principle, not a quoted NN/G finding that
  usability falls off after exactly two levels.
- **Agent control patterns.** Show the plan before acting (intent preview), an
  *autonomy dial* (Suggest → Propose → Act with confirmation → Act autonomously), an
  explainable rationale, an action audit with undo, and escalation instead of
  guessing.
- **Default to conservative autonomy and grow it from history** (progressive
  delegation). Avoid prompting for approval every few seconds: users who approve
  constantly stop reading the prompts.
- **Ask one to three scoping questions with defaults prefilled** before a plan.
- **Keep-alive has a DOM cost.** React's `<Activity mode="hidden">` sets
  `display: none`, keeps DOM and state, and destroys effects. Media and
  iframes inside keep running unless a `useLayoutEffect` cleanup pauses them.
- **Browser-reserved chords.** In Chrome, Downloads is Ctrl+J on Windows and
  Linux and ⌘⇧J on macOS. ⌘J on macOS is free. ⌘N/Ctrl+N (new window) is
  reserved by the browser and never reaches the page, so a web build cannot
  use it for "new task".
- **Muse's stated principle:** "no learning curve… no technical experience required";
  the agent checks in before sensitive actions and keeps a complete audit trail in one
  place.

## Sources

- [Introducing Muse (Meta Newsroom)](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- [Everything new coming to Meta's AI agent Muse (TechCrunch)](https://techcrunch.com/2026/09/23/everything-new-coming-to-metas-ai-agent-muse/)
- [Meta is putting its muscle behind Muse as the AI app takes off (TechCrunch)](https://techcrunch.com/2026/09/25/meta-is-putting-its-muscle-behind-muse-as-the-ai-app-takes-off/)
- [Meta debuts Muse, its long-planned personal AI agent (Axios)](https://www.axios.com/2026/09/08/meta-debuts-muse-personal-ai-agent)
- [Meta Muse: Complete Guide (Agentpedia)](https://agentpedia.codes/blog/meta-muse-personal-agent-guide)
- [Progressive Disclosure (NN/G)](https://www.nngroup.com/articles/progressive-disclosure/)
- [Progressive disclosure (GitLab Pajamas)](https://design.gitlab.com/usability/progressive-disclosure)
- [Progressive disclosure best practices (UXPin)](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/)
- [Designing for Agentic AI: Practical UX Patterns (Smashing Magazine)](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/)
- [16 AI agent UI design patterns (Setproduct)](https://www.setproduct.com/blog/ai-agent-ui-design-patterns)
- [How Agents Ask for Permission (arXiv 2607.13718)](https://arxiv.org/pdf/2607.13718)
- [`<Activity>` reference (react.dev)](https://react.dev/reference/react/Activity)
- [Chrome keyboard shortcuts (Google Help)](https://support.google.com/chrome/answer/157179)
