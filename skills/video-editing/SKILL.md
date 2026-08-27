---
name: video-editing
description: Video Mode editing guidance for agentic storyboard, timeline, caption, audio, render, and publish work through video_* MCP tools.
---

# Video Editing

Use this skill whenever you are editing a Video Mode project through the
`mcp__video-edit__*`, `mcp__media__*`, or `mcp__ffmpeg-processing__*` tools.

## Operating Rules

1. Read current project state before editing. Start with
   `video_get_project_summary`; use `video_get_scene`,
   `video_get_timeline`, and `video_list_assets` for narrower context.
2. Use Video Mode tools for every project mutation. Do not use shell or file
   editing tools to change `project.json`, assets, timeline JSON, or renders.
3. Read and reversible write operations can proceed directly. Anything that
   removes content, changes timing substantially, spends money, renders, or
   publishes needs explicit approval.
4. Prefer one clear operation at a time when the user is reviewing edits.
   Use `video_propose_timeline_ops` for multi-op plans before applying them.
5. Never trim mid-word. When transcript timing exists, snap edit boundaries to
   word or sentence boundaries and preserve 30-200 ms of context unless the
   user asks for frame-tight cuts.
6. Keep audio continuity deliberate. After visual transitions longer than
   500 ms, set the clip audio seam to `cut` unless the user asks to preserve
   source audio under the transition.
7. Subtitles come after structural edits. Make cuts, reframes, overlays, and
   narration decisions first, then add or refresh captions.
8. For generated images or video, use existing project assets as references
   when the user asks to keep identity, layout, or product appearance stable.
9. Surface cost in plain language after generation or render work. Do not stop
   because of cost unless the user asks for a budget limit.
10. Verify before publish. Use render verification and mention any degraded
    transitions, missing media, loudness issues, or caption drift.
11. Preflight storyboard duration against the project template before approval:
    `ugc-ad` allows 15 seconds, themed templates allow 60 seconds, and `custom`
    is unlimited. If the confirmed edit is longer, explain the mismatch and use
    `video_set_project_template` or trim it before `video_approve_storyboard`.
    `video_select_template` is only for HTML/Motion gallery templates and does
    not change this ceiling.
12. A vivid photo sequence needs a designed visual treatment, not only generic
    zoom keyframes. Analyze each photo and adjacent footage, choose one coherent
    vivid-overlay or gallery-template family, vary content-aware motion, and
    inspect composited frames. Keep the supplied photos recognizable; generate
    derived or replacement imagery only when the user asks and approves cost.
13. If image/video generation fails, report the provider error. Do not silently
    substitute a placeholder, unrelated asset, or unmaterialized AI scene.

## Project directory contract

Every Video Mode project on disk uses this layout. Honor it when picking
work directories for ad-hoc tool calls (e.g. `mcp__ffmpeg-processing__*`)
and when describing where files live to the user:

```
<projectDir>/
  project.json          # journal + storyboard + timeline + asset registry
  assets/               # ALL source / working media
                        #   - generated images (Seedream / Imagen / GPT-Image)
                        #   - generated videos (Veo / Seedance / Runway)
                        #   - generated voiceover (TTS) and music
                        #   - generated b-roll, lipsync renders
                        #   - user uploads and reference images
                        #   - any ffmpeg intermediate the agent produces
                        # The runtime steers media MCP outputs here automatically.
  sources/              # imported original captures before processing
  cache/                # render cache (per-scene + per-clip previews)
  output/               # ONLY the final rendered video + its caption .srt
                        # Do not write anything else here.
```

If you call `mcp__ffmpeg-processing__*` for an ad-hoc transform (trim,
concat, audio normalize, frame extract), pass `work_dir` as
`<projectDir>/assets` so the result lands with the rest of the working
media. Reach `<projectDir>` via `video_get_project_summary` if you don't
already have it from earlier in the turn.

## Tool Selection

- `video_get_project_summary`: first read of every turn.
- `video_set_project_template`: change the duration-governing project template;
  use it for an approved long-form edit that cannot pass the current ceiling.
- `video_describe_scene`: user asks what is in a scene or wants an edit scoped
  to a scene.
- `video_add_scene`, `video_remove_scene`, `video_reorder_scenes`: storyboard
  structure changes.
- `video_set_duration`, `video_set_transition`, `video_set_timeline_bookend`,
  `video_set_clip_audio_seam`: timeline timing and boundary polish.
- `video_propose_timeline_ops`: batch edits, auto-cuts, pacing changes, source
  capture insertion, or recipe-driven operation sets.
- `video_apply_timeline_op`: one reviewed timeline operation.
- `video_set_caption`, `video_add_captions`: caption content and style.
- `video_generate_voiceover`, `video_generate_music`: narration or music plans.
- `mcp__media__media_generate_image` and `mcp__media__media_generate_video`:
  asset generation. Ask before calls because they can spend money. The output
  file is auto-registered as a project asset by the runtime — you do not need
  to call any follow-up tool to attach it to the library. Mention to the user
  that the new asset is in the project's Assets panel and offer to attach it
  to a specific scene with `video_attach_asset` (with sceneId) when the
  context implies a target scene.
- `video_analyze_image`, `video_list_overlay_presets`,
  `video_inspect_timeline_frames`: the minimum loop for vivid, cinematic, or
  style-matched photo slides. Prefer a consistent overlay/frame family plus
  subject-aware motion over three repeated scale-only moves.
- `video_reframe`: aspect-ratio adaptation.
- `video_render`, `video_verify_render`, `video_publish_to`: finalization path.

## Approval Copy

When asking for approval, be concrete:

- Say what will change.
- Name the affected scene, clip, track, aspect ratio, or destination.
- Mention likely cost for generation/render work when available.
- Keep the approval text short enough to fit a card.

Good examples:

- "Generate 4 reference images for Scene 2 using the product hero asset?"
- "Trim clip `clip-voice-1` from 12.4s to 18.9s and journal undo data?"
- "Render a 9:16 draft locally with burned-in captions?"

## Response Discipline

After tool use, summarize the result, not the implementation. If an edit was
journaled, mention that undo is available. If a requested operation cannot be
done with the current tools, say which project fact is missing and ask for the
smallest next input.
