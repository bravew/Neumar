# S3 — Grid density

Clip: `coverage-40s.mp4` (40 s, four 10 s holds, overlay bars at 1–6,
14–22, 32–40). No VLM tokens were spent; cost is local ffmpeg time and
JPEG bytes. Quality scoring is structural: can a reader recover the
three overlay events and the three hold cuts from the sample set.

| Interval s | Cell px | Frames | Bytes | Seconds | Recovers overlays | Recovers cuts |
| --- | --- | --- | --- | --- | --- | --- |
| 0.25 | 320 | 160 | 180735 | 0.09 | yes | yes |
| 0.25 | 480 | 160 | 288620 | 0.25 | yes | yes |
| 0.5 | 320 | 80 | 90365 | 0.10 | yes | yes |
| 0.5 | 480 | 80 | 144308 | 0.10 | yes | yes |
| 1.0 | 320 | 40 | 45179 | 0.15 | yes | yes |
| 1.0 | 480 | 40 | 72154 | 0.12 | yes | yes |
| scene-aware cap 48 | 320 | 41 | 40775 | 1.70 | if coverage seeds kept | yes if cuts scored |

## Hand-written section (ground truth)

0–10 s hook/hold with overlay 1–6 s; 10–20 s second hold, overlay 14–22;
20–30 s third hold; 30–40 s payoff overlay from 32 s. Cuts at 10/20/30 s.

## Packed-transcript-only vs transcript+grids

This fixture has no speech. Packed transcript is empty. Overlay entry
is invisible without interval samples. Scene-change on near-still
holds under-samples the 1–6 / 14–22 / 32+ overlay spans unless a
coverage pass reserves those windows.

## Decision

- Default: coarse-then-refine, **48-cell coarse cap**, page at 12 (4×3),
  192-cell run ceiling including refinement (document 06 Q15).
- Uniform 0.25 s of a whole clip is the control, not the default.
- Motion questions (caption entry) require interval `frames`/`clip`
  evidence, not only boundary candidates.

Command: ffmpeg `fps=` + `scale=` grids; scene-aware pass uses `select`.
