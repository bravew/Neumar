# Media download verification — epic #351

## Scope and reproducibility

The browser scenario is
[`media-download.spec.ts`](../../specs/media-download.spec.ts). With ports 3420
and 5126 free, run from the repository root:

```bash
pnpm --filter @neumar/video-ir build
pnpm exec playwright test tests/e2e/specs/media-download.spec.ts --project=chromium
```

The Playwright configuration supplies a temporary `NEUMAR_APP_DATA_DIR` to the
API and the fixture process. Do not opt into reusing an API that holds real user
data. The scenario uses a fake downloader and an original synthetic VP8 clip;
it does not download third-party media.

`run-batch.ts` creates the question, claims its destination grant, runs the
production runner through a direct fake-process runtime, and registers the
resulting asset. The browser submits the same option label through the real
question card. Playback uses the real API's task-scoped asset route.

The model loop and AG-UI transport are mocked. The fixture finishes before the
browser answers the question; captured progress and final history are replayed
into the browser. Accordingly, this test checks the pieces together but does
not prove that an actual HTTP resume starts a download only after browser
approval, that progress streams live through the agent transport, or that the
production process sandbox works. The cancellation case aborts the fixture's
controller; it does not click the task's Stop control.

## Recorded checks

On the integrated implementation at `979a28bb`:

- `pnpm validate`: passed, exit 0. This includes both new guard-test repairs.
- API typecheck including tests: passed with
  `pnpm --filter neumar-api exec tsc -p tsconfig.json --noEmit`.
- Focused migration and MCP tools-list guards: 50 tests passed after repair.
- `pnpm test src/__tests__/download-destination.test.tsx`: 10 tests passed
  after the native smoke.

Earlier integrated browser run: two Chromium scenarios passed against an
isolated API and frontend. The scenarios checked a saved file beside a failed
sibling, rendered intermediate progress, restored the card after reload,
seeking and advancing playback time, and a cancelled fixture publishing no file.

The earlier broad `pnpm test:fast` run failed the MCP factory enumeration guard.
That failure was fixed in `979a28bb`. The complete rerun on that head passed:
432 frontend files / 2,039 tests and 642 API files / 4,423 tests, with three API
files / six tests skipped (exit 0).

## Native folder picker — passed separately on macOS

After the user enabled Accessibility for Paseo, the existing debug Tauri shell
loaded a disposable smoke page and reported a native runtime. The page invoked
the same command as the download picker:

```ts
open({ directory: true, multiple: false });
```

AppleScript targeted only that debug app process. It navigated the actual native
folder panel to a permitted temporary output folder and confirmed it. The
returned path was posted to the epic's real `/downloads/destination` route,
mounted in an isolated Hono server with a temporary database and task. The route
returned HTTP 200 with the same canonical directory. Reopening the native panel
and pressing Escape returned `null`.

Observed report, with the temporary root abbreviated:

```json
{"kind":"loaded","detail":{"native":true}}
{"kind":"opening-selection","detail":null}
{"kind":"selected","detail":"<temporary-root>/output"}
{"kind":"checked","detail":{"status":200,"body":{"directory":"<temporary-root>/output"}}}
{"kind":"opening-cancellation","detail":null}
{"kind":"cancelled","detail":null}
```

This is a separate smoke of the native dialog and destination check, not a full
Task V2 click-through in a freshly built desktop bundle. The shell binary came
from the existing debug build; the epic changes no Tauri sources. No re-signing
or injection was used for the successful smoke. Temporary page, server, app
instance, and task data were removed afterward. The React picker tests cover
submitting a checked path, refusal handling, and browser-disabled behavior.

No integrated PR has been published. Include this native result and the browser
transport limitations above in its verification section when publication is
authorized.
