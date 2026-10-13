#!/usr/bin/env python3
"""Generate the interactive-transcript acceptance fixture (T8).

A short talking-head stand-in: a colour background plus a real audio track of
balanced noise, so `ffmpeg` reports an audio stream and the API can register a
source for it. The transcript itself is not recognized from this audio — the
acceptance spec seeds the transcript cache, which is what makes the flow
deterministic without an ASR provider or network access.

Run from the repository root:

    python3 tests/e2e/fixtures/video/transcript/generate.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEST = ROOT / "transcript-source.mp4"
WIDTH, HEIGHT, FPS = 640, 360, 24
DURATION = "12"
CRF = "30"


def run(cmd: list[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main() -> int:
    if subprocess.run(["which", "ffmpeg"], capture_output=True).returncode != 0:
        print("ffmpeg is required to generate this fixture", file=sys.stderr)
        return 1
    run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            # Voice-like fundamental plus harmonics: enough for a probe to find
            # an audio stream, and stable enough that hashes do not drift.
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=180:duration={DURATION}:sample_rate=48000",
            "-f",
            "lavfi",
            "-i",
            f"color=c=#203040:s={WIDTH}x{HEIGHT}:d={DURATION}:r={FPS}",
            "-filter_complex",
            "[0:a]volume=0.6,aformat=channel_layouts=stereo[a]",
            "-map",
            "[a]",
            "-map",
            "1:v",
            "-shortest",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            CRF,
            "-preset",
            "veryslow",
            "-g",
            str(FPS * 2),
            "-movflags",
            "+faststart",
            str(DEST),
        ]
    )
    print(f"wrote {DEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
