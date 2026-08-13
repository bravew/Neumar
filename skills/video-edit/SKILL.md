---
name: video-edit
description: Conversational video editing workflow for cuts, transcript-based edits, overlays, captions, subtitle burn-in, and render planning with ffmpeg. Use when the user asks to edit video by instruction, cut silence or words, add subtitles, add overlays, transcribe video, or render a final clip.
---

# Video Edit

Use this skill for conversational video edits that combine transcription, cut planning, overlays, captions, and final rendering.

## Hard Rules

1. Subtitles are applied last, after cuts, overlays, scaling, and audio processing.
2. Prefer per-segment lossless extraction with `-c copy` and concat when no filters are needed.
3. Add short 30 ms audio fades at edit joins unless the user explicitly wants hard cuts.
4. For overlays and delayed media, use `setpts=PTS-STARTPTS+T/TB` so timestamps are reset and shifted deliberately.
5. Never cut inside a word. Snap edit boundaries to word-level transcript timestamps.
6. Preserve 30-200 ms of context around speech boundaries unless the user requests frame-tight cuts.
7. Use verbatim ASR text for captions. Do not rewrite captions unless asked.
8. Cache transcripts by source hash so repeated edits do not re-transcribe unchanged media.
9. Produce a plain-English edit plan before any destructive or long render.
10. Ask for approval before final rendering when the requested edit changes timing, removes content, or burns permanent subtitles.
11. Keep intermediate files in a workspace edit/cache directory and final renders in a workspace edit/output directory.
12. Never write generated video outputs into source-controlled project paths unless the user explicitly chooses that destination.

## Workflow

1. Inspect media first with the existing ffmpeg/media tools. Record duration, streams, codec, resolution, frame rate, and audio layout.
2. Transcribe when timing matters. Request word timestamps and reuse any cached transcript for the same source hash.
3. Build an edit plan with source path, exact segment windows in seconds, intended joins, overlays, subtitle inputs, output path, and expected duration.
4. For transcript cuts, snap segment starts and ends to word boundaries, then add context padding inside valid media bounds.
5. Render in passes only when needed:
   - Cuts/concat first.
   - Overlays, scaling, crop, color, and audio filters next.
   - Subtitle burn-in last.
6. Verify output with probe metadata after rendering. Compare expected vs actual duration and confirm the output path is inside the workspace edit/output directory.

## Command Patterns

Lossless segment:

```bash
ffmpeg -ss START -to END -i input.mp4 -c copy segment_001.mp4
```

Lossless concat:

```bash
ffmpeg -f concat -safe 0 -i concat.txt -c copy cut.mp4
```

Audio crossfade-safe filtered segment:

```bash
ffmpeg -ss START -to END -i input.mp4 -af "afade=t=in:st=0:d=0.03,afade=t=out:st=DURATION_MINUS_0_03:d=0.03" -c:v copy segment_001.mp4
```

Subtitle burn-in final pass:

```bash
ffmpeg -i edited.mp4 -vf "subtitles=subtitles.srt" -c:a copy final.mp4
```

## Response Discipline

When proposing an edit, include only the useful plan: source, cuts, overlays/captions, output path, and validation checks. Do not describe ffmpeg basics unless the user asks.
