# 03: Implementation Plan

Conventions that apply to every phase:

- **Flag.** New surfaces render only when `Settings.ui.simpleShell` is `true`.
  Add a top-level `ui` object on `Settings` in `src/shared/db/settings.ts`,
  next to `advancedMode`. There is no `ui` field on `Settings` today.
  `designMode.ui` (`commentRailCollapsed`, `viewMode`) stays design-mode
  state. The flag defaults to `false` until Phase 8. Later phases store
  `panelState`, dock width, `ideasFeedback`, and coach-mark dismissal on
  that same object. Phase 0 fixes ship without the flag because they are bugs.
- **Persisting `ui`.** Settings load with a shallow merge
  (`{ ...defaultSettings, ...stored }` in `getSettings` and `getSettingsAsync`),
  so a stored `ui` written by an older build would drop newer sub-keys. Add a
  `ui` default and merge it in `sanitizeSettings`, the way `connectors` is
  handled there, with a unit test that loads a partial `ui`. `ui` is client
  view state. Do not add it to `BACKEND_SYNCED_KEYS`.
- **Locales.** Every new string is added to all six modules under
  `src/config/locale/messages/{en,zh,es,fr,hi,pt}/`. The locale consistency check in
  `pnpm validate` enforces this.
- **Size.** New components stay under 350 lines (`check-component-size.mjs`).
  The check fails when a file's line count exceeds the allowlist `current`.
  `target` is the goal and is not the ceiling. File length and `current` are
  not always equal: `RightSidebar.tsx` is 1,726 (ceiling 1,726),
  `SkillsSettings.tsx` is 1,171 (ceiling 1,171), `ModelSettings.tsx` is 820
  (ceiling 820), `MCPSettings.tsx` is 829 (ceiling 842), and
  `ConnectorSettings.tsx` is 694 (ceiling 707). Lower `current` only after
  the file is shorter. Lowering it first fails the check. Never raise it.
- **Checks per phase:** `pnpm test <touched tests>`, `pnpm validate`, plus the
  Playwright spec named in the phase. Specs live in `tests/e2e/specs/`
  (`testDir` is `./tests/e2e`). Extend the existing `home`, `library`,
  `navigation`, and `settings` specs where they cover the surface. Run them
  with `pnpm test:e2e:browser`, after `pnpm --filter @neumar/video-ir build`. Hooks follow AGENTS.md: declare dependencies and
  put user-triggered work in event handlers.
- **Evidence.** Each phase's PR includes before/after screenshots at 1280×800 and
  390×844.
- **Branches.** Every PR through release N of phase 8 targets
  `epic/130-simple-ux`, not `main`. Branch from
  `origin/epic/130-simple-ux` and put `Closes #<issue>` in the PR body. The
  README's *Branch and PR flow* covers syncing `main` and the final PR.

---

## Phase 0: Quick wins (S, no flag)

| # | Change | Files | Test |
|---|---|---|---|
| 0.1 | Render one suggestion row on Home: keep the mode-driven `StarterChips`, fold the `QuickActions` categories into its overflow ("More ideas" popover for now) | `src/app/pages/Home.tsx`, `src/components/home/QuickActions.tsx`, `StarterChips.tsx` | `src/__tests__/home/*`: assert one chip row and no duplicate labels |
| 0.2 | False empty in recents: distinguish loading from empty, and stop pages from passing `tasks={[]}`. Add one task-list source for the sidebar (a hook such as `useSidebarTasks()` backed by the existing task queries) that `SidebarRecents` reads directly. Remove the `tasks` prop from the ten pages that pass an empty array. Home, Library, Automation, and the two task pages stop passing theirs once the hook covers them | `layout/sidebar-shell/recents/TasksRecents.tsx`, `SidebarRecents.tsx`, `left-sidebar.tsx`, the 15 pages under `src/app/pages/` that render `LeftSidebar` | unit: loading renders a skeleton, ready + empty renders "No tasks yet", and recents on a page that used to pass `[]` lists tasks |
| 0.3 | Recent click lockout: reproduce first, then replace the settle-timer guard with same-id de-dupe only | `TasksRecents.tsx` `handleSelect` | unit: two different rows clicked in sequence navigate twice |
| 0.4 | Friendly paths in the task Files panel: relative to the session root, with full path in the tooltip and *Copy path* | `task/RightSidebar.tsx` (extract `WorkspaceFilesSection`) | unit on a `toDisplayPath()` helper in `src/shared/lib/` |
| 0.5 | Skeleton for Home first paint (greeting + composer frame) | `Home.tsx`, `components/home/HomeGreeting.tsx` | Playwright: no fully empty frame after navigation |

**Checkpoint 0:** Home shows one chip row; the recents A13 and A16 bugs are fixed and
covered by regression tests; `pnpm validate` passes.

## Phase 1: Smooth-flow foundation (M)

1. **Motion tokens.** Add `--motion-*` and `--ease-*` to `src/config/style/global.css`.
   Point the existing 180 ms `.page-fade` rules and the 150 ms `SettingsModal`
   `transition={{ duration: 0.15 }}` at those tokens. `motion/react` takes seconds
   (`0.15`) or a CSS variable if the style reads it. Do not add a parallel
   `::view-transition-old(root)` animation. `RouteViewTransition` uses the
   `page-fade` class, not the `root` name. The `root` rules in `global.css` are
   the older path.
2. **Transition audit (A15).** The overlap is visible in CSS today: old and new
   `.page-fade` both run 180 ms with no delay. Confirm in the Performance panel
   whether a Suspense boundary also holds the transition open. Then delay
   `::view-transition-new(.page-fade)` until the old animation ends. The sidebar
   name and `animation: none` are already in place. Do not call
   `navigate` with `viewTransition: true` on top of `RouteViewTransition`.
   Keep reduced motion at `0.01ms`.
3. **`AsyncList` status contract.** Add a typed
   `status: 'loading' | 'ready' | 'error'` prop plus `renderSkeleton`,
   `renderEmpty`, and `renderError` in `src/components/common/`. Migrate recents,
   Library lists, Automations, and Approvals.
4. **Per-route skeletons.** Replace the single `PageLoader` fallback in
   `src/app/router.tsx` with route-shaped skeletons (Home, Task, Library, Automation,
   Settings page body), and add the 120 ms show delay and 250 ms minimum display.
5. **Prefetch on intent.** Add a `preloadRoute(path)` map next to the `lazy()` imports
   in `router.tsx` and call it from nav items and recent rows on `pointerenter` and
   `focus`.
6. **Budget spec.** Add `tests/e2e/specs/ux-flow-budgets.spec.ts` (Playwright), which measures rail
   or nav click to skeleton or content paint, and samples opacity of old and new page
   nodes during a route change (asserting there is no frame where both exceed 0.5).

**Checkpoint 1:** the budgets in 02 §7.3 pass locally on the current shell; the A15
cause is documented in the PR.

## Phase 2: Simple task review (M)

Do this before the shell. The right panel is the task page, not the app chrome,
and phase 0.4 already starts the path helper.

1. Split `RightSidebar.tsx` into `ActivityPanel`, `FilesPanel`, and `DetailsPanel`
   (Trace, Skills, Documents, Tools, Run tree). Lower `current` in
   `component-size-allowlist.json` only after the file is shorter than 1,726.
2. `ActivityPanel` builds a human-readable timeline from existing tool events
   ("Read 80s-video.webm", "Ran ffmpeg", "Wrote output/80s-video.mp4"). Lines
   offer open, reveal, or copy path, and written files link to their
   `FileDiffViewer` diff. No undo in this phase (review decision). The
   backend's `POST /agent/rewind` stays unused until the follow-up.
3. Inline approval card: an intent preview (what, where, why) with
   Approve / Edit / Deny, reusing `PermissionDialog` and `PlanApproval` logic.
   The *Needs you* row in the shell is phase 4. This phase only renders the card
   in the thread.
4. Display-only path shortening in assistant prose for paths under the session
   root. Reuse `toDisplayPath()` from phase 0.4. The text sent to the model stays
   the full path.

**Tests:** unit for the event → activity-line mapper (a table test covering each tool
kind); Playwright checks that a completed task shows Activity by default and that
Details holds Trace.

**Checkpoint 2:** a completed task opens on Activity and Files. Trace is under
Details. `RightSidebar.tsx` is either gone or under its new ceiling.

## Phase 3: Settings IA v2 (L)

1. **Row grammar components.** Add `SettingsCard`, `SettingsRow` (variants: toggle,
   segmented, select, chevron, button, status), `SettingsDrillIn` (slide + back),
   `SettingsPresetGroup` (radio cards), and `SettingsDangerRow` in
   `src/components/settings/primitives/`.
2. **Navigation model.** Rewrite `settings/navigation.ts` as
   `SETTINGS_PAGES` (10 pages) plus `CATEGORY_TO_LOCATION: Record<SettingsCategory, { page; drillIn? }>`.
   The `Record` type forces every one of the 27 ids to have a location at compile
   time. `SettingsNav.tsx` becomes a flat list, and search indexes rows through a
   `searchKeys` field on each row definition.
3. **One settings host (unflagged, first).** Add `SettingsHost` to
   `AppRouteProviders`. It owns the only `open-settings` listener (moved out of
   `SidebarFooter`) and the only `SettingsModal` instance. Migrate the nine
   direct mounts (`AgentMessages` ×5, `ErrorMessage` ×2, `EntryView`,
   `ProjectViewPanels`, `PetOverlayRoot`) to dispatch `open-settings` with
   their category as `detail`. Read each call site first: some pass props
   other than `initialCategory`, and those need an event payload shape, not
   a dropped prop. Test: ⌘, opens settings on a route with no sidebar
   (`/design`).
4. **Container.** `SettingsModal.tsx` becomes a centered Radix Dialog (760×560,
   full-screen under 720 px) behind the flag. The old full-screen layout stays as
   the flag-off path. The shell in phase 4 dispatches `open-settings`. It does
   not import the modal.
5. **Pages.** Build them in this order. Each page reuses existing tab components
   inside drill-ins rather than rewriting their logic:
   1. **Permissions.** Preset cards follow 02 §5.2. `planMode` writes go through
      the same three ids as `ComposerPermissionPicker` (`plan`→`on`, `ask`→`off`,
      `auto`→`auto`). Tool-rule presets, if they ship in this phase, are a
      separate function in `src/shared/permissions/presets.ts`. Tests must show
      that changing `planMode` does not rewrite tool rules, and that a hand-edited
      rule list reports `custom` without changing `planMode`. "Manage
      permissions" rows with counts drill into today's `PermissionSettings`,
      `PermissionFilesystemRules`, and `ConnectorAccessControls`.
   2. **Models.** A Default model card; a Connected providers list; *Add provider*
      drill-in (a searchable version of today's provider list); Advanced containing
      `ModelRoutingSection`, media defaults, `AgentRuntimeSettings`, and custom
      models. Split `ModelSettings.tsx` in this phase, then lower its allowlist
      `current`.
   3. **Connectors.** Build on the platform V2 `ConnectorsTab`, which is what
      ships by default (`CONNECTOR_PLATFORM_V2_ENABLED`). Restyle
      `ConnectorCatalogGrid` into Connected and Available lists with filter chips.
      `ConnectorDetailDrawer`'s sections become the per-connector drill-in page.
      Advanced holds `ComposioApiKeyCard` and *Use your own OAuth app*
      (`OAuthCredentialsForm`, today inside `SlackConnectionSection` and
      `CloudStorageProviderSection`). Cloud storage and publish destinations merge
      into the list. Keep the V2 README's safety rules (never render the raw
      Composio key, channel scopes stay per surface). The legacy
      `ConnectorSettings.tsx` stays on the flag-off path and is not restyled.
   4. **General**, **Data controls**, **Memory**, **Messaging channels**,
      **Secure store**, **Agents & skills**, and **Help & about**, per the 02 §5.1 table.
      Split `WorkplaceSettings.tsx`: the sandbox radio group becomes its own
      component on *Permissions*; working directory and log path stay under
      `workplace` on *Data controls*.
6. **Library cleanup.** The Installed and Marketplace tabs move to *Agents & skills*,
   and Publish moves to *Connectors*. Until phase 4, Library keeps a Files tab for
   cloud-storage browsing so that content does not disappear. Old tab query values
   (`plugins`, `marketplace`, `publish`, `cloud-storage`) redirect. `graph` stays
   until phase 8 decides where Knowledge Graph lives. Do not delete
   `CloudStorageLibraryTab` in this phase. Move the connector-setup portion only.

**Tests:**

- `src/__tests__/settings/category-map.test.ts` (new directory): every
  `SettingsCategory` resolves, and every `open-settings` `detail` string used in
  `src/` resolves. Today those are `keyboard`, `skills`, `mcp`, and `connector`;
  keep the fixture grep-driven so new call sites are covered.
- Preset unit tests against `ComposerPermissionPicker`'s three supported ids.
- Playwright: extend `tests/e2e/specs/settings.spec.ts` with a flag-on block. Change the default model in 2 clicks, connect-flow
  entry in 2 clicks, search "mcp" and land on MCP servers, Esc returns to the same page
  and scroll position.

**Checkpoint 3:** with the flag on, all 27 categories are reachable in two steps or
fewer. Allowlist `current` for `ModelSettings.tsx` is lowered after the split.
Screenshots of all 10 pages in light and dark are attached.

## Phase 4: App shell v2 (L)

0. **Shared layout route (unflagged, first).** Add a pathless `AppShellLayout`
   route under `AppRouteProviders` in `src/app/router.tsx` that renders
   `SidebarProvider`, the shell, and an `<Outlet />` for the page. Keep
   `RouteViewTransition` around the page outlet only. Remove the per-page
   `SidebarProvider` + `LeftSidebar` from the 15 pages that render it. Pages
   that must stay chromeless (`video-render-host`, `setup`, `quickstart`,
   Design Mode's own layout) stay outside the layout route. Pages that pass
   per-page props to `LeftSidebar` today (`currentTaskId`, running ids,
   delete and favorite handlers) move them to the shell's context or to the
   0.2 task source. Test: navigating Home → Library → task does not re-mount
   the sidebar (a mount counter in a unit test, plus the existing
   `navigation.spec.ts`). Then:
1. **Slot shortcuts (unflagged).** Move the `mod+${shortcutSlot}` registration
   out of `ModeSwitcher` into `useModeSlotShortcuts()`, called once by the shell,
   so ⌘1…⌘n do not depend on `ModeSwitcher` being rendered.
2. `src/components/layout/rail/`: `AppRail.tsx`, `RailItem.tsx` (tooltip, badge dot,
   active pill), and `RailMenu.tsx` (≡ menu, reusing `UserAccountMenu` items).
   Settings in that menu dispatches `open-settings`. It does not reimplement the modal.
3. `ContextPanel.tsx` hosts per-destination content from `ModeRegistry`
   (`sidebar.sections` and recents render inside it). Add `railItem` metadata to
   `ModeDefinition` (`src/shared/modes/types.ts`) so Design and Video appear under
   *Studios* without shell edits. Keep today's `shortcutSlot` values: tasks 1,
   design 2, automate 3, chat 4, video 5.
4. **Panel state machine** (`src/shared/layout/panelState.ts`): states A, B, and C,
   per-destination memory in `Settings.ui.panelState`, ⌘B cycles, ⌘. hides or
   restores, and narrow-width defaults. It is unit-tested as a reducer. Today's
   ⌘B is `sidebar.toggle` in `SidebarShell` and only calls `toggleLeft`. Replace
   that handler when the flag is on. Leave it in place when the flag is off.
5. **Home panel groups:** Needs you (the pending approval from the phase 2 card),
   Pinned (favorites), and Recent. `/approvals` and `/dashboard` stay as routes
   and are opened from the badge and the ≡ menu.
6. `SidebarShell.tsx` switches on the flag. `ModeSwitcher` is kept for the flag-off
   path and deleted in Phase 8.
7. Keep at most the last three rail destinations in
   `<Activity mode="hidden">` from `react` (19.2+, this app is `^19.3.0`).
   `hidden` keeps DOM and state and unmounts effects. Do not mount Design or
   Video canvases inside Activity. Unmount them. A hidden canvas is still
   in the document. Pages with media or iframe previews pause them in a
   `useLayoutEffect` cleanup, because hidden DOM keeps playing.

**Tests:** reducer unit tests; Playwright `tests/e2e/specs/shell-v2.spec.ts` covering ⌘1…⌘n, the ⌘B
cycle, ⌘. restore, badge dot on a pending approval, and scroll preserved when leaving
Library and returning.

**Checkpoint 4:** with the flag on, every current nav target is reachable. The
`left-sidebar` and `sidebar-shell` files stay within the size limit.

## Phase 5: Docked chat and side chats (L)

Resolve open question 1 at the start of this phase. The recommendation is to
keep `/chat` as a redirect to Home with the dock open, and to leave `shortcutSlot`
4 unused rather than renumbering design, automate, and video.

1. `src/components/chat-dock/`: `ChatDock.tsx` (thread + composer, resizable 320–560
   px, width stored in `Settings.ui`), and `ContextChip.tsx`. The dock occupies the
   context panel from phase 4. It is not a second column beside it.
2. Reuse the task thread renderer (`GroupedMessageList`, `TaskV2MessageBubble`) and
   the shared `ChatInput`. The dock is a view of a task id, with no new storage.
3. `usePageContext()` lets pages register what they show (a Library item, an
   automation, an artifact). The chip attaches that context through the composer's
   existing attachment and reference path.
4. *Ask about this* actions on Library items, artifacts, and automations create a task
   with the context attached, titled after the item. These are side chats.
5. Shortcuts: `mod+j` with `preventDefault()` (Ctrl+J is Chrome's Downloads
   shortcut on Windows and Linux; ⌘J is free on macOS, where Downloads is ⌘⇧J)
   and ⇧Esc to focus the composer. On the desktop build, also add `mod+n` for a
   new task; browsers reserve ⌘N/Ctrl+N, so the web build does not bind it.
   "Open full view" navigates to `/task-v2/:id` with a named view transition on the
   thread. Do not pass `viewTransition: true` to `navigate`. `RouteViewTransition`
   already owns `document.startViewTransition()`.

**Tests:** unit for `usePageContext`; Playwright `tests/e2e/specs/chat-dock.spec.ts` covering open on
Library, sending with the chip, removing the chip, persistence across a route change,
and full-view expansion. Streaming reuses the existing contracts, so no API change is
expected (verify in review).

**Checkpoint 5:** a conversation continues while the user navigates three pages, and
the context chip's payload is visible in the created task.

## Phase 6: Ideas gallery and simple home (M)

The rail from phase 4 has a slot for `/ideas`. The dock from phase 5 is what
automation setup opens. Do not build this page before both exist.

1. `src/shared/ideas/`: a typed `IdeaDefinition`
   (`id, categoryKey, promiseKey, howKey, icon, action: prefill | scoping | nav, requires?: connector | schedule`)
   and a registry seeded from `taskStarterChips`, the `QuickActions` `CATEGORY_ITEMS`,
   and the template library. Modes can register ideas.
2. `/ideas` page with grouped rows and the ⋯ menu (Let's do it / More like this / Not
   interested → `Settings.ui.ideasFeedback`).
3. `ScopingCard.tsx`: at most 3 questions with prefilled defaults (enforced by type:
   a tuple of up to 3).
4. Home: one suggestion row (top 3 by recent use and feedback) plus *More ideas →*.
   The composer gets a single **+** menu, an Agent chip (profile and model), and the
   existing `ComposerPermissionPicker` as the autonomy chip. It keeps writing global
   `planMode`. A per-task override is not part of this phase.
5. Automations page restyle: Scheduled, Watching, and Paused lists plus *Create an
   automation* categories that open the phase 5 dock with a scoping card.

**Tests:** registry unit tests (unique ids, every key exists in all six locales);
Playwright `tests/e2e/specs/ideas.spec.ts` (Let's do it prefills and focuses, Not interested hides
after reload).

**Checkpoint 6:** `QuickActions.tsx` is deleted and the composer shows at most 5
visible controls.

## Phase 7: Unified onboarding (M)

Start this only after phases 3, 5, and 6. The first-idea step reads the phase 6
registry. The landing `planMode` is the phase 3 default (`'on'`, picker id
`plan`). The ⌘J coach mark is the phase 5 shortcut.

1. `src/app/pages/Onboarding.tsx` becomes the only flow, mounted at a new
   `/onboarding` route instead of inline in `SetupGuard`: Welcome → Install tools
   (only when `SetupGuard`'s dependency check fails; extract the check and
   install UI from `Setup.tsx` into `components/onboarding/InstallToolsStep.tsx`)
   → Connect a brain (with detection of Ollama, env keys, and CLI logins, reusing
   the `ProviderStep` and `ModelsStep` logic) → First idea → Home. It stays under
   the size limit by splitting steps into `components/onboarding/`.
2. Completing the flow does what QuickStart's skip path does today: create the
   default *General Helper* profile, `markQuickstartDone()`,
   `markFirstRunCompleted()`, and `seedDemoIfNeeded()`. Read `QuickStartWizard`
   for the exact order before moving it. Template → Personalize → Confirm leaves
   first run; profile templates stay reachable from *Agents & skills*.
3. `/setup` and `/quickstart` redirect into the matching step. `SetupGuard` keeps
   its checks and stops sending onboarded users to `/quickstart`. Existing users
   with `onboardingCompleted`, `onboardingVersion`, and `quickstart_step` already
   set never see the flow. A user stopped mid-QuickStart (`quickstart_step` set
   but not done) resumes at *First idea*. `DataSettings`' "run quickstart again"
   link (`navigate('/quickstart')`) goes to the new flow. Delete the unused
   `QuickStartWizard` step components and the Setup page body only after the
   redirects ship (read their references first).
4. One-time coach marks for ⌘K and ⌘J. Dismissal is a field on `Settings.ui`. The ⌘J mark ships only because phase 5 has already bound `mod+j`.

**Tests:** In a dev build under Playwright (`navigator.webdriver`),
`shouldBypassSetupGuardForAutomation()` makes all three `SetupGuard` checks
(dependencies, onboarding, quickstart) return done, so a fresh storage state
never reaches onboarding. Give the unified flow its own route (`/onboarding`,
the redirect target for `/setup` and `/quickstart`) so the spec can open it
directly. Do not weaken the bypass.

- Playwright `tests/e2e/specs/onboarding.spec.ts`: open `/onboarding`, reach a
  first task in 4 screens or fewer with the install step skipped, and check
  that `planMode` is `'on'` (picker id `plan`).
- Unit tests for the `SetupGuard` routing table: fresh, missing CLI,
  mid-quickstart, and fully onboarded. These cover the install step and the
  redirects, which Playwright cannot reach through the bypass.

## Phase 8: Rollout and cleanup (S)

1. Release N (PR into the epic branch; ships with the final epic PR): `simpleShell` is opt-in under *General › Advanced*, with a feedback link
   and a local counter of *Usage & activity* opens (no remote telemetry beyond what
   exists).
2. Release N+1 (PR into `main` after the epic lands): the default flips to `true`, with an opt-out kept for one release.
3. Release N+2 (PR into `main`): delete the flag-off paths (`ModeSwitcher`, safe because Phase 4
   step 1 moved the slot shortcuts, the full-screen settings
   layout, `StarterChips` if superseded, the old Library tabs), and remove their
   allowlist entries. Follow migrate-then-delete: no compatibility shims left behind.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Power users lose fast access to MCP, hooks, and routing | ⌘K indexes every settings row; the two-step reachability test; `advancedMode` opens Details and Advanced by default |
| Permission presets diverge from `planMode` or from tool rules | `planMode` writes stay on the picker mapping. Tool-rule writes are a separate tested function. *Custom* does not change `planMode` |
| ⌘J clashes with the browser Downloads shortcut on web | In-app scope only on web; the rail button is the primary entry |
| `<Activity mode="hidden">` keeps DOM for hidden pages, including canvases | Keep at most three destinations, and never mount Design or Video canvases inside Activity |
| Lifting the shell into a layout route breaks a page that relied on its own `LeftSidebar` props | Phase 4 step 0 lands alone, unflagged, with the mount-count test and `navigation.spec.ts`; list each page's props before removing them |
| Merging onboarding re-onboards existing users | Keep the three stored flags and their meaning; unit-test the `SetupGuard` routing table |
| Scope creep into Design and Video internals | Non-goal; they mount in the new shell unchanged |
| Locale drift across six languages | The validate gate plus the registry test that every Idea key exists in all locales |

## Open questions for review

1. Should *Chat* mode (`/chat`, `shortcutSlot` 4) be retired in favor of Home plus the
   dock, as muse.ai does with one main chat? Recommendation: yes. Keep the route as a
   redirect.
2. Does the Autonomy chip need a per-task `planMode`? Today
   `ComposerPermissionPicker` saves the global setting. Recommendation: v1
   keeps that global write. A per-task value needs a new field on the task
   and a backend read. Do not invent it by overloading `planMode: 'off'`
   as Autopilot.
3. Is *Usage & activity* (today's Dashboard) acceptable as a sheet rather than a page?

Resolved in review (2026-09-30): onboarding folds Setup and QuickStart in as
steps; Activity ships without undo, and turn-level rewind is a follow-up.
