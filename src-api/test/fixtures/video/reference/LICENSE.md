# Reference fixture licences

All media in this directory is original synthetic material generated for
Neumar tests. None of it is copied from a third-party video, soundtrack, or
caption track.

| File | Source | Licence |
| --- | --- | --- |
| `still-8s.mp4` | ffmpeg `lavfi` solid color | CC0-equivalent original |
| `hard-cuts-12s.mp4` | ffmpeg concat of four color holds | CC0-equivalent original |
| `fast-cut-10s.mp4` | ffmpeg concat, 500 ms holds | CC0-equivalent original |
| `dissolve-10s.mp4` | ffmpeg `xfade` between two colors | CC0-equivalent original |
| `caption-entry-12s.mp4` | ffmpeg `drawtext` over a still | CC0-equivalent original |
| `speech-music-en-8s.mp4` | macOS `say` (Samantha) + sine bed | CC0-equivalent original |
| `speech-music-zh-8s.mp4` | macOS `say` (Tingting) + sine bed | CC0-equivalent original |
| `speech-music-es-8s.mp4` | macOS `say` (Paulina) + sine bed | CC0-equivalent original |
| `coverage-40s.mp4` | ffmpeg color holds + captions (S3) | CC0-equivalent original |

`.cuts.json` and `.transcript.txt` siblings are test metadata, not third-party
scripts. Regenerator: `generate.py`.
