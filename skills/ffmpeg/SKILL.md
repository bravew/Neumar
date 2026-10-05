---
name: ffmpeg
description: Edit local video and audio through Neumar's managed ffmpeg-skill service. Use for cuts, joins, reframing, captions, overlays, colour, audio, loudness, platform delivery, scene measurement, and contact sheets when the user mentions a media file, footage, captions, LUFS, sync, or a reel. Modes task, design, and video. Installed Python 3.9+ and FFmpeg/ffprobe only; no raw ffmpeg commands.
license: MIT
author: kajisho5
version: 2.4.2
modes:
  - task
  - design
  - video
---

# ffmpeg

Local media operations for task, chat-as-task, Design Mode, and Video Mode. The app skill name is `ffmpeg`. Upstream engine ids stay `ffmpeg-skill/<tool>` and are not a second catalog entry. Invoke operations only through the managed MCP server `ffmpeg-skill` (`mcp__ffmpeg-skill__ffmpeg_skill_catalog`, `mcp__ffmpeg-skill__ffmpeg_skill_check`, and `mcp__ffmpeg-skill__ffmpeg_skill_execute`). Do not run `scripts/*.py`, `ffmpeg`, `ffprobe`, or a shell command yourself. Do not call native `mcp__ffmpeg__*` tools for these operations.

Runtime requirements are installed on the API host: Python 3.9+ (standard library only), FFmpeg >= 5.0, and ffprobe >= 5.0. Nothing is bundled or downloaded. A missing interpreter, binary, filter, font, or optional encoder is an actionable `missing_tool` failure, not a reason to install software or claim success.

## Service

MCP server name: `ffmpeg-skill` (lowercase letters, digits, and hyphens). Tool names use underscores because the server name cannot:

- `ffmpeg_skill_catalog` lists the pinned 42 tools, their `ffmpeg-skill/<name>` ids, roles, and which structured arguments the host currently accepts. Read it before naming an operation. It does not inject 42 schemas.
- `ffmpeg_skill_check` reports whether the API host can run one named tool: installed Python, ffmpeg, ffprobe, and the filters or encoders that tool requires. It does not install anything.
- `ffmpeg_skill_execute` takes one contract tool name plus validated structured arguments. The host maps those arguments with the pinned contract (`contract/contract.json`): property `cli` spellings, `mcp.argument_exceptions`, and `input_schema.positional`. There is no second flag list. Unknown keys are rejected.

This is not the upstream `mcp/server.py` process, and it is not the native `ffmpeg` MCP server.

The host owns the workspace, cwd, executable, and script path. Callers cannot supply them. Inputs and outputs must already be local files inside the authorized task, session, design project, or video project. Remote media is materialized by Neumar before the operation; this service does not fetch URLs. Nested network access and user manifests that reference unauthorized files are rejected.

`execute` is one bounded invocation. The host supervises the process tree, the deadline, and cancellation. Do not ask for a background job.

## What the managed surface accepts

Structured arguments from the pinned contract are accepted, except the gates below. Writing tools create a new file. They refuse to overwrite a source or an existing output unless the user asked for that replacement and the host authorizes it.

Preview (`dry_run: true`) may probe or measure and may use run-owned temporary files. It creates no deliverable and replaces no user file. A preview number that the contract marks as a stub is not a measurement. `verify` does not support preview: its steps execute, so the host rejects `verify` on the preview surface. Plan documents (`plan`), project initialization (`render` `init` / `write_project`), and pack/report sidecars are separate writes; do not treat them as a preview.

Analysis tools (`probe`, `scenes`, `silence`, `sync`, `loudness`, `cropdetect`, `multicam`, `stabilize`, `report`, `check`) may run ffprobe or decode media even on preview. Say so. `check` rows split into format fixes and judgement calls. Fix format rows when the request implies the fix. State a judgement row (duration, crop, fps, loudness of ambience) and its cost instead of applying it silently.

## Explicitly gated

The host rejects these until a later checkpoint implements them. Do not work around a rejection.

| Variant | Why it is gated | What to do instead |
| --- | --- | --- |
| Raw `argv` | Bypasses the structured schema and host policy. | Pass named contract arguments to `ffmpeg_skill_execute`. |
| `caption` or `silence` `transcribe` | Upstream ASR can launch whisper.cpp, faster-whisper, or a Whisper CLI. The contract's "Python and FFmpeg only" claim does not cover that. | Use a Neumar transcript, or a supplied SRT, ASS, cue file, or word-timing file. Ask for text when none exists. Never invent dialogue. |
| `batch` `watch` | Polls a folder until interrupted. | Run one bounded `batch` or one file operation. |
| Saved-plan replay (`render` of a `<tool> --plan` file) and raw `batch` recipes the host cannot fully parse | A plan or recipe carries its own tool, arguments, cwd, and paths. A file is not prior authorization. | Ask the host to build a sanitized recipe from structured steps. `render` templates and a host-generated project are the supported chains. |

`--plan` on a writing tool is not a substitute for saved-plan replay. Use it only when the user wants a plan document and the host has authorized that write.

## Workflow

1. Probe inputs you must plan from (`probe`). Use duration, fps, resolution, codecs, channels, and variable-frame-rate suspicion from the result. Do not assume them.
2. Prefer a lossless path when the request allows it. `cut` and `loudness` stream-copy video unless accuracy or a measured condition requires a re-encode. Ask for `--accurate` only when the cut must be frame- or sample-exact.
3. Preview with `dry_run` before a long encode. Trust probed JSON, not a preview summary line.
4. Order a hand-built chain colour, then cut, join, silence, fit, caption or overlay, sync, audio, loudness, export. A named destination with no other editing is one `render` template. Three or more steps belong in a host-generated `render` project, not a claim that one encode did all of it.
5. Run `check` for a named platform. Templates already check. Mention warnings. Do not chase them.
6. Confirm duration, resolution, fps, and audio from the tool result or a new probe. `status: completed` with `verified: false` is not an approved deliverable. A failed check can leave a file; report it as unverified and quote the reason.
7. When the picture changed, run `look` and cite the contact sheet. A sheet is evidence for the calling agent to inspect. It is not visual approval. With no image view, write `Look: PATH (pixels not inspected)`. Audio-only work uses `Look: not needed`.
8. Never overwrite the user's original. Publish only files the host validated. In Video Mode, ingest the new asset before any timeline change. Design Mode publishes through the project asset flow. Task and chat attach the file to the originating session.

Platform templates apply crop, trim, fps, HDR conversion, and loudness choices. Show those losses before applying them. They are versioned presets, not current universal upload rules.

## Decisions this skill does not make

Cutting, measuring, syncing, exporting, and checking are mechanical. The user or the calling mode agent decides which cut is right, whether a deliverable is approvable, what a highlight means, cover composition, and colour taste. `scenes --highlights` ranks by a measured proxy. Cue text is burned as written; do not rewrite it to make it fit. Crop to a box you were given; do not invent the subject.

If none of the 42 tools covers the request, say so and name the closest tool. Do not invent a raw ffmpeg invocation. GPU encoding, live streaming, screen capture, and arbitrary filters are outside this payload.

## Request routing

Open `references/scripts.md` for the prose flag catalogue. Open `references/devices.md` for iPhone HDR, GoPro, DJI, screen recordings, and Zoom. Open `references/gotchas.md` when a one-line rule below is not enough. The executable schema is `contract/contract.json`, not a handwritten copy of these tables.

| User says | Tool |
| --- | --- |
| Cut, trim, keep ranges | `cut` |
| Exactly N seconds, aspect, resize, rotate, flip, blur bars | `fit` |
| Known pixel rectangle | `crop` |
| Pauses, or filler from a supplied word file | `silence` (no `transcribe`) |
| Highlight candidates, beats, shots, speech-versus-music ratio | `scenes` |
| Speed ramp, freeze, reverse, loop, deinterlace, denoise, stabilize, straighten, 360 viewport | `speedramp`, `freeze`, `reverse`, `loop`, `deinterlace`, `denoise`, `stabilize`, `straighten`, `sphere` |
| Captions from SRT, ASS, or timed text; mux or burn | `caption` |
| Logo, watermark, title, picture-in-picture, chromakey | `overlay` |
| Lower third, sticker, hook, meme, brand file | `graphics` |
| Align mic or cameras; replace audio when asked | `sync` |
| Loudness target, voice cleanup, music ducking, downmix, extract audio | `loudness`, `audio` |
| Named platform file or GIF or proxy | `export`, `proxy` |
| One destination, or a pack, from a template | `render` |
| Compliance, contact sheet, HTML summary | `check`, `look`, `report` |
| Still, colour plate, image sequence, waveform, chapters, grid, B-roll window, black pad | `insert`, `background`, `sequence`, `waveform`, `metadata`, `grid`, `broll`, `pad` |
| What is in this file | `probe` |
| Several files, one bounded recipe the host can parse | `batch` (no `watch`) |
| Three cameras, explicit switch or energy candidate | `multicam` |

Timestamps take seconds, `mm:ss`, `hh:mm:ss`, or SMPTE `hh:mm:ss:ff@fps`. Length flags are plain seconds.

## Report

Reply in the user's language. Keep the English labels. Numbers come from the tool result, not memory. Do not impose extra sections on a mode that already has a richer report.

```
Done: final.mp4 — 59.98 s, 1080x1920, 30 fps, H.264, AAC stereo, -14.1 LUFS
Steps: cut 0:12-1:12 (lossless) -> fit 9:16 crop -> captions -> loudness -14 -> export reels
Check: reels — format rows pass; judgement rows stated (verified: true|false)
Look: final_sheet.png (pixels not inspected | what was actually seen)
Notes: source unchanged; gated variants not used
```

On failure, `Failed:` quotes the service `error.kind` and `error.message`. List steps that ran. A partial file stays `Done:` with the shortfall in `Notes:`, or `Failed:` when the host refused publication. Never report success without an output probe for a writing tool.

## One-line rules

- HDR re-encoded as SDR goes flat. `color --to-sdr` is explicit. `hdr: true` is PQ, HLG, or Dolby Vision. See [HDR and colour](references/gotchas.md#hdr-and-colour).
- Log footage is tagged SDR and looks grey. `probe --analyze`, then a supplied LUT. See [Log footage](references/gotchas.md#log-footage).
- A stream-copy cut can land on the wrong frame. Respect `cut`'s measured tolerance. See [Keyframe cuts](references/gotchas.md#keyframe-cuts).
- Phone and screen recordings are often variable frame rate. Re-encodes conform; pick the rate with `fit`. See [Variable frame rate](references/gotchas.md#variable-frame-rate).
- Sync confidence under 0.3 is suspect. These tools align audio, not lips. See [Sync, multicam and drift](references/gotchas.md#sync-multicam-and-drift).
- Normalised audio can still clip. Do not raise near-silent ambience to a speech target. See [Loudness and ambience](references/gotchas.md#loudness-and-ambience).
- Caption after the final frame size. Emoji need a supplied PNG per glyph. Non-Latin text needs a font the host can resolve. See [Captions, fonts and text order](references/gotchas.md#captions-fonts-and-text-order), [Emoji](references/gotchas.md#emoji), and [Fonts by script](references/gotchas.md#fonts-by-script).
- `fit --fit crop` from 16:9 to 9:16 discards most of the width. Say whether "60 seconds" means speed or trim. See [Reframing, fps and duration](references/gotchas.md#reframing-fps-and-duration).
- Short-form templates keep text out of the platform UI zones. `look --safe tiktok` draws them. See [Platform safe zones](references/gotchas.md#platform-safe-zones).
- Highlight ranks are not meaning. Chain three or more steps in one `render` project. See [Highlights](references/gotchas.md#highlights) and [Chaining and speed](references/gotchas.md#chaining-and-speed).

Upstream prose contract: [docs/contract.md](docs/contract.md). Machine contract for the runner: [contract/contract.json](contract/contract.json). Provenance: [PROVENANCE.md](PROVENANCE.md).
