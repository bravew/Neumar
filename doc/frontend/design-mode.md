---
summary: "DesignMode frontend architecture — /design route, entry galleries, project workspace, preview modes, settings, and hooks"
read_when:
  - Working on the DesignMode UI
  - Adding a DesignMode tab, modal, preview mode, or project workflow
  - Debugging DesignMode settings, catalogs, or project API calls from React
title: "DesignMode Frontend"
---

# DesignMode Frontend

The DesignMode frontend is the React workspace at `/design`. It provides a focused
creation UI for local design projects while reusing the app shell, settings, i18n,
theme tokens, and API client conventions.

## Source Map

| Area                                   | Source                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| Route entry                            | `src/app/pages/DesignMode/index.tsx`                       |
| Entry workspace                        | `src/components/design/EntryView.tsx`                      |
| Entry intent sidebar                   | `src/components/design/DesignEntrySidebar.tsx`, `src/components/creative/CreativeIntentEntry.tsx` |
| Entry tab router                       | `src/components/design/EntryTabContent.tsx`                |
| New project form                       | `src/components/design/NewProjectPanel.tsx`                |
| Project workspace                      | `src/components/design/ProjectView.tsx`                    |
| Project workflow header                | `src/components/design/ProjectViewWorkflowHeader.tsx`, `src/components/creative/CreativeWorkflowHeader.tsx` |
| Project header                         | `src/components/design/ProjectHeader.tsx`                  |
| Project chat sidebar                   | `src/components/design/ProjectChatSidebar.tsx`             |
| Discovery questions                    | `src/components/design/DesignQuestionsPane.tsx`            |
| File and asset workspace               | `src/components/design/FileWorkspace.tsx`                  |
| File preview/source/inspect/comment/edit/draw modes | `src/components/design/FileViewer.tsx`           |
| File tab strip                         | `src/components/design/FileTabStrip.tsx`                  |
| Quick file switcher                    | `src/components/design/QuickFileSwitcher.tsx`             |
| Export drawer and PDF fallback         | `src/components/design/ExportsDrawer.tsx`, `pdf-print.ts` |
| Design Jury result card                | `src/components/design/critique/DesignJuryCard.tsx`        |
| Design system preview                  | `src/components/design/DesignSystemPreviewModal.tsx`       |
| Design-system registry import/share    | `src/components/design/DesignSystemRegistryImportDialog.tsx`, `DesignSystemShareMenu.tsx` |
| Catalog sort toggle                    | `src/components/ui/catalog-sort-toggle.tsx`, `src/shared/utils/catalog-sort.ts` |
| Prompt template preview                | `src/components/design/PromptTemplatePreviewModal.tsx`     |
| Finalization / handoff                 | `src/components/design/useDesignProjectFinalizer.ts`, `DesignHandoffMenu.tsx` |
| DesignMode API hook layer              | `src/shared/hooks/useDesignMode.ts`                        |
| Design chat hook                       | `src/shared/hooks/useDesignChat.ts`                        |
| Shared frontend types                  | `src/shared/types/design-mode.ts`                          |
| Settings tab                           | `src/components/settings/tabs/DesignModeSettings.tsx`      |
| Locale messages                        | `src/config/locale/messages/*/design.ts` and `settings.ts` |

## Route Guard

`DesignModeRoute` renders:

- `/design` as the entry gallery and new-project surface.
- `/design/:projectId` as a project workspace.

The route is available only when both conditions are true:

1. `DESIGN_MODE_ENABLED` is true at build/runtime.
2. `settings.designMode.enabled` is true.

If disabled, the route redirects to `/`.

## Entry Workspace

`DesignEntryView` uses a two-column layout:

- Left sidebar: brand header, surface tabs, new project form, import action, and local
  dispatcher footer.
- Main area: catalog and project tabs.

Entry tabs are:

| Tab             | Component            | Purpose                                            |
| --------------- | -------------------- | -------------------------------------------------- |
| Designs         | `DesignsTab`         | Existing local DesignMode projects                 |
| Examples        | `ExamplesTab`        | Example projects derived from bundled skills       |
| Design systems  | `DesignSystemsTab`   | Design system catalog with showcase/tokens preview |
| Image templates | `PromptTemplatesTab` | Image prompt templates                             |
| Video templates | `PromptTemplatesTab` | Video prompt templates                             |
| Skills          | `SkillsTab`          | DesignMode skills that can seed projects           |
| Routines        | `RoutinesTab`        | Scheduled DesignMode routines                      |

All gallery tabs expose search and filter controls through `GalleryFilters`.

## New Project Flow

`DesignEntrySidebar` now starts with the shared creative intent picker. The
intent choices are `design`, `video`, `image`, `audio`, `assets`, `template`, and
`import`; DesignMode disables `assets` and `import` on this route, routes enabled
Video intent to `/video`, opens the template tabs for template intent, and
creates DesignMode projects directly for design/image/audio intents.

`NewProjectPanel` still supports the detailed DesignMode top-level surfaces:

`document`, `prototype`, `deck`, `template`, `media`, `campaign`, and `other`
(normalized to `prototype`). When `media` is selected, `MediaSurfacePicker`
chooses the concrete `image`, `video`, or `audio` project surface.

The form lets users choose:

- project name and brief
- active design system
- inspiration design systems
- prompt template for image/video surfaces
- media model, aspect, duration, audio kind, and voice where applicable
- prototype fidelity
- deck speaker notes
- project location, when additional DesignMode project roots are configured

Creation calls `createDesignProject()` and navigates to `/design/<projectId>`.

## Catalog Previews

Design systems open in `DesignSystemPreviewModal`. The modal provides:

- a `Showcase` tab with a generated product-style preview based on parsed design tokens
- a `Tokens` tab with palette, typography, spacing, and raw token lists
- a `DESIGN.md` source pane
- fullscreen, share/copy, and "use as default" actions

Design-system catalog cards can install or uninstall packs when the record is
not built in. Workspace systems support local grouping and rename flows.
`DesignSystemRegistryImportDialog` imports shadcn registries, while the DTCG
import path accepts token documents. `DesignSystemShareMenu` can export or copy
tokens, open a generated showcase, and produce handoff formats such as PDF, ZIP,
HTML, image, or a new browser tab depending on the selected action.

`DesignSystemsTab` keeps curated order by default. When at least one design-system
record has a parseable `updatedAt`, `createdAt`, or `installedAt` timestamp, it
shows `CatalogSortToggle` with `curated` and `newest` options. The selected order
is stored best-effort in `localStorage` under a per-catalog key. `sortByNewest()`
is stable: timestamped records sort newest-first, while records without timestamps
keep their incoming curated relative order.

Prompt templates open in `PromptTemplatePreviewModal`, which fetches full prompt detail
only after a card is selected. This keeps the gallery lightweight while allowing the
modal to show the complete prompt before project creation.

Skills open in `SkillSourceModal`, which shows the skill source and can create a
project from that skill.

## Project Workspace

`DesignProjectView` has the shared creative workflow header plus three main
regions. `ProjectViewWorkflowHeader` derives the display state from the project
manifest and shows `Intent`, `Assets`, `Plan`, `Generate`, `Review`, and
`Export` as the product-facing steps. Its primary action opens the first output,
runs finalization, recovers from failure, or sends the current prompt depending
on project state.

The main regions are:

1. Header with editable title, surface badge, active design system badge, budget chip,
   disabled agent action, resolved prompt, debug drawer, gated Design Jury action, and
   regular-mode exit.
2. Resizable left rail with the editable brief, task progress cards, provider errors,
   remembered chat scroll position, chat transcript, Questions tab, and composer.
3. Main workspace with file tree, asset gallery, file viewer, comments, sketches, and exports.

The composer dispatches by surface. Image, video, and audio projects use
`startDesignMedia()` and poll `waitDesignMedia()` until `done`, `failed`, or
`cancelled`. Prototype, template, deck, document, and campaign projects use
`useDesignChat()` against `/design/projects/:id/chat`, streaming agent messages
into the project chat. Chat runs can be cancelled, carry prior turns as
conversation history, and auto-harvest the expected artifact after the agent
writes it.

Fresh chat-surface projects may first render an `AskUserQuestion` card in the
Questions tab. `DesignQuestionsPane` shows the form, a 90-second auto-continue
countdown, and a skip action that continues with defaults. Answers are formatted
as the next composer message and become part of the chat history before the build
turn starts.

Queued comment attachments are appended to the next composer prompt, then marked
as attached after a task starts. Active artifact/context chips keep the current
file or selection visible in the composer.

Design Jury status is fetched once from `/design/design-jury/status`. When enabled, the
header shows a Design Jury button. `runDesignJury()` sends the first reviewable output path
from `firstReviewableArtifactPath(project)`, and `DesignJuryCard` renders the overall score,
role scores, up to three must-fix items, and the summary path.

The header also exposes finalization and handoff actions. The finalizer generates
or refreshes `DESIGN.md` and reports whether it is stale because files or
conversation history changed. `DesignHandoffMenu` can open the project directory
in an allowlisted editor/file manager, copy the absolute path, or copy `cd`,
`cd && claude`, and `cd && codex` commands for CLI continuation. Failed editor
handoffs surface the backend error text in a toast so missing apps, blocked
paths, or launcher errors are visible to the user.

## File Viewer Modes

`FileViewer` chooses modes from file type:

| File type           | Modes                                |
| ------------------- | ------------------------------------ |
| HTML                | preview, source, inspect, comment, edit, draw |
| Text                | source, draw                         |
| Image, video, audio | preview, draw                        |
| Other binary        | preview placeholder                  |

HTML previews render through `HtmlSandbox`. Inspect, comment, and edit modes listen for
`data-neuma-id` target messages from the sandbox. Comment mode saves target-attached
comments; edit mode saves targeted instructions and can route validated manual patches
through the backend patch journal; inspect mode exposes local style controls for selected
preview nodes.

Source mode can save text files and run DesignMode lint. Draw mode persists sketch
overlays per active file. Preview mode supports device width selection and zoom for HTML,
images, video, and audio. Export opens `ExportsDrawer`.

`FileWorkspace` keeps recently opened files in a tab strip. Tabs can be reordered by drag,
and their order is persisted in `project.ui.fileTabs.order`. `Cmd/Ctrl+P` opens the quick
file switcher. Batch file deletion calls the backend soft-delete route and removes deleted
outputs from the asset gallery.

When PDF export cannot use Playwright or Pandoc, `ExportsDrawer` requests printable HTML
from `/design/projects/:id/export/pdf-input`. Desktop builds try the Tauri PDF save path
first and then fall back to the platform print dialog or browser iframe printing. The
iframe path waits for the embedded artifact's `neuma:print-ready` message and verifies
usable document dimensions before printing, then uses a timed fallback so malformed
artifacts do not leave the export flow spinning.

Export failures are normalized through `classifyExportError()` in
`src/shared/utils/export-error.ts`. The drawer keys recovery UI off stable codes
such as `dependency_missing`, `export_blocked_by_lint`, `attribution_blocked`,
`renderer_unavailable`, `snapshot_timeout`, `capture_failed`, `webcodecs_encoder`,
`invalid_input`, and `network`, while still displaying the specific backend message.

## Settings

`DesignModeSettings` manages:

- feature enable/disable
- default AI disclosure behavior
- strict provider mode
- token sidecar injection for generated artifacts
- DesignMode chat loop enablement
- default design system id
- default DesignMode skill id
- additional DesignMode project locations
- project budgets for images, videos, audio, retries, and storage
- critique, telemetry, and media alias settings
- dependency status for renderers and local binaries

Dependencies are fetched from `/design/dependencies` and grouped as available, missing,
or not configured.

## Hook Layer

`src/shared/hooks/useDesignMode.ts` is the frontend API boundary. Components should call
these helpers instead of constructing `/design/*` URLs inline, except for stream/blob URLs
where helper functions already exist.

The hook layer wraps non-OK responses in `DesignApiError` when JSON error data is available.
Multipart import intentionally uses a direct `fetch()` because it must omit the JSON
`Content-Type` header.

## UI and i18n Rules

- All user-visible strings must come from `useLanguage()` and the six locale files.
- Use semantic theme classes such as `bg-background`, `text-foreground`, and
  `text-muted-foreground`.
- Keep DesignMode components under the project component size limit by splitting tab
  content and preview panels into dedicated files.
- Keep gallery cards keyboard and pointer accessible; cards that open previews should
  keep actions as real buttons.

## Tests

Current coverage includes:

- `src/__tests__/design-mode.test.tsx` for settings, create/import flows, API behavior,
  prompt composition, budgets, lint, exports, comments, sketches, and catalog helpers.
- `tests/e2e/specs/design-mode.spec.ts` for browser smoke coverage across surfaces,
  workspace controls, gallery filters, preview modals, default selection, and project
  creation from examples/templates/skills.

---

_See also: [Backend DesignMode](../backend/design-mode.md) · [Frontend Overview](index.md) · [Hooks & Utilities](hooks.md)_
