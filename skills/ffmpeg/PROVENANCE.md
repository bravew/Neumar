# Provenance

Pinned adaptation of [kajisho5/ffmpeg-skill](https://github.com/kajisho5/ffmpeg-skill/tree/a991599bfe3f072bac3835083f8bbb30efcd9a99).

| Field | Value |
| --- | --- |
| Upstream revision | `a991599bfe3f072bac3835083f8bbb30efcd9a99` |
| Upstream package | `ffmpeg-skill` `2.4.2` (`package.json`, unchanged) |
| Contract | `contract_version` `1.0`, 42 public tools |
| App skill name | `ffmpeg` |
| Engine ids | `ffmpeg-skill/<tool>` |
| License | MIT, Copyright (c) 2026 kajisho5 (`LICENSE`) |
| Modes | `task`, `design`, `video` |

`contract/payload-hashes.txt` is SHA-256 of every payload file except itself and this note. `contract/contract.json` is the static contract (`python3 scripts/_contract.py --json --static`) generated from this revision before the copy. The drift check compares the vendored tree with that pin. It does not read `_sample/` and does not fetch upstream.

Imported: `LICENSE`, `package.json`, `scripts/` (including `_common/`, `_contract.py`, `_platforms.py`), `templates/`, `references/`, `docs/contract.md`, and the static contract. Excluded from the app payload: demos, tests, fixtures, evals, examples, assets, MCP server, installer, README, and `__pycache__`.

## Local patch inventory

Eight vendored Python files carry local patches, in four groups.

The first group follows upstream commit
[`57daa49c`](https://github.com/kajisho5/ffmpeg-skill/commit/57daa49c4136d81cde5d40b4c8415b9d2c38da7f):
the SDR encoder lines that target BT.709 (H.264, HEVC and AV1 in `decision.py`, and the export
platform presets) convert a BT.601 (`smpte170m`/`bt470bg`) source to BT.709 instead of relabelling
BT.601 pixels.

The second group follows upstream commit
[`e256decb`](https://github.com/kajisho5/ffmpeg-skill/commit/e256decb81b5cc60e901c0bda9fb1ecda98ae286)
(the probed-stream mapping, #484) and
[`f755076b`](https://github.com/kajisho5/ffmpeg-skill/commit/f755076bd63afec9aba6ae6b0a1fc283b3bfec51)
(`source_carry`, #401): the probe document names the stream it describes and the values it could
not measure, the measuring helpers read that same stream instead of FFmpeg's default selection,
and a writing tool records the source streams its output does not carry.

Exactly what is converted:

- SDR encoder lines that target BT.709 (the H.264, HEVC and AV1 lines in `decision.py`, and the
  export platform presets).
- The command's first video input only. A `-filter_complex` conversion is attached to its
  `[0:v]`/`[0:v:0]` reference; a BT.601 overlay on a BT.601 base is still not converted and
  shows the old relabelling.
- Only when the probed source width and height are both even. `colorspace` rejects an odd frame
  with "Invalid odd size (WxH)", and a tool whose own filter does not change the frame size
  (`reverse`, `loop`, `cut --accurate`, `denoise`, `deinterlace`, `silence`, `stabilize`, `fit`
  without sizing, `export --no-scale`) or a `-filter_complex` graph (`join`, `multicam`) can
  otherwise show it the odd source before that filter runs. Odd-sized sources therefore keep the
  base behaviour: no conversion, so their pixels keep the source matrix under the BT.709 tags.
- After the tool's own `-vf` filters, so a crop/scale and the even-dimension retry see the
  source's original geometry first.

The conversion is skipped for BT.709, untagged and HDR/BT.2020 sources. `color.py --correct` and
`color.py --lut` are unchanged: neither path passes the source probe to the encoder line, so both
still relabel BT.601 pixels as BT.709. `SKILL.md` is Neumar's, not the upstream agent guide.

The probed-stream patch names the streams `probe()` describes (`video.stream_index`,
`audio.stream_index`, `stream_counts`) and lists the values ffprobe could not read
(`unmeasured`). The measuring helpers in `probe.py` map `0:V:0`/`0:a:0`, so a tool measures the
same stream the document names; without a map, FFmpeg selected the largest picture and the sound
track with the most channels. `emit.py` adds `source_carry` to a writing tool's result, comparing
the first input's subtitle, chapter, cover, attachment, video-stream and audio-channel inventory
with the written file. It is a report, so `verified` is unchanged. An item bound to a stream the
output does not carry is not compared (an audio-only output cannot carry cover art), and a still
image used as a layer is not counted as a second picture source. Both are additive keys: no
existing key, tool argument, default or result schema changes.

The third group is `caption.py`, following upstream
[`f755076b`](https://github.com/kajisho5/ffmpeg-skill/commit/f755076bd63afec9aba6ae6b0a1fc283b3bfec51)
(the SRT `force_style` alignment, #436),
[`a3536dd7`](https://github.com/kajisho5/ffmpeg-skill/commit/a3536dd7) (SRT timing grammar and
late-starting audio in karaoke timing, #414),
[`6f61e104`](https://github.com/kajisho5/ffmpeg-skill/commit/6f61e104) (cue-file line splitting
and the "to" separator, #483), and
[`c84b22c4`](https://github.com/kajisho5/ffmpeg-skill/commit/c84b22c4) (SRT markup on the routes
that generate their own ASS). The caption patch is confined to `caption.py`: the underlying
`_common/asr.py` SRT block grammar, `_common/wrap.py` break spacing, `_common/emoji.py` text-symbol
classification, `_common/fonts.py` Windows family files, and `_common/timeline.py` source
timecodes were reproduced but are not patched here, because this sub-issue does not own those
files.

The fourth group is `render.py`, following upstream
[`d81145a3`](https://github.com/kajisho5/ffmpeg-skill/commit/d81145a39a187298bda3a7ea73dfff79ce95618a)
(the stage handoff, #415/#428) and
[`c84b22c4`](https://github.com/kajisho5/ffmpeg-skill/commit/c84b22c49c1ddf4ec7935ac10a0d4be35dc3fc17)
(project-relative assets). `sh()` records the file a stage's child wrote as this run's own write
before a later stage replaces it, so the chapters stage can place its tagged copy over the export
it just wrote instead of the output guard refusing the file as someone else's. `audiogram.image`
and `overlays[].font_file` are read against the project file's directory like every other project
asset, instead of the process working directory. The upstream fix also rebases the whole project
and keeps `+faststart` across the chapters remux; the first is not needed for the reproduced
cases, and the second belongs to `metadata.py`, which this sub-issue does not own. `batch.py` is
not patched: the managed host refuses a batch recipe before the payload runs, so the upstream batch
collision cannot be reproduced through this caller.

| File | Change |
| --- | --- |
| `scripts/_common/color.py` | Added `bt709_matrix_filter()`/`bt709_matrix_args()` (the `colorspace` conversion for a probed non-BT.709 SDR matrix, only when the source width and height are both even) and `_fold_bt709_matrix()` (moves that conversion into the tool's own `-vf`/`-filter_complex`, after the tool's filters). `bt709_tag_args()` takes the source probe and appends the conversion. Follows upstream `57daa49c`. |
| `scripts/_common/decision.py` | `x264_args()`/`video_args()`/`encoder_args()` pass the source probe to `bt709_tag_args()`/`bt709_matrix_args()`, so the SDR encoder lines that target BT.709 convert a BT.601 matrix. Follows upstream `57daa49c`. |
| `scripts/_common/runner.py` | `run()` folds the conversion into the command's filter graph before recording or executing it: appended to the tool's own `-vf` chain, or prepended to the first input's `-filter_complex` branch. A tool's own filter is not replaced by a second `-vf`. Follows upstream `57daa49c`. |
| `scripts/export.py` | Passes the source probe to `bt709_tag_args()` for the platform presets. Follows upstream `57daa49c`. |
| `scripts/_common/probe.py` | Added `PROBED_VIDEO`/`PROBED_AUDIO`, `video.stream_index`/`audio.stream_index`/`stream_counts`/`unmeasured` in `probe()`, and `carry_inventory()`/`input_paths()`; `decode_pcm_mono()`, `decode_gray_frames()`, `measured_level_dbfs()`, `analyze_levels()`, `detect_silences()` and `detect_scenes()` map the probed stream. Follows upstream `e256decb` (and `fd12ae1a` for naming unmeasured values). |
| `scripts/_common/emit.py` | Added `source_carry()` and included it in the success document, and `unmeasured` in `--json-brief`'s summary. Locally, `source_carry()` does not compare an item the output's streams cannot carry (cover art on an audio-only output) and does not count a still-image layer as a second picture source. Follows upstream `f755076b` (`source_carry`, #401). |
| `scripts/caption.py` | Added `FORCE_STYLE_ALIGN`, the legacy SSA alignment values libass reads in a `force_style` list (bottom 2, top 6, center 10, top-left 5, top-right 7), so an SRT burn places `--position` where the numpad value in a generated Style line would. Added `srt_timings_shared_grammar()` and rewrite SRT timings outside ffmpeg's grammar (`00:00:01,5`, `00:01,000`) as `hh:mm:ss,mmm` before ffmpeg reads them, for the first track and each extra mux track. `word_durations_from_audio()` decodes with `aresample=async=1:first_pts=0`, so a sound that starts late is counted from the file's clock. `cue_times_match()` requires clock times on both sides of the English word "to", and cue files split at `\n` only, so U+2028 no longer starts a cue. SRT markup (`<i>`/`<b>`/`<u>`/`<s>`, `<font color>`, `{\anN}`) is stripped before wrapping, fitting, emoji placement and visible-cue counting, reinserted after the wrap and carried across a split cue, and converted to the equivalent ASS overrides in a generated ASS; karaoke ignores a token that is only markup. A closing tag with no matching opener is kept as text instead of emitting a reset override, so cue text such as `</i>` reads literally and cannot open `{\i0}`. Follows upstream `f755076b` (#436), `a3536dd7` (#414), `6f61e104` (#483) and `c84b22c4`. |
| `scripts/render.py` | `sh()` adds the output a stage's child wrote to `STATE.written` (via `_remember_output()`), so the chapters stage's `place_output()` replaces the export this same run wrote instead of refusing it as an existing output. `audiogram.image` and `overlays[].font_file` pass through `rel()`, so they resolve against the project file's directory like every other project asset. Follows upstream `d81145a3` (stage handoff) and `c84b22c4` (project-relative paths). |
| `SKILL.md` | App name `ffmpeg`, modes `task`/`design`/`video`, and instructions for MCP server `ffmpeg-skill` tools `ffmpeg_skill_catalog`, `ffmpeg_skill_check`, and `ffmpeg_skill_execute`. Rejects raw shell, raw `argv`, `transcribe`, `batch --watch`, and saved-plan replay. |
| `contract/contract.json` | Added pinned static contract for the later runner. Not an upstream path. |
| `contract/payload-hashes.txt` | Added payload inventory. Not an upstream path. |
| `PROVENANCE.md` | This file. Not an upstream path. |

`scripts/_common/asr.py` remains in the payload because `caption` and `silence` import the package, but the managed service must not pass `transcribe`. Enabling it would launch an optional local Whisper tool, which this pin does not authorize.
