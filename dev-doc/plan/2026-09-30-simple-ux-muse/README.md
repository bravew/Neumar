# Simple by Default: Layout, Settings, and Flow (muse.ai-inspired)

This folder is the single plan for the simple-by-default UX work.

Date: 2026-09-30
Reviewed against the tree: 2026-09-30 (commit `8b3fac7`, second pass)
Owner: Frontend
Status: Approved for implementation. Review decisions recorded in [Review log](#review-log-2026-09-30)
Tracking: epic [#130](https://github.com/bravew/Neumar/issues/130); see [Issues](#issues)
Integration branch: `epic/130-simple-ux`; see [Branch and PR flow](#branch-and-pr-flow)
Reference: <https://muse.ai/> (Meta's personal agent), examined first-hand on 2026-09-30
alongside the local app at `http://localhost:3420/`

Neumar citations below were rechecked against source. Where a line number and
the file disagree, the file wins. The muse.ai notes are a point-in-time
teardown and were not re-observed for this review.

| Doc | Contents |
|---|---|
| [01-research.md](01-research.md) | muse.ai teardown, Neumar audit with evidence, external best practice and sources |
| [02-target-ux.md](02-target-ux.md) | Target layout, navigation, settings information architecture, flows, motion spec |
| [03-implementation-plan.md](03-implementation-plan.md) | Phased plan with files, checkpoints, tests, and rollout |

## Problem

Neumar can do a lot, but the interface makes users see all of it at once. Examples
seen in the running app on 2026-09-30:

- **Home shows two overlapping rows of starter chips.** `StarterChips` (Code, Write,
  Plan, Research, From Drive) and `QuickActions` (Write, Code, Analyze, Create, Plan)
  both render under the composer (`src/app/pages/Home.tsx:472`, `:573`).
- **Settings nests three levels deep and assumes technical knowledge.** It has 11
  sidebar items (`SettingsNavItemId` in `src/components/settings/navigation.ts`)
  over 27 `SettingsCategory` values (`src/components/settings/types.ts`), and
  items with more than one category render those as sub-tabs. Models lists
  providers and `ModelRoutingSection` before the default-model choice is the
  whole page. Connectors (`ConnectorSettings.tsx`, 694 lines) shows OAuth
  client-ID forms inline. Permissions expects tool-name rules such as
  `Bash(git *)`.
- **Library mixes content with configuration.** The tab strip is Tasks,
  Installed, Marketplace, Cloud storage, Publish, and Knowledge Graph, plus
  Assets when `assetsEnabled === true` (`src/app/pages/Library.tsx`). That is
  six tabs, or seven with Assets.
- **The task page opens with a developer view.** The right panel has eight sections
  (Workspace, Output, Artifacts, Tools, Changes, Trace, Documents, Skills), and
  replies print absolute session paths.
- **First run is three screens in sequence, each with its own look:** `Setup.tsx`
  (688 lines, installs the Claude Code and Codex CLIs), `Onboarding.tsx` (408,
  rendered by `SetupGuard`, not a route: profile, appearance, provider, local
  models), and `QuickStartWizard.tsx` (464, creates the first agent profile and
  calls `seedDemoIfNeeded`). `SetupGuard` sends a user who finished onboarding
  but not quickstart to `/quickstart`. They do different jobs, so they merge
  as steps, not as redirects to one screen.
- **The shell is not persistent.** 15 page components each mount their own
  `SidebarProvider` and `LeftSidebar`, so the sidebar re-mounts on every route
  change. Ten of them pass `tasks={[]}`, so Tasks-mode recents on Dashboard,
  Approvals, Projects, and similar pages always say "No tasks yet".
- **Page changes are not smooth.** Recents show "No tasks yet" while tasks are still
  loading (`TasksRecents.tsx` treats `filtered.length === 0` as empty and does
  not take a loading status). The first paint is an empty dark canvas. Closing
  Settings cross-fades because `::view-transition-old(.page-fade)` and
  `::view-transition-new(.page-fade)` both run for 180ms at once
  (`src/config/style/global.css`). One click on a recent item did nothing until
  it was clicked again: `handleSelect` returns while `loadingTaskId` is set,
  and that flag clears only after `VIEW_TRANSITION_SETTLE_MS`.

muse.ai puts a similar amount of capability (connectors, scheduled tasks, artifacts,
memory, channels, permissions) behind a much simpler surface. It uses one icon rail,
one chat that is always available, about ten flat settings pages, permission presets
before detailed rules, and pages that show skeletons instead of going blank.

## Goal

**A first-time user can start, steer, and review an agent task without learning our
vocabulary.** Power users keep every current capability, one deliberate step away.

## Principles (each one is a rule a PR can be checked against)

1. **One home for conversation.** Chat can be opened from every page (⌘J) and does
   not lose state when the user navigates.
2. **Two levels, never three.** Navigation and settings go no deeper than
   *section → detail*. GitLab's Pajamas system caps progressive disclosure at
   two levels. NN/G's article is the reason: each extra layer hides the control.
3. **Presets before rules.** Every settings page starts with a small set of
   plain-language choices, such as "Ask for some actions" or "Always ask". Raw
   configuration sits behind a row labelled **Advanced**.
4. **Say what it does, not what it is.** Capabilities are phrased as outcomes
   ("Tell me what you're returning. I'll chase the refund."), not as tool or feature
   names.
5. **Never show a false empty state and never show a blank screen.** Loading renders
   skeletons with the same shape as the content. Empty states appear only after data
   has loaded.
6. **Motion confirms, it doesn't decorate.** Transitions take 120–200 ms, persistent
   chrome never re-animates, and `prefers-reduced-motion` is respected.
7. **Reuse before adding.** These already exist. Change them rather than
   building a second copy.
   - ⌘K is `mod+k` on `SearchCommandDialog`. `mod+shift+p` also opens search
     (`BuiltinShortcuts`).
   - ⌘B is `mod+b` on `SidebarShell` and toggles `leftOpen`. It is two states,
     not three.
   - ⌘/ is `ShortcutOverlay`. ⌘, is `mod+,` and dispatches `open-settings`.
     The only listener for that event is in `SidebarFooter`, and
     `SettingsModal` is also mounted directly in nine other places
     (`AgentMessages` ×5, `ErrorMessage` ×2, `EntryView`, `ProjectViewPanels`,
     `PetOverlayRoot`).
   - ⌘1…⌘n are registered inside `ModeSwitcher` (`mod+${shortcutSlot}`).
     Hiding or deleting `ModeSwitcher` removes them. ⌘N is not bound anywhere.
   - The Connectors tab that ships by default is the platform V2
     `tabs/connectors/ConnectorsTab.tsx` (build flag
     `VITE_NEUMA_CONNECTORS_PLATFORM_V2`, default on). `ConnectorSettings.tsx`
     is the legacy path.
   - `advancedMode` and `planMode` are top-level fields on `Settings` in
     `src/shared/db/settings.ts`. There is no top-level `settings.ui`.
     `designMode.ui` is design-mode view state and is the wrong place for a
     shell flag.
   - The composer already has `ComposerPermissionPicker` (`mod+shift+m`). It
     writes global `planMode`. An Autonomy chip has to be that picker, or a
     per-task value that does not exist yet. It must not write a second mapping.

## What changes, at a glance

| Area | Today | Target |
|---|---|---|
| App shell | 288 px sidebar, re-mounted by each page, with a mode dropdown, a nav list, and recents | 56 px **icon rail** plus a collapsible **context panel** with three states (⌘B) |
| Conversation | Only reachable from a task page | **Docked chat panel** on any page (⌘J), including *side chats* |
| Starting work | Two chip rows and templates | One composer, 3–4 contextual suggestions, and an **Ideas** gallery |
| Settings | Full-screen takeover, 11 items, 27 categories, 3 levels | **Centered modal** with 10 flat pages, presets first, and one **Advanced** row per page |
| Permissions | Settings page is Allow/Deny/Ask tool-pattern lists. The composer picker already writes global `planMode` (`ask`→`off`, `plan`→`on`, `auto`→`auto`) | Presets that reuse that picker. Tool-rule presets are a separate write. Drill-in rows show counts |
| Task review | 8-section developer panel | **Activity** (audit trail with open/reveal) + **Files**; everything else under **Details** |
| Library | 6 tabs, or 7 when Assets is enabled; content and configuration are mixed | Content only (Tasks, Artifacts, Media, Files); extension and publish settings move to Settings |
| Onboarding | 3 screens in sequence (Setup → Onboarding → QuickStart) | 1 guided flow; the CLI-install step appears only when a tool is missing; ends with a first task |
| Flow | Blank frames, false empties, long cross-fades | Skeletons, persistent shell, 150 ms fades, route prefetch |

## Phases

One sequence. A later phase does not start until the phases it lists are in.

| # | Phase | Size | Depends on | Why this slot |
|---|---|---|---|---|
| 0 | Quick wins: one chip row, false empties (loading and `tasks={[]}`), recents click, path helper, home skeleton | S | none | Bugs on the current shell. No flag. |
| 1 | Flow foundation: motion tokens on the existing view transition, skeletons, prefetch | M | 0 | The new modal and the new shell both sit on this fade. |
| 2 | Task review: Activity, Files, Details | M | 0, 1 | Uses the phase 0 path helper. Does not need the new shell. |
| 3 | Settings IA: one app-level settings host, modal, 10 pages, `planMode` presets, category map | L | 1 | Modal motion comes from phase 1. Presets must exist before onboarding. |
| 4 | App shell: shared layout route, icon rail, context panel, three-state ⌘B | L | 1, 2 | *Needs you* mirrors the approval card from phase 2. |
| 5 | Docked chat and side chats (⌘J) | L | 4 | The dock replaces the context panel from phase 4. |
| 6 | Ideas gallery and simple home | M | 4, 5 | The rail slot comes from phase 4. Automation setup opens the dock from phase 5. |
| 7 | Unified onboarding | M | 3, 5, 6 | The first-idea step needs the registry. The ⌘J coach mark needs the dock. Landing state is `planMode: 'on'` from phase 3. |
| 8 | Rollout, then delete the flag-off shell | S | all | |

After phase 1, task review (2) and settings (3) touch different files and may
be staffed together. The shell (4) still waits for the approval card from
phase 2. Ideas (6) wait for the dock (5). Onboarding (7) waits for settings,
the dock, and Ideas.

Phases 3 through 7 render only when `Settings.ui.simpleShell` is `true`. That
object does not exist yet. Add it on `Settings` in `src/shared/db/settings.ts`,
with a nested-default merge in `sanitizeSettings` (loading is a shallow
`{ ...defaultSettings, ...stored }`). Do not store it on `designMode.ui`.
The one-time moves that make the flag possible (one settings host, one
shell layout route, the ⌘1…⌘n registration) ship unflagged because both
shells need them. Phases 0 and 1 ship to everyone. Every
user-visible string ships in all six locales.

### Issues

Each issue is one PR into the epic branch. The epic (#130) lists the waves,
hotspot files, and open decisions. GitHub records the blocked-by links.

| Phase | Issues |
|---|---|
| 0 | #107 Home chip row + skeleton · #108 recents false empty + click lockout · #109 `toDisplayPath` |
| 1 | #110 page fade + motion tokens · #111 loading contract, skeletons, prefetch, budgets |
| 2 | #112 Activity/Files/Details · #113 inline approval card + prose paths |
| 3 | #114 settings host + `Settings.ui` · #115 primitives, navigation, modal · #116 Permissions + Models · #117 Connectors · #118 other pages · #119 Library tabs |
| 4 | #120 layout route + slot shortcuts · #121 rail, context panel, panel states |
| 5 | #122 chat dock (⌘J) · #123 side chats |
| 6 | #124 Ideas · #125 home composer · #126 Automations |
| 7 | #127 unified onboarding |
| 8 | #128 rollout and cleanup |
| Follow-up | #129 turn-level rewind |

### Branch and PR flow

All work integrates on `epic/130-simple-ux` (created from `main` at
`8b3fac7`) and reaches `main` in one final PR.

1. **Sub-issue PRs.** Create a worktree and branch from
   `origin/epic/130-simple-ux`, named `<type>/<issue>-<slug>` (for example
   `fix/108-recents-false-empty`). Open the PR with base `epic/130-simple-ux`
   and `Closes #<issue>` in the body. Squash-merge it.
2. **Closing issues.** GitHub acts on `Closes #N` only for PRs into the
   default branch. `.github/workflows/epic-close-issues.yml` (#132) closes the
   referenced issues when a PR merges into `epic/**`. It must be on the epic
   branch before the first sub-issue PR merges, so #132 and this plan (#131)
   merge first.
3. **Staying current.** Merge `main` into the epic branch with a merge commit
   (not a rebase; the branch is shared) at least once per wave and before the
   final PR. Do it through a `chore/130-sync-main` PR when there are conflicts.
   Never force-push the epic branch.
4. **Final PR.** When #107–#127 and the release N part of #128 (the opt-in
   toggle) are merged, open
   `epic/130-simple-ux` → `main`. The `main` ruleset allows only squash
   merges, so the epic lands as one commit. Its body lists every sub-PR and
   `Closes #130`. Keep the epic branch afterwards as the per-issue history. Do
   not delete it.
5. **After the epic.** #128's release N+1 (default on) and N+2 (delete the
   flag-off shell) are separate PRs into `main`, one release apart. #129 also
   targets `main`. Nothing from this plan reaches users before the final PR,
   including the phase 0 bug fixes.

## Success measures

- Time from install to the first completed task: **under 3 minutes** for a user with an
  API key.
- Clicks to change the default model: **2** (today: 4 plus a scroll).
- Clicks to connect a common service: **2** (open Connectors, click Connect).
- Route change to first meaningful paint (skeleton or content): **under 100 ms**, with no
  frame showing an empty state for data that is still loading.
- INP under 200 ms on Home, Task, Library, and Settings (Web Vitals "good").
- Existing capabilities remain reachable in two steps or fewer from Settings or ⌘K.
  The phase 3 category-map test enforces this.

## Non-goals

- Per-action undo in Activity. No per-tool undo exists. The only revert is the
  backend's turn-level `POST /agent/rewind` (Claude SDK file checkpoints, no UI
  today). v1 offers open, reveal, and copy path. Turn-level rewind is a follow-up.

- Copying Meta's branding, Muse's avatar persona, or its consumer features (Feed,
  Wallet). We borrow interaction patterns only.
- Changing agent runtime, API contracts, or task storage. The only new persisted
  fields are on the client `Settings` object (`ui.simpleShell` and the keys
  listed in `03-implementation-plan.md`). `designMode.ui` is not that object.
- Redesigning Design Mode and Video Mode internals. They move into the new shell
  unchanged.

## Review log (2026-09-30)

A second pass checked every citation against commit `8b3fac7` and checked the
external claims against their sources. Corrections applied across 01–03:

| Finding | Evidence | Plan change |
|---|---|---|
| Shell re-mounts on every route | `<LeftSidebar` in 15 files under `src/app/pages/` | Phase 4 starts by lifting the shell into a layout route (unflagged) |
| Recents false empty is also caused by `tasks={[]}` on 10 pages | same files; `SidebarRecents` renders `TasksRecents` whenever the mode is `tasks` | Phase 0.2 moves the task list to one shell-owned source |
| ⌘1…⌘n live in `ModeSwitcher`; ⌘N does not exist | `ModeSwitcher.tsx:26`; no `mod+n` outside a registry test | Rail owns slot shortcuts; keyboard map marks ⌘N as new (desktop only) |
| `open-settings` has one listener, in `SidebarFooter`; ten `SettingsModal` mounts | `rg '<SettingsModal'` | Phase 3 adds one `SettingsHost` in `AppRouteProviders` |
| Connectors default is platform V2 | `CONNECTOR_PLATFORM_V2_ENABLED` defaults `true` in `src/config/index.ts` | Phase 3 builds on `ConnectorsTab`; `OAuthCredentialsForm` is used only by the legacy tab, `SlackConnectionSection`, and `CloudStorageProviderSection` |
| `workplace` was mapped to two pages | `WorkplaceSettings.tsx` holds sandbox, working directory, and log path | `workplace` → Data controls; the sandbox card is extracted and rendered on Permissions |
| Setup and QuickStart are not duplicates | `Setup.tsx` header; `QuickStartWizard` creates a profile | **Decision:** fold both in as steps; install step is conditional; profile becomes a default |
| "Undo" had no backend | `FileDiffViewer` only reads `/files/snapshots`; `/agent/rewind` has no UI consumer | **Decision:** v1 is open/reveal only; rewind is a follow-up |
| ⌘J is not Chrome's Downloads on macOS | Chrome help: Downloads is ⌘⇧J on Mac, Ctrl+J on Windows/Linux | §2 and Phase 5 corrected |
| `ui` sub-keys would be lost on load | shallow merge in `getSettings`/`getSettingsAsync` | Convention: normalize `ui` in `sanitizeSettings`, with a test |
| The dev automation bypass reports all three first-run checks as done | `shouldBypassSetupGuardForAutomation()` in `components/setup-guard.tsx` | Onboarding gets an `/onboarding` route that Playwright opens directly; the guard's routing table is unit-tested |
| Playwright specs are in `tests/e2e/specs/` | `ls tests/e2e/specs` (includes `home`, `library`, `navigation`, `settings`) | Extend existing specs where one exists |
