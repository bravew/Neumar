# Video Mode editor surface redundancy

Status: checkpoints 1, 3, and 4 landed; 2 and 5 outstanding
Date: 2026-08-26
Scope: the project editor at `/video/:id` (`ProjectEditor` and its mounted surfaces)

## Decision

Keep the five editor steps as the only navigation because they map one-to-one to
real canvases:

`Brief → Storyboard → Plan → Generate → Preview`

Workflow stages remain useful as derived progress, but they must not be a second
interactive route through the same canvases. Replace the six clickable stage
pills with a compact, non-navigational progress summary and primary action.

Apply one ownership rule throughout the editor:

> A fact has one active editor. Other appearances are short, read-only links to
> that editor. A panel is mounted once in the active layout.

This is narrower and safer than rebuilding the editor around the six workflow
stages. The existing five-step model already owns the canvases, tests, URLs, and
handoffs. Making stages primary navigation would require inventing separate
Assets and Export canvases and splitting Storyboard from Plan inside one stage.

## Verification status

### Source audit

The current worktree was inspected on 2026-08-26. It contains uncommitted Video
Mode work, so this plan describes the files as they exist now and must not be
implemented from an older commit without re-auditing them.

The Graphify report requested by the repository instructions is not present at
`graphify-out/GRAPH_REPORT.md`; source navigation was used instead.

Six focused baseline test files pass: 23 tests total.

```bash
pnpm vitest run \
  src/__tests__/ProjectStepper.test.tsx \
  src/__tests__/CreativeWorkflowHeader.test.tsx \
  src/__tests__/video/workflowStepSelection.test.ts \
  src/__tests__/video/generateSceneStatus.test.ts \
  src/__tests__/video/previewViewMode.test.tsx \
  src/__tests__/video/ProjectTemplateField.test.tsx
```

### Live UI

Chrome verification of
`/video/24d71ea5-5fef-409a-a433-8c820e0e8b0c?step=brief&stage=assets`
was completed on 2026-08-26 at the normal desktop viewport and at 1200×800.

The live editor confirms:

- The five editor tabs and six clickable workflow stages render as two
  competing navigation rows. Brief is the selected canvas while Assets is the
  selected workflow stage.
- Asset totals appear in the workflow summary (`48 assets, 1 generated`), the
  Brief summary card (`48 assets`), and the open Assets rail (`48`).
- Product intent is an editable control on the Brief canvas while the rail's
  Brief panel provides the second editor identified in the source audit.
- “Start from a template” and the complete HTML video engine/template gallery
  are expanded on this footage project. The “Create an HTML video” button
  scrolls to content that is already mounted.
- At 1200×800, the stage row crowds the header and the expanded HTML template
  preview dominates the canvas between persistent navigation and the Assets
  rail. This validates testing tertiary-panel collapse at narrower desktop
  widths.

## Corrected findings

### 1. Preview does not currently mount `AssetsRail` twice

`StepPreviewCanvas` owns a dedicated `AssetsRail` column and a
`PreviewInspectorPanel`. `EditorRightColumn` passes both `hideAssetsTab` and
`hideInspectorTab` to `SideRail` on Preview, so the corresponding rail tabs are
not rendered while the dedicated columns are active.

The previous draft's claim that two `AssetsRail` instances appear
simultaneously is stale. Removing the dedicated Preview columns would reverse a
deliberate layout decision and is not part of this fix. Add a regression test
for the existing exclusivity instead.

### 2. Brief still has duplicate editors and read-only echoes

`ProjectTemplateField` is mounted both in `StepBriefCanvas` and in the rail's
`InputsPanel`, so Product intent has two active editors. Script and prompt are
edited in `InputsPanel` and repeated as dead read-only blocks on the canvas.
Script and asset counts are also repeated without taking the user to their
owner.

The Brief canvas should summarize readiness and route to the rail. The rail's
Brief and Assets tabs should own these edits.

### 3. Three different concepts use “template” language

They are not the same data:

| Concept | Current component | Meaning | Target label |
| --- | --- | --- | --- |
| Product intent | `ProjectTemplateField` | Agent skills, duration ceiling, and planning assumptions | **Product intent** |
| Project starter | `TemplateInlinePicker` | Applies a reusable project recipe/preset | **Project preset** |
| HTML appearance | `HtmlTemplateSection` | HTML engine gallery and variables | **HTML design template** |

Product intent is already updated in all six locales. Project preset and HTML
design template still need consistent terminology in those locales, and the
latter two controls need progressive disclosure so they do not dominate every
Brief.

### 4. Two interactive journey models compete

`ProjectStepper` renders five canvas tabs. `CreativeWorkflowHeader` renders six
clickable stages. The mapping is necessarily lossy:

| Workflow stage | Canvas | Additional state |
| --- | --- | --- |
| Intent | Brief | Brief rail |
| Assets | Brief | Assets rail |
| Plan | Storyboard or Plan | Derived `sourceStep` |
| Generate | Generate | — |
| Review | Preview | Preview view |
| Export | Preview | Output view |

The URL parameter `stage` currently carries three unrelated responsibilities:
highlighting a progress pill, opening Assets, and selecting Preview versus
Output. This is why `?step=brief&stage=assets` needs both rows to explain one
screen.

`ProjectStepper` also sets `aria-current="step"` from the derived progress step
instead of the canvas actually displayed. A user can see Storyboard selected
while assistive technology reports Plan as current.

### 5. Generation reports render status

`StepGenerateCanvas` correctly derives scene rows from `clip-gen` jobs through
`generateSceneStatuses`, but its header badge and progress bar still read
`project.render.status` and `project.render.progress`. The Generation queue can
therefore say `idle` while generation jobs are queued or running.

Render state belongs in Preview/Output. Generation needs an aggregate derived
from its job-backed scene states.

### 6. HTML authoring is shown without project intent

`StepBriefCanvas` always mounts both the generic project-preset picker and
`HtmlVideoPanel`. The button labelled “Create an HTML video” only scrolls to an
already-visible panel. A normal footage project therefore pays the layout and
loading cost of an advanced authoring surface it did not request.

## Target ownership model

| Fact or capability | Active owner | Allowed reference |
| --- | --- | --- |
| Current editor location | `ProjectStepper` + `?step=` | None; only one item uses `aria-current="step"` |
| Workflow completion | Compact Video progress summary | Status only; pills are not clickable |
| Script, prompt, Product intent | `InputsPanel` on rail `brief` | Brief summary button opens that tab |
| Project assets outside Preview | `AssetsRail` on rail `assets` | Brief asset summary opens that tab |
| Assets in Preview | Dedicated `StepPreviewCanvas` column | Rail Assets tab is hidden |
| Selection inspection in Preview | `PreviewInspectorPanel` | Rail Inspector tab is hidden |
| Selection inspection elsewhere | Side rail Inspector tab | No canvas inspector |
| Preview versus rendered file | `?view=preview|output` on Preview | Preview toggle |
| Project preset | Collapsed “Start from a project preset” section | None |
| HTML authoring | Explicit HTML action or an existing HTML scene | None on ordinary projects |
| Generation status | Aggregate of `clip-gen` scene/job states | Render status is not consulted |

“One owner” is evaluated per active layout. Preview can own Assets while other
steps use the rail, provided only one instance is available at a time.

## URL contract

Use URL keys that name the UI state they control:

```text
?step=brief&rail=assets
?step=preview&view=output
?step=brief&html=1
```

- `step` selects the only navigational canvas.
- `rail` opens the side rail on a valid tab for that canvas.
- `view` selects Preview or Output and is valid only for `step=preview`.
- `html=1` explicitly reveals and focuses HTML authoring.
- `stage` is **removed outright**. This is a new application with no installed
  base, so old links are allowed to break rather than carrying a translation
  layer and a second representation of every screen through browser history
  (decision: 2026-08-26).
- Invalid combinations fall back safely: unknown rail tabs are ignored, and
  `view=output` outside Preview is dropped.

## Implementation plan

### Checkpoint 1 — Pin the ownership and route contracts

Files/subsystems:

- `src/components/video/workflowSelection.ts`
- new `src/components/video/editorLocation.ts`
- `src/components/video/EditorRightColumn.tsx`
- new `src/__tests__/video/editorSurfaceOwnership.test.tsx`
- new `src/__tests__/video/editorLocation.test.ts`

Work:

- Add a pure parser/normalizer for `step`, `rail`, `view`, `html`, and legacy
  `stage`. Keep URL translation out of rendering components.
- Characterize the current Preview invariant: its dedicated Assets and
  Inspector owners suppress the equivalent side-rail tabs.
- Test invalid and legacy URLs before changing navigation.

Observable result: route state has one canonical representation, and Preview's
existing one-instance rule is protected.

Verification:

```bash
pnpm vitest run \
  src/__tests__/video/editorLocation.test.ts \
  src/__tests__/video/editorSurfaceOwnership.test.tsx \
  src/__tests__/video/previewViewMode.test.tsx
```

### Checkpoint 2 — Make Brief a routed summary, not a second form

Files/subsystems:

- `src/components/video/StepBriefCanvas.tsx`
- `src/components/video/ProjectEditorCanvasPanel.tsx`
- `src/components/video/ProjectEditor.tsx`
- `src/components/video/InputsPanel.tsx`
- `src/components/video/TemplateInlinePicker.tsx` →
  `src/components/video/ProjectPresetPicker.tsx`
- `src/config/locale/messages/{en,zh,es,fr,hi,pt}/video.ts`
- new `src/__tests__/video/StepBriefCanvas.test.tsx`

Work:

- Keep the sole `ProjectTemplateField` editor in `InputsPanel`; replace the
  canvas instance with a Product intent summary button.
- Replace the prompt/script text blocks with concise summary buttons. Script,
  prompt, and Product intent open `rail=brief`; Assets opens `rail=assets`.
- Do not add an undefined “Output target” card. The project model has no single
  output-target field today.
- Rename `TemplateInlinePicker` to `ProjectPresetPicker`, migrate all imports,
  and rename user-facing “Start from a template” to “Start from a project
  preset.” Put the preset picker behind that explicit disclosure.
- Render `HtmlVideoPanel` only when `html=1` or the project already contains an
  HTML-backed scene. The HTML action sets `html=1`; it must reveal content, not
  scroll to content that was already present.
- Preserve the Product intent lock/confirmation behavior.

Observable result: every Brief summary is either actionable or omitted; Product
intent has one editor; ordinary footage projects do not mount HTML authoring.

Verification:

```bash
npx oxfmt \
  src/components/video/StepBriefCanvas.tsx \
  src/components/video/ProjectEditorCanvasPanel.tsx \
  src/components/video/ProjectEditor.tsx \
  src/components/video/InputsPanel.tsx \
  src/components/video/ProjectPresetPicker.tsx \
  src/config/locale/messages/{en,zh,es,fr,hi,pt}/video.ts
pnpm vitest run \
  src/__tests__/video/StepBriefCanvas.test.tsx \
  src/__tests__/video/ProjectTemplateField.test.tsx \
  src/__tests__/video/HtmlVideoPanel.test.tsx
pnpm check:locale-parity
```

### Checkpoint 3 — Leave one navigation control

Files/subsystems:

- `src/components/video/ProjectStepper.tsx`
- `src/components/video/ProjectEditor.tsx`
- `src/components/video/VideoWorkflowHeader.tsx` (replace with a compact
  `VideoWorkflowSummary.tsx`)
- `src/components/video/useWorkflowStepSelection.ts` (delete after callers are
  migrated)
- `src/components/video/workflowSelection.ts`
- `src/__tests__/ProjectStepper.test.tsx`
- `src/__tests__/video/workflowStepSelection.test.ts`
- new `src/__tests__/video/VideoWorkflowSummary.test.tsx`

Work:

- Keep `ProjectStepper` interactive and remove click navigation from the six
  workflow stages.
- Replace the stage row with a compact summary: completed-stage count, current
  derived workflow status, and the existing primary action. It must not resemble
  or behave like a second stepper.
- Set `aria-current="step"` on the displayed editor step only. Do not use
  derived progress as the current location.
- Drive rail and Preview/Output state from the canonical URL contract. Remove
  `selectedVideoWorkflowStep` and `useWorkflowStepSelection` once no caller
  needs stage selection.
- Keep `CreativeWorkflowHeader` unchanged for other product modes unless their
  requirements independently call for a redesign.

Observable result: one control answers “where am I?” and one compact status
surface answers “how far along is the project?”

Verification:

```bash
npx oxfmt \
  src/components/video/ProjectStepper.tsx \
  src/components/video/ProjectEditor.tsx \
  src/components/video/VideoWorkflowSummary.tsx \
  src/components/video/workflowSelection.ts
pnpm vitest run \
  src/__tests__/ProjectStepper.test.tsx \
  src/__tests__/video/workflowStepSelection.test.ts \
  src/__tests__/video/VideoWorkflowSummary.test.tsx \
  src/__tests__/ProjectEditor.conversation-route.test.tsx
```

### Checkpoint 4 — Give Generation its own aggregate status

Files/subsystems:

- `src/components/video/generateSceneStatus.ts`
- `src/components/video/StepGenerateCanvas.tsx`
- `src/__tests__/video/generateSceneStatus.test.ts`
- new `src/__tests__/video/StepGenerateCanvas.test.tsx`
- all six Video locale files if aggregate labels are added

Work:

- Add a pure aggregate derived from `GenerateSceneStatus[]`, with explicit
  precedence for attention/error, running, queued, awaiting approval,
  complete, and nothing-to-generate states.
- Render that aggregate in the Generation header. Remove the render progress
  bar and render-status badge from this canvas.
- Keep render status and progress in Preview/Output, where the render controls
  live.

Observable result: queued/running generation never displays `idle`, and a
completed generation queue does not imply that the final render is complete.

Verification:

```bash
npx oxfmt \
  src/components/video/generateSceneStatus.ts \
  src/components/video/StepGenerateCanvas.tsx \
  src/__tests__/video/generateSceneStatus.test.ts \
  src/__tests__/video/StepGenerateCanvas.test.tsx
pnpm vitest run \
  src/__tests__/video/generateSceneStatus.test.ts \
  src/__tests__/video/StepGenerateCanvas.test.tsx
```

### Checkpoint 5 — Integrated visual, accessibility, and repository gate

Files/subsystems:

- `dev-doc/runbooks/video-mode.md`
- tests from checkpoints 1–4
- only source files changed by this plan

Inspection matrix:

1. Open the legacy issue URL. Confirm it canonicalizes to
   `?step=brief&rail=assets`, shows one navigation row, and opens Assets.
2. On Brief, activate Script, Prompt, Product intent, and Assets summaries.
   Confirm each focuses its one owner and keyboard focus remains visible.
3. Confirm “Start from a project preset” and “Create an HTML video” reveal only
   their own controls.
4. On Preview with the rail open and closed, confirm exactly one Assets editor
   and one Inspector are available, drag-to-timeline still works, and the
   dedicated panels collapse at narrow widths.
5. Confirm `?step=preview&view=output` opens Output and survives reload.
6. Exercise Generation with no generative scenes, awaiting approval, queued,
   running, failed, and complete jobs.
7. Repeat at a full desktop window and common half-/third-width desktop window
   sizes. Prefer collapsing tertiary inspector columns before compressing the
   primary canvas below a usable width.

Verification:

```bash
pnpm test:fast
pnpm validate
```

Observable result: the source, URL, keyboard/accessibility semantics, responsive
layout, and live editor all satisfy the ownership table.

## Throughput and sequencing

1. **Blocking first step:** checkpoint 1. URL semantics and ownership tests must
   land before Brief and navigation both start writing editor selection state.
2. **Independent workstreams:** after checkpoint 1, Brief/HTML work (checkpoint
   2) and Generation status work (checkpoint 4) touch disjoint components and
   can proceed in parallel.
3. **Shared mutable state:** checkpoints 2 and 3 both touch `ProjectEditor.tsx`,
   route parameters, and locale keys. Merge checkpoint 2's routing callback
   before checkpoint 3 removes the old stage-selection path, or serialize them.
4. **Smallest safe decomposition:** five checkpoints. Each has an observable UI
   result and a focused test command; no catch-all regression phase is deferred
   to the end.

## Explicit non-goals

- Do not remove the dedicated Preview Assets or Inspector columns in this fix.
- Do not make the editor layout user-customizable.
- Do not create six new canvases merely to make workflow stages map one-to-one.
- Do not change the shared `CreativeWorkflowHeader` behavior for other modes.
- Do not remove the Product intent lock without replacing the server-side
  duration and storyboard-validity protections.
- Do not redesign the render pipeline, generation job model, or agent plan
  status as part of a surface-ownership cleanup.

## Best-practice basis

- [W3C ARIA technique for `aria-current`](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA26): identify the one current item in a related set. This supports making the displayed canvas, not derived progress, the current step.
- [WAI-ARIA 1.3 `aria-current` definition](https://www.w3.org/TR/wai-aria-1.3/#aria-current): authors should mark only one element in a set as current and should not substitute current state for widget selection semantics.
- [Apple Human Interface Guidelines — Layout](https://developer.apple.com/design/human-interface-guidelines/layout): test resizable layouts at common window sizes and hide tertiary inspector columns as width narrows.
- [Apple Human Interface Guidelines — Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars): sidebars consume substantial space, should remain hideable, and should represent a clear hierarchy rather than duplicate the primary content.
- [Nielsen Norman Group — Enhancement](https://www.nngroup.com/articles/enhancement/): progressive disclosure starts with core features and reveals advanced or infrequent features when needed. This supports gating project presets and HTML authoring behind explicit actions.

## Readiness gate

The source audit, focused tests, and live Chrome baseline agree. The plan is
concrete enough to execute one checkpoint at a time; begin with checkpoint 1.

## Related work

- `dev-doc/video-mode/16-08-25-native-execution-and-durable-plans/` — durable
  plan and execution-log status, intentionally out of scope here.
- `dev-doc/runbooks/video-mode.md` — update after navigation and URL migration
  land.
