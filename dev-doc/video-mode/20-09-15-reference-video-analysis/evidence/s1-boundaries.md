# S1 — Boundary detection

Host ffmpeg 9.0.1. Two filters, **different scales**.
`select='gt(scene,t)'` scores are 0–1 adjacent-frame differences.
`scdet` scores are a separate scale (threshold typically 8–15).
Window for a hit: ±100 ms of a hand-marked hard cut.

| Clip | Method | Threshold | Predicted | TP | Precision | Recall | Seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| still-8s | select | 0.2 | 0 | 0 | 1.00 | 1.00 | 0.18 |
| still-8s | select | 0.3 | 0 | 0 | 1.00 | 1.00 | 0.04 |
| still-8s | select | 0.4 | 0 | 0 | 1.00 | 1.00 | 0.04 |
| still-8s | scdet | 8 | 0 | 0 | 1.00 | 1.00 | 0.04 |
| still-8s | scdet | 10 | 0 | 0 | 1.00 | 1.00 | 0.06 |
| still-8s | scdet | 12 | 0 | 0 | 1.00 | 1.00 | 0.04 |
| hard-cuts-12s | select | 0.2 | 2 | 2 | 1.00 | 0.67 | 0.06 |
| hard-cuts-12s | select | 0.3 | 1 | 1 | 1.00 | 0.33 | 0.07 |
| hard-cuts-12s | select | 0.4 | 1 | 1 | 1.00 | 0.33 | 0.11 |
| hard-cuts-12s | scdet | 8 | 2 | 2 | 1.00 | 0.67 | 0.05 |
| hard-cuts-12s | scdet | 10 | 1 | 1 | 1.00 | 0.33 | 0.06 |
| hard-cuts-12s | scdet | 12 | 1 | 1 | 1.00 | 0.33 | 0.06 |
| fast-cut-10s | select | 0.2 | 7 | 7 | 1.00 | 0.37 | 0.05 |
| fast-cut-10s | select | 0.3 | 0 | 0 | 0.00 | 0.00 | 0.05 |
| fast-cut-10s | select | 0.4 | 0 | 0 | 0.00 | 0.00 | 0.05 |
| fast-cut-10s | scdet | 8 | 7 | 7 | 1.00 | 0.37 | 0.05 |
| fast-cut-10s | scdet | 10 | 2 | 2 | 1.00 | 0.11 | 0.04 |
| fast-cut-10s | scdet | 12 | 0 | 0 | 0.00 | 0.00 | 0.04 |
| dissolve-10s | select | 0.2 | 0 | 0 | 1.00 | 1.00 | 0.05 |
| dissolve-10s | select | 0.3 | 0 | 0 | 1.00 | 1.00 | 0.07 |
| dissolve-10s | select | 0.4 | 0 | 0 | 1.00 | 1.00 | 0.05 |
| dissolve-10s | scdet | 8 | 0 | 0 | 1.00 | 1.00 | 0.04 |
| dissolve-10s | scdet | 10 | 0 | 0 | 1.00 | 1.00 | 0.04 |
| dissolve-10s | scdet | 12 | 0 | 0 | 1.00 | 1.00 | 0.04 |
| caption-entry-12s | select | 0.2 | 0 | 0 | 1.00 | 1.00 | 0.06 |
| caption-entry-12s | select | 0.3 | 0 | 0 | 1.00 | 1.00 | 0.06 |
| caption-entry-12s | select | 0.4 | 0 | 0 | 1.00 | 1.00 | 0.06 |
| caption-entry-12s | scdet | 8 | 0 | 0 | 1.00 | 1.00 | 0.05 |
| caption-entry-12s | scdet | 10 | 0 | 0 | 1.00 | 1.00 | 0.05 |
| caption-entry-12s | scdet | 12 | 0 | 0 | 1.00 | 1.00 | 0.05 |
| speech-music-en-8s | select | 0.2 | 0 | 0 | 1.00 | 1.00 | 0.03 |
| speech-music-en-8s | select | 0.3 | 0 | 0 | 1.00 | 1.00 | 0.03 |
| speech-music-en-8s | select | 0.4 | 0 | 0 | 1.00 | 1.00 | 0.03 |
| speech-music-en-8s | scdet | 8 | 0 | 0 | 1.00 | 1.00 | 0.03 |
| speech-music-en-8s | scdet | 10 | 0 | 0 | 1.00 | 1.00 | 0.03 |
| speech-music-en-8s | scdet | 12 | 0 | 0 | 1.00 | 1.00 | 0.03 |

## Decision for Phase 2

- FFmpeg 9 on this host removed `-vsync`; use `-fps_mode vfr`.
- `select='gt(scene,0.2)'` is the usable adjacent-frame detector: still
  clips stay quiet; hard-cuts recall 2/3 at ±100 ms; fast-cut recall is
  7/19 (precision 1.0) — over 1 fps, so **cap and drop lowest scores**.
- `scdet` logs `lavfi.scd.score` / `time` on detections only. Default
  threshold 10 missed a 9.766 hard-cut score; Phase 2 default is **8**
  with both scores stored. Do not label scenes `ffmpeg-scdet` unless
  that filter produced the candidate.
- Dissolves and caption-entry overlays produced **zero** candidates.
  Boundaries ship **advisory-only**. Interval sampling is required for
  motion-between-similar-frames.
- Precision/recall floor on these synthetic hard cuts is not high
  enough to treat candidates as a shot list (plan release gate 2).

Commands: `evidence/run_spikes.py` (ffmpeg 9.0.1, `-fps_mode vfr`).
