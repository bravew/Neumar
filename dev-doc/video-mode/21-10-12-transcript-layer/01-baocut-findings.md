# 01 — How transcript editing works in BaoCut

Date: 2026-10-12. Source: `_sample/baocut/docs` (vendored, gitignored; read-only reference).
BaoCut is a Rust + native-client editor. Its docs say in several places that
they were ported from "BaoCut v2" data models, so every concept below is
translated into Neumar terms in [README.md](README.md) rather than copied.

## The user-visible behaviour (the screenshot)

A transcript panel sits beside the preview. Above the timeline tracks there is
a **transcript layer**: a row whose segments are the transcript's sentences,
aligned to the media. Both surfaces edit the same underlying words.

| Interaction | Behaviour |
| --- | --- |
| Click a word / timestamp | Playhead seeks to that word's position on the timeline. |
| Playback | The active word is highlighted and the panel scrolls with it ("follow playback"). |
| Select a range of words | The matching span is highlighted in the panel and in the transcript layer. |
| Delete in **cut-media** mode | The selected words stay visible but struck through; the media (video, audio, linked captions) for that span is removed from the timeline and later content ripples up. |
| Delete in **text-edit** mode | Only the text changes. Media is untouched. |
| Restore a struck word | The media span comes back; added visuals (b-roll, overlays) are preserved. |
| Suggestions | Filler words / silences are proposed as cut marks the user can audition, accept or dismiss. |

## Concepts

- **Word is the persistent truth.** Each word carries text and source-time
  `t0/t1`. Sentences, cues and paragraphs are projections over words
  (`design/subtitle/bcut-transcript-v03-design.md`, glossary: *Transcript*,
  *SpeechDocument*, *Sentence*, *Cue*, *EditedSpeechView*).
- **Four editing modes** (`product/product-design.md` §5.7): edit original
  transcript, edit translation/display, edit voice-over script, **cut media**.
  The same Delete key means different things per mode, so the active mode is
  always visible.
- **Cut marks are separate from text.** A cut word is "hidden", not removed: the
  word stays in the document so it can be restored and so timings stay valid
  (`patchTranscript.set.hidden` in `bcut-incremental-edit-design.md`).
- **Timeline cut bands** show where cuts sit; the transcript layer can be a
  read-only row when no caption track exists.
- **Writes are sparse and CAS-guarded.** Edits ship as small patches
  (`update` by word id, `splices`, `set.hidden`) against a revision; transient
  transport failures retry, verdicts roll back
  (`bcut-incremental-edit-design.md` §3.1, §3.5).
- **Acceptance tests** (`acceptance/acceptance-spec.md`):
  - AT-08 deleting spoken content and restoring it links correctly; restoring
    preserves visuals that were added in between; suggestions can be auditioned.
  - AT-09 pressing Delete in subtitle/text mode edits text only and must never
    delete media.

## What does not transfer

- BaoCut's timeline is a sequence/track/item model with a Rust editor core and
  wasm UI; Neumar's is `packages/video-ir` `Timeline` with TypeScript ops.
- Translation/voice-over modes (three of the four edit modes) have no Neumar
  equivalent yet and are out of scope.
- Multi-client revision sync (Mac/GPUI/Web) is not needed; Neumar has one
  frontend and one API, and timeline writes already go through
  `applyTimelineOps` with history.
