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

No vendored Python file is patched. `SKILL.md` is Neumar's, not the upstream agent guide.

| File | Change |
| --- | --- |
| `SKILL.md` | App name `ffmpeg`, modes `task`/`design`/`video`, and instructions for MCP server `ffmpeg-skill` tools `ffmpeg_skill_catalog`, `ffmpeg_skill_check`, and `ffmpeg_skill_execute`. Rejects raw shell, raw `argv`, `transcribe`, `batch --watch`, and saved-plan replay. |
| `contract/contract.json` | Added pinned static contract for the later runner. Not an upstream path. |
| `contract/payload-hashes.txt` | Added payload inventory. Not an upstream path. |
| `PROVENANCE.md` | This file. Not an upstream path. |

`scripts/_common/asr.py` remains in the payload because `caption` and `silence` import the package, but the managed service must not pass `transcribe`. Enabling it would launch an optional local Whisper tool, which this pin does not authorize.
