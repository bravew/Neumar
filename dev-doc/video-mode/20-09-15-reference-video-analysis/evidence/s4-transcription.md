# S4 — Transcription under music

`transcribeSourceMedia()` defaults to provider `local` and degrades when
cloud ASR is skipped or unavailable. This spike records fixture
integrity plus a local `whisper` probe if present; it does not spend a
cloud ASR budget.

| Clip | Duration | Audio stream | Script | whisper CLI | Notes |
| --- | --- | --- | --- | --- | --- |
| speech-music-en-8s | 2.798458 | aac | `The queue grows and the workload accelerates until the hold.` | not installed | ok |
| speech-music-zh-8s | 3.986958 | aac | `队列变长，工作负载加速，然后稳住。` | not installed | ok |
| speech-music-es-8s | 3.119833 | aac | `La cola crece y la carga se acelera hasta el corte.` | not installed | ok |

## Decision for Phase 4

- Do not add a language-confidence *gate* that blocks reading when ASR
  degrades. Record `degraded` on the transcript envelope and surface it.
- Music-under-speech is expected to drop words; packed transcript stays
  the first reading view, with a visible degraded badge.
- zh/es fixtures exist so later ASR tests are offline-reachable even if
  this host has no local whisper.

Command: ffprobe streams; optional `whisper` CLI if on PATH.
