# FFmpeg Skill Runbook

The `ffmpeg` skill edits local video and audio through Neumar's managed
`ffmpeg-skill` MCP server. It is a pinned adaptation of
[kajisho5/ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill/tree/a991599bfe3f072bac3835083f8bbb30efcd9a99)
at package version `2.4.2`, contract version `1.0`, with 42 public tools.
Upstream engine ids stay `ffmpeg-skill/<tool>` and are not a second catalog
entry.

The app exposes three host tools, not the vendored 42:

| Tool | Purpose |
| --- | --- |
| `ffmpeg_skill_catalog` | List the 42 tools with their ids, roles, descriptions, and accepted structured argument names. It does not inject 42 schemas. |
| `ffmpeg_skill_check` | Report installed Python, FFmpeg, and ffprobe, and whether the host is ready. It does not probe per-tool filters or encoders, and it never installs or downloads anything. |
| `ffmpeg_skill_execute` | Run one structured operation through the host boundary (validation, path policy, supervision, staging, publication). |

This is not the upstream `mcp/server.py` process and not the native
`mcp__ffmpeg__*` tools, which keep their own executor and are untouched.

## Runtime requirements

Everything runs from installed host tools. Nothing is bundled or downloaded.

- Python 3.9 or newer, standard library only. The vendored scripts run under
  `python3` or `python`; a Windows Store alias is rejected.
- FFmpeg 5.0 or newer and ffprobe 5.0 or newer, resolved by the existing
  detector from `NEUMA_FFMPEG_PATH` / `FFMPEG_PATH` / `NEUMA_FFPROBE_PATH` /
  `FFPROBE_PATH`, then PATH, then common package-manager locations. A GUI
  launch that loses the shell PATH still finds Homebrew and MacPorts paths.

A missing interpreter or binary is an actionable `missing_runtime` failure, not
a reason to install software or claim success. A missing filter, font, or
optional encoder inside a supported operation is a `missing_tool` failure from
the vendored runner.

## Supported providers

| Provider | Transport |
| --- | --- |
| Claude | In-process SDK server |
| Codex | Loopback bridge |
| Cursor Agent | Loopback bridge |
| Kimi | Loopback bridge |

Every other provider has no host-factory attachment. When `ffmpeg` is selected
on one of them, the run yields a capability message instead of silently
dropping the selection. That message (`ffmpegSkillCapabilityMessage` in
`handoff.ts`) names the four supported providers. Kimi is feature-gated, so it
attaches only when the Kimi provider is enabled.

## Modes and output attribution

The skill is declared for `task`, `design`, and `video`, and chat-as-task runs
reuse the task attribution. Publication happens only after the runner reports a
completed, verified, non-preview artifact.

| Mode | Result goes to | Notes |
| --- | --- | --- |
| Task / chat-as-task | The task session `output/` directory, recorded as a task file | Requires a bound task id and work directory |
| Design | `assets/generated/` under the design project, appended as a project output | Does not flip the project to complete |
| Video | The video project assets directory, attached as a project asset | Records provenance only; never mutates the timeline |

The runner stages every write into a private per-run directory and refuses to
overwrite a source or an existing output. One mode's artifact cannot escape into
another mode's project or session.

## Verified on this host

From the media correctness pass ([#173](https://github.com/bravew/Neumar/issues/173))
on Python 3.14 and FFmpeg 9.0.2 (`/opt/homebrew`):

- `probe` reports real duration, fps, resolution, and codec.
- A stream-copy `cut` matches the requested range and leaves the source bytes
  unchanged (SHA-256 verified before and after).
- `crop` produces an output whose probed resolution matches the request.
- `loudness` measure-only returns a real finite measurement, not a placeholder.

## Host capability gaps

The installed Homebrew FFmpeg on this host omits four optional libraries, so
operations that need them fail with `missing_tool` until a full build is
installed:

| Missing library | Filter / encoder | Affected operations |
| --- | --- | --- |
| libfreetype | `drawtext` | Caption burn (drawtext route) |
| libass | `ass` | Subtitle burn (ASS route) |
| libzimg | `zscale` | HDR-to-SDR tone-map |
| libvidstab | `vidstab*` | Stabilization |

Fix with `brew install ffmpeg` selecting those variants, or any ffmpeg build
with `--enable-libfreetype --enable-libass --enable-libzimg
--enable-libvidstab`. Re-run `ffmpeg_skill_check` (and a representative
`ffmpeg_skill_execute`) to confirm the gaps are closed.

## Gated variants

The managed surface accepts structured arguments from the pinned contract but
rejects these variants with specific errors:

- Raw `argv`. Pass the structured arguments from the catalog entry instead.
- `caption` and `silence` `transcribe`. This would launch an optional local
  Whisper tool the host does not supervise. Supply a cue or word file instead.
- `batch --watch`. It keeps running after the call returns. Run the recipe once.
- Saved-plan replay. A plan carries raw commands the host does not revalidate.

`verify` does not support preview, and preview rejects any operation that would
write a deliverable.

## Troubleshooting

- Missing Python: `ffmpeg_skill_check` returns `python.available: false` with
  an action naming the candidates. Install Python 3.9+ from python.org.
- Missing FFmpeg or ffprobe: the check reports the missing binary. Install with
  `brew install ffmpeg` (macOS) or `apt install ffmpeg` (Linux), or set
  `NEUMA_FFMPEG_PATH` / `FFMPEG_PATH` (and `NEUMA_FFPROBE_PATH` /
  `FFPROBE_PATH`) to the binaries for a nonstandard install.
- Filter or encoder gaps: the operation fails with `missing_tool` and the
  missing dependency. See the capability gaps table above.
- Non-ASCII paths: the runner passes UTF-8 filenames through argv, staging, and
  publication unchanged. A source such as `影片.mp4` probes and cuts normally.
- Cancellation: each operation is one bounded invocation. Cancelling aborts the
  process tree, discards the staging directory, and never publishes a partial
  or unverified artifact.

## Pin update procedure

The vendored payload is checked against a pin by
[`scripts/check-ffmpeg-skill-drift.mjs`](../../scripts/check-ffmpeg-skill-drift.mjs),
run as `pnpm check:ffmpeg-skill`. To move to a new upstream revision:

1. Update the `PIN` object in the drift-check script (revision, package name,
   version, contract version, tool count).
2. Refresh [`skills/ffmpeg/PROVENANCE.md`](../../skills/ffmpeg/PROVENANCE.md)
   with the new revision and any changed local patch inventory.
3. Regenerate [`skills/ffmpeg/contract/payload-hashes.txt`](../../skills/ffmpeg/contract/payload-hashes.txt):
   SHA-256 of every payload file in sorted order, `hash  path` lines, trailing
   newline, excluding `PROVENANCE.md` and the hashes file itself. Also
   regenerate the static `contract/contract.json` with
   `python3 scripts/_contract.py --json --static`.
4. Run `pnpm check:ffmpeg-skill` and confirm it reports the new pin with the
   expected tool count.

The conformance result for the current pin is the 42-tool contract validated by
`pnpm check:ffmpeg-skill` plus the media correctness pass in #173. The full
replacement plan is in
[`dev-doc/plan/2026-10-04-ffmpeg-skill-replacement.md`](../plan/2026-10-04-ffmpeg-skill-replacement.md).
