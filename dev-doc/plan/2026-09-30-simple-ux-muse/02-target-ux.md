# 02: Target UX

Wireframes are schematic. Sizes are starting values to tune in review, not specs to
copy from muse.ai.

## 1. App shell

```
 rail 56   context panel 264 (optional)     page region (flex)
┌────┬──────────────────┬───────────────────────────────────────────┐
│ 🐂 │ 🔍 Search     ⌘K │                                    [ ◧ ]  │
│    │ ── Needs you (2) │                                           │
│ ⌂  │  • Approve publish●                                          │
│ 🔍 │ ── Pinned         │            page content                  │
│ 💡 │  • Weekly report  │         (max-w 720 for reading pages,    │
│ ⟳  │ ── Recent         │          full width for canvases)        │
│ ▦  │  • Crop QR code   │                                           │
│ ── │  • Video → MP4    │                                           │
│ ✎  │                   │                                           │
│ 🎬 │                   │                                           │
│    │                   │                                           │
│ ≡  │                   │                                           │
│ 👤 │                   │                                           │
└────┴──────────────────┴───────────────────────────────────────────┘
```

### Rail (always mounted)

"Always mounted" requires a layout route. Today each page renders its own
`SidebarProvider` + `LeftSidebar` inside the routed `<Outlet />`, so the
sidebar re-mounts on every navigation. The shell moves into a pathless
layout route (`AppShellLayout`) under `AppRouteProviders`. The page region
is its `<Outlet />` and the only thing inside `RouteViewTransition`. Pages
stop mounting a sidebar and stop owning the recents task list.

| Slot | Item | Route | Context panel content | Replaces |
|---|---|---|---|---|
| top | Logo / agent mark | `/` | none | logo + "New task" button |
| 1 | **Home** | `/` | Needs you · Pinned · Recent (today's Recents) | Tasks mode + recents |
| 2 | **Search** | ⌘K palette (overlay, no route) | none | sidebar search box |
| 3 | **Ideas** | `/ideas` (new) | hidden | StarterChips + QuickActions + "Start with Template" |
| 4 | **Automations** | `/automation` | Scheduled · Watching · Paused | Automate mode + Automations item |
| 5 | **Library** | `/library` | Tasks · Artifacts · Media · Files | Library's seven tabs |
| divider | *Studios*: one item per enabled non-default `ModeRegistry` mode | | | ModeSwitcher dropdown |
| 6 | **Design** | `/design` | Design projects | Design mode |
| 7 | **Video** | `/video` | Video projects | Video mode |
| bottom | **≡ menu**: Keyboard shortcuts ⌘/ · Usage & activity · Send feedback · Language › · Settings ⌘, | | | UserAccountMenu items + Dashboard |
| bottom | **Account avatar**: sign in or out, profile | | | SidebarFooter |

- **Approvals** stop being a destination. Pending approvals appear as **Needs you** at
  the top of the Home panel and as a dot on the Home rail icon. `/approvals` stays as a
  deep link that opens Home with that group filtered.
- **Dashboard** becomes *Usage & activity* in the ≡ menu, opened as a sheet over the
  current page. The route stays for deep links.
- Rail items come from `ModeRegistry` plus a small static list, so registering a mode
  still adds it without editing the shell. `shortcutSlot` keeps ⌘1…⌘n. Today's
  slots are tasks 1, design 2, automate 3, chat 4, video 5. The rail drawing
  order and the shortcut number are not the same sequence. Do not renumber
  slots as part of the visual reorder. The `mod+${shortcutSlot}` registration
  lives in `ModeSwitcher` today. It moves to a shell-level
  `useModeSlotShortcuts()` hook so it survives when `ModeSwitcher` is hidden
  or deleted.
- Tooltips show the label and shortcut (Radix Tooltip, 300 ms delay).

### Panel states (⌘B cycles, ⌘. toggles all)

```
state A  rail + context panel      (default on wide screens)
state B  rail only                 (default < 1100 px, and on Ideas)
state C  nothing (focus)           (⌘. from any state; ⌘. again restores the previous state)
```

The state is saved per rail item on the new top-level `Settings.ui.panelState`.
That `ui` object does not exist yet. `designMode.ui` is unrelated. The existing
hover hot-zone flyout (`SidebarHoverHotzone`) previews the context panel in
state B.

## 2. Docked chat and side chats (⌘J)

```
┌────┬──────────────────────┬──────────────────────────────────────┐
│rail│ Chats ▾   ◧   [×]    │  Ideas                                │
│    │ ─────────────────── │  (page stays interactive, keeps      │
│    │  …thread…            │   its scroll position)               │
│    │ 📎 Looking at: Ideas  │                                       │
│    │ [ + Message…    🎤 ⏎]│                                       │
└────┴──────────────────────┴──────────────────────────────────────┘
```

- ⌘J, or the ◧ button in the page header, turns the context panel into a **chat
  dock** with the most recent conversation. It resizes (drag, 320–560 px) and the width
  is remembered.
- The page adds a **context chip** ("Looking at: Library › Artifacts ›
  report.pdf") that the user can remove before sending. It uses the same attachment
  mechanism the composer already supports, so the API contract is unchanged.
- **Side chats**: *Ask about this* on an artifact, automation, or library item starts
  a conversation bound to that item. Its title is the item name, and it appears under
  Home › Recent with a small link glyph.
- Sending from the dock uses the same task creation path as Home. The dock is a view of
  a task, not a new data type.
- "Open full view" expands the dock into `/task-v2/:id`, with a shared-element
  transition on the thread.
- `mod+j` is Ctrl+J on Windows and Linux, which is Chrome's Downloads shortcut.
  On macOS Chrome uses ⌘⇧J for Downloads, so ⌘J is free. The handler calls
  `preventDefault()`. On the Windows/Linux web build the rail button is the
  primary way in, and the shortcut sheet shows the chord with that caveat.
  The desktop build has no conflict.

## 3. Starting work

### Home

```
                     Good morning, Sam
     ┌─────────────────────────────────────────────────┐
     │ What should we get done?                        │
     │                                                 │
     │ [+]  [General Helper ▾]        [Ask first ▾] 🎤 ⏎│
     └─────────────────────────────────────────────────┘
       Summarize a PDF   Convert a video   Draft a post   More ideas →
```

- **One suggestion row, three or four chips**, chosen from Ideas by recent use and the
  active agent profile, plus **More ideas →**. `StarterChips` and `QuickActions`
  merge into this row.
- **Composer controls:**
  - **+** opens one menu: Attach files · Choose folder · From cloud drive · Start from
    template.
  - **Agent chip**: profile and model combined. A popover shows the model under the
    profile name.
  - **Autonomy chip**: the existing `ComposerPermissionPicker` (`mod+shift+m`),
    not a new control. Its ids are `ask`, `plan`, and `auto` (§5.2).
  - Mic, then Send.

  That is seven controls reduced to five visible, and the task page uses the same
  composer.
- A first-run empty state points at Ideas instead of an empty recents list.

### Ideas (new page)

```
Ideas
Things I can do for you. Pick one and I'll set it up.

Files & media
 🎞  Drop in a video. I'll convert, trim or upscale it.          ⋯
 🖼  Give me images. I'll crop, resize and publish them.         ⋯
Research & writing
 🔎  Name a topic. I'll research it and write a sourced brief.   ⋯
 ✉️  Tell me who it's for. I'll draft the email.                  ⋯
Automate
 ⟳  Tell me what to watch. I'll check daily and ping you.        ⋯
```

- Each row: an illustration or icon, a **promise in the user's voice** (one line), and
  a **how it works** sentence.
- Clicking the row, or **Let's do it**, prefills the composer (Home, or the dock if it
  is open) and focuses it. Rows that need setup (a connector, a schedule) open a short
  scoping card with no more than three questions, defaults prefilled, before
  prefilling.
- The ⋯ menu offers **Let's do it**, **More like this**, and **Not interested**.
  Feedback is stored locally on the new `Settings.ui.ideasFeedback` and only
  reorders items.
- Source: a typed registry `src/shared/ideas/` fed by today's prompt templates
  (`QuickActions` `CATEGORY_ITEMS`, `taskStarterChips`, template library). Modes can
  contribute ideas the same way they contribute chips today.

### Automations (restyled, same data)

The page shows **Scheduled**, **Watching**, and **Paused** lists, then **Create an
automation** with outcome categories (Reports, Monitoring, Files, Publishing,
Something else). Each category opens the dock with a scoping card. The advanced editor
stays one click away (*Edit details*).

## 4. Reviewing work (task page)

```
┌ thread (max-w 720) ───────────────────────┐ ┌ panel 320 ──────────────┐
│ You: convert this video to mp4            │ │ [Activity] [Files]      │
│ ▸ Worked for 12s · 3 steps                │ │  ✓ Read 80s-video.webm  │
│ Done. Saved **80s-video.mp4** (1.05 GB)   │ │  ✓ Ran ffmpeg      ↶    │
│ [▶ preview card]                          │ │  ✓ Wrote output/…mp4 ↗  │
│                                           │ │  ⏳ Wants to publish ▸  │
│ [ Continue…                     🎤 ⏎ ]    │ │ Details ›               │
└───────────────────────────────────────────┘ └─────────────────────────┘
```

- **Activity** is the audit trail: every read, write, command, web visit, connector
  call, and approval in time order. Each line offers **open**, **reveal**, or
  **copy path**, and a written file links to its diff (today's `FileDiffViewer`).
  It absorbs today's Tools and Changes views in human language. There is no undo
  in v1. No per-action undo exists, and the backend's turn-level
  `POST /agent/rewind` has no UI yet. "Rewind files to before this turn" is a
  follow-up (dry-run preview, then confirm, Claude-adapter tasks only).
- **Files**: Output first, then Referenced. Names are shown relative to the session
  (`output/80s-video.mp4`). The full path appears in the tooltip and in *Copy path*.
  Assistant prose gets the same treatment when it renders a path under the session root
  (display only; the text sent to the model is unchanged).
- **Details ›** is the only way to reach Trace, Skills, Documents, the raw tool list,
  and run tree. It is visible for everyone, collapsed by default, and open by default
  when `advancedMode` is on.
- Pending approvals render **inline in the thread** as an intent-preview card: what,
  where, why, with **Approve**, **Edit**, and **Deny**. The card is also mirrored in
  *Needs you*.

## 5. Settings v2

A **centered modal** (about 760×560 px, full-screen below 720 px wide) over the
dimmed current page. The left nav is flat, with 10 items, a search field at the top,
and **Sign out** at the bottom. There are no sub-tabs: each page is a vertical stack of
cards, and anything past a card is a **drill-in** (the page slides left and a back
chevron appears in the header). That is the second and final level.

### 5.1 Pages and the migration map for all 27 `SettingsCategory` ids

| New page | Top of page (presets and common) | Drill-ins / Advanced | Absorbs categories |
|---|---|---|---|
| **General** | Profile card (name, avatar, sign in) · Language › · Appearance: Light/Dark/System segmented control + accent swatches · Notifications (2 toggles) · Voice › | Advanced ›: Batch mode, Live artifacts, Advanced mode, Pets, Desktop OS permissions | `account` `general` `theme` `pets` `speech` `advanced` |
| **Models** | **Default model** card (picker lists models from connected providers, with Recommended tags) · Connected providers list (status dot) · **Add provider** › (searchable list of all 25) | Advanced ›: Task routing, Media generation defaults, Custom models, Agent runtimes | `model` `agentRuntimes` |
| **Agents & skills** | Agent profiles list (default marked) · Skills (installed count ›) · **Browse marketplace** › | Advanced ›: MCP servers, Plugins, Modes, Hooks, Web search provider, Design Mode | `profiles` `skills` `plugins` `mcp` `modes` `hooks` `search` `designMode` |
| **Connectors** | Search · **Connected** rows › · **Available** rows with **Connect** (includes cloud storage and publish destinations, with filter chips *All · Files · Work apps · Publishing*) | Per-connector drill-in: today's V2 `ConnectorDetailDrawer` content (auth, channel scopes, access policy, tool overrides) as a page. Advanced ›: Composio API key (`ComposioApiKeyCard`), *Use your own OAuth app* (`OAuthCredentialsForm` from the Slack and cloud-storage sections) | `connector` `publish` |
| **Messaging channels** | One sentence, then Connected and Available bots (Slack, Discord, Telegram, Lark) | Per-channel drill-in; gateway adapters (Feishu, iMessage, Linear, WhatsApp, SMS) and gateway security under Advanced | `channels` |
| **Permissions** | **When should I ask you?** 3 radio cards (see 5.2) · **Where does code run?** Sandbox / On this Mac cards (extracted from `WorkplaceSettings`) | **Manage permissions**: Tools *n* › · Folders *n* › · Connectors *n* › · Websites & network *n* › · Automations *n* › — each list edits today's rules | `permissions` |
| **Secure store** | One sentence and **Add** · list of secrets (masked) | none | `secrets` |
| **Memory** | Remember things about me (toggle) · What I remember › (explorer) · Workspace knowledge (status + Reindex) | Advanced ›: embedding provider, recall limit/threshold, audit | `memory` |
| **Data controls** | Privacy card · Where files are saved (working directory) · Import memory › · Export my data › · Usage › | Advanced ›: log file, data migration · **Reset Neumar** (red, last, consequence spelled out) | `data` `usage` `workplace` |
| **Help & about** | Version and updates · Keyboard shortcuts › · Send feedback · Docs | Legal | `about` `keyboard` |

Brand-specific names such as "Reset Neumar" come from branding exports, not literals.

`WorkplaceSettings` holds three things today: the default sandbox, the working
directory (with session migration), and the log path. Each category has one
location, so `workplace` maps to *Data controls*. The sandbox radio group is
extracted into its own component and rendered on *Permissions*. Its search
keys point there.

**One host.** Today `SidebarFooter` is the only `open-settings` listener, and
nine other components mount their own `SettingsModal`. A single `SettingsHost`
in `AppRouteProviders` owns the listener and the one modal instance. The other
call sites dispatch `open-settings` with a category `detail` instead of
mounting a modal. ⌘, then works on every route, including ones without a sidebar.

**Deep links are kept.** `initialCategory: SettingsCategory` still works:
`SETTINGS_NAV` becomes a map `category → { page, drillIn? }`, so existing
`open-settings` events (for example `detail: 'mcp'` from the `/mcp` slash command in
`useSlashCommands.ts`) land on *Agents & skills › Advanced › MCP servers*. A
unit test iterates all 27 ids and checks that each resolves (it fails when an id is
added without a home).

**Search** indexes page titles, card titles, row labels, and captions (it extends the
current `SettingsNav` search). A result opens the page and briefly highlights the row
for 1.2 s.

### 5.2 Permission presets (the autonomy dial)

`planMode` is not an allow/ask/deny matrix. On `Settings` it is
`'off' | 'auto' | 'on'`: off skips planning, auto auto-approves the plan, on
waits for approval. The default is `'on'`. `ComposerPermissionPicker` already
writes that field globally:

| Picker id | Label direction | Writes |
|---|---|---|
| `plan` | Wait for the plan. Closest to "ask before important steps." | `planMode: 'on'` |
| `ask` | Skip the plan step. The picker calls this ask. It is not Autopilot. | `planMode: 'off'` |
| `auto` | Auto-approve the plan. | `planMode: 'auto'` |

`autoAcceptEdits` and `bypass` are present and `supported: false`. Do not
enable them in this plan.

Tool allow, ask, and deny lists live in the permissions settings, not on
`planMode`. A preset that rewrites those lists is a new pure function with
its own tests. It must not pretend that `planMode: 'auto'` means "ask for
important actions" or that `planMode: 'off'` means "allow every tool."

Copy for the three supported picker states can be plainer than the ids, but
the write stays the table above. *Custom* appears only when the tool rules
were edited by hand, and selecting it does not touch `planMode`.

There is no per-task `planMode` today. The picker calls
`saveSettings({ ...getSettings(), planMode })`. A per-task override is new
work and is out of v1 (see the implementation plan's open question). The
chip shows the global value.

### 5.3 Row grammar (the one component set every page uses)

`SettingsCard` › `SettingsRow` with one of: `toggle`, `segmented`, `select`,
`chevron` (drill-in), `button`, `status`. Each row has a label, an optional one-line
caption, and a trailing control. A page may have at most one primary button, and
destructive rows go last in red with a consequence caption. Rows never contain inline
multi-field forms; those move to a drill-in.

## 6. Onboarding (one flow)

Today's first run is three screens with different jobs: `Setup.tsx` installs
the Claude Code and Codex CLIs, `Onboarding.tsx` (rendered by `SetupGuard`)
collects profile, appearance, provider, and local models, and
`QuickStartWizard.tsx` creates the first agent profile and seeds demo data.
They become steps of one flow:

1. **Welcome.** Name, language, and theme on one screen, with Continue.
2. **Install tools**, shown only when a required CLI is missing (today's
   `Setup.tsx` checks). Skipped entirely when everything is installed.
3. **Connect a brain.** Recommended provider cards. Detected options (a local Ollama,
   an env key, a Claude/Codex CLI login) appear first and are pre-selected, with
   *Paste an API key* as the fallback. Clicking **Test** confirms it works.
4. **Your first idea.** Three Ideas rows, plus "I'll type my own".
5. Land on Home with the composer prefilled and `planMode: 'on'` (the picker
   id `plan`, which is already the settings default). A one-time coach mark
   points at ⌘K and ⌘J.

The template → personalize → confirm steps of QuickStart are dropped from
first run. Finishing the flow creates the default *General Helper* profile
(today's skip path) and runs `markFirstRunCompleted` and `seedDemoIfNeeded`.
Profile templates stay available under *Agents & skills*.

The flow gets its own route, `/onboarding`. `/setup` and `/quickstart` redirect
there, at the matching step.
`SetupGuard` keeps its checks. Existing users are not sent back through it:
`onboardingCompleted` + `onboardingVersion` and `quickstart_step` keep their
meaning, and a user with both done never sees the new flow.

## 7. Smooth-flow spec

### 7.1 Motion tokens (CSS variables in `global.css`)

Route motion already exists. `RouteViewTransition` renders
`<ViewTransition default="none" update="page-fade">`. The page class is
`.page-fade`. The sidebar already has `view-transition-name: sidebar` and
`animation: none` on its old and new pseudos. Settings uses `motion/react`
at `duration: 0.15`. New tokens feed those call sites. They do not add a
second transition on `root`.

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | 120 ms | hover, press, toggles, chip select |
| `--motion-base` | 160 ms | page fade, panel open or close, tab switch, drill-in slide |
| `--motion-slow` | 220 ms | modal and palette enter (fade + scale 0.98 → 1) |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | enter |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | exit (exits use roughly 70% of the enter duration) |

Rules:

- **Persistent chrome** that should not cross-fade gets its own
  `view-transition-name` and `animation: none`, the way `.left-sidebar`
  already does. React 19.3 assigns an automatic name to a `<ViewTransition>`
  and exposes the class (`page-fade`, `sidebar-panel-enter`). Target the
  class selectors that `global.css` already has. Do not also set
  `navigate(..., { viewTransition: true })`. `RouteViewTransition`'s comment
  says the two calls fight over `document.startViewTransition()`.
- **Only the page region fades.** Today both
  `::view-transition-old(.page-fade)` and `::view-transition-new(.page-fade)`
  run for 180ms together, so both pages are visible. Delay the incoming
  animation until the outgoing one finishes (about 100ms out, then 160ms in).
  Keep `mix-blend-mode: normal`, which is already set.
- **Overlays** (settings, palette, shortcut sheet, dock) stay on
  `AnimatePresence` / Radix and must not start a view transition.
- `prefers-reduced-motion` already sets view-transition duration to
  `0.01ms`. Keep that. `0ms` can skip `animationend`, and
  `startViewTransition` then waits. Extend the existing media query. Do not
  replace it with `0ms`.

### 7.2 Loading and perceived performance

- **Skeleton contract.** Every lazy route and every list has a skeleton with the same
  geometry as the real content. `PageLoader` becomes per-route skeletons. Show the
  skeleton only if data isn't ready within 120 ms, and once shown keep it for at
  least 250 ms to avoid flicker.
- **No false empties.** List components take `status: 'loading' | 'ready' | 'error'`,
  and an empty state renders only when the status is `ready` and the list is empty.
  This is a typed prop, so a list can't "forget" to check.
- **Prefetch on intent.** Hovering or focusing a rail item or recent row preloads the
  lazy route chunk and warms the query, so the click only renders.
- **Keep pages alive.** React 19.2+ `<Activity mode="visible" | "hidden">`
  is in this app (`react` `^19.3.0`). `hidden` applies `display: none`,
  keeps state and DOM, unmounts effects, and defers updates. There is no
  built-in cap. The app keeps at most the last three rail destinations in
  `mode="hidden"` and does not mount Design or Video canvases inside
  Activity at all. A hidden canvas is still in the DOM, so "exclude via a
  flag" is not enough if the canvas was mounted first. Media and iframes in a
  hidden page keep playing, so any page with `<video>`, `<audio>`, or an
  iframe preview pauses it in a `useLayoutEffect` cleanup. See
  <https://react.dev/reference/react/Activity>.
- **Optimistic navigation.** A recent-row click highlights immediately and navigates
  on the same frame. There is no settle-timer lockout (fixes A16).
- **First paint.** Render the shell with rail, greeting skeleton, and composer from
  static data before settings and tasks load (fixes A14).
- **Quiet status.** Background completions update dots on rail items and rows. Toasts
  are only for failures and for actions that need the user.

### 7.3 Budgets (checked in Playwright, §03 Phase 1)

- Rail click to skeleton or content paint: under 100 ms (p95, dev build, M-series).
- Settings open to first row interactive: under 150 ms.
- No frame where both old and new pages have opacity above 0.5 during a route change.
- INP under 200 ms for rail click, settings page switch, and dock open.

## 8. Keyboard map (additions in **bold**)

| Chord | Action | Status |
|---|---|---|
| ⌘K | Search (Recents shown before typing) | exists: add Recents-first |
| **⇧⌘K** | Search in this conversation | new (wraps `MessageSearch`) |
| **⌘J** | Open or close the chat dock | new; free on macOS, Ctrl+J is Chrome Downloads on Windows/Linux |
| ⌘B | Cycle panel states A → B → C | exists: becomes 3-state |
| **⌘.** | Hide or restore all panels (focus) | new, free |
| ⌘1…⌘n | Rail destinations | exists (`shortcutSlot`); registration moves out of `ModeSwitcher` |
| **⌘N** | New task | new, desktop build only (browsers reserve ⌘N/Ctrl+N) |
| ⌘, | Settings | exists |
| ⌘/ | Keyboard shortcuts | exists |
| **⇧Esc** | Focus composer | new |
| `/` | Slash commands (in composer) | exists |
