#!/usr/bin/env python3
"""Generate CC0 synthetic reference fixtures for Analyze Video tests.

Every clip is original generated media (lavfi color/noise + macOS `say` speech).
No third-party footage is copied. Re-run from the repository root:

    python3 src-api/test/fixtures/video/reference/generate.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WIDTH, HEIGHT, FPS = 640, 360, 24
CRF = "28"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(cmd[:12]), "..." if len(cmd) > 12 else "")
    return subprocess.run(cmd, check=True, text=True, **kwargs)


def encode_segment(color: str, seconds: float, dest: Path, audio: bool = True) -> None:
    args = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        f"color=c={color}:s={WIDTH}x{HEIGHT}:d={seconds}:r={FPS}",
    ]
    if audio:
        args += [
            "-f",
            "lavfi",
            "-i",
            f"anullsrc=r=48000:cl=stereo",
            "-shortest",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
        ]
    args += [
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        CRF,
        "-preset",
        "veryfast",
        str(dest),
    ]
    run(args)


def concat(segments: list[Path], dest: Path) -> None:
    list_path = dest.with_suffix(".concat.txt")
    list_path.write_text(
        "".join(f"file '{p.resolve().as_posix()}'\n" for p in segments)
    )
    run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(list_path),
            "-c",
            "copy",
            str(dest),
        ]
    )
    list_path.unlink(missing_ok=True)


def write_manifest(name: str, duration_ms: int, cuts_ms: list[int], notes: str) -> None:
    (ROOT / f"{name}.cuts.json").write_text(
        json.dumps(
            {
                "clip": f"{name}.mp4",
                "durationMs": duration_ms,
                "hardCutsMs": cuts_ms,
                "notes": notes,
            },
            indent=2,
        )
        + "\n"
    )


def still() -> None:
    dest = ROOT / "still-8s.mp4"
    encode_segment("0x2A3344", 8, dest)
    write_manifest("still-8s", 8000, [], "Solid color. No editorial cuts.")


def hard_cuts() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        colors = ["0xC0392B", "0x27AE60", "0x2980B9", "0xF1C40F"]
        segs = []
        for i, color in enumerate(colors):
            p = tmp_path / f"seg{i}.mp4"
            encode_segment(color, 3, p)
            segs.append(p)
        concat(segs, ROOT / "hard-cuts-12s.mp4")
    write_manifest(
        "hard-cuts-12s",
        12000,
        [3000, 6000, 9000],
        "Four 3s color holds. Instant cuts at 3/6/9s.",
    )


def fast_cut() -> None:
    palette = [
        "0xE74C3C",
        "0x8E44AD",
        "0x3498DB",
        "0x1ABC9C",
        "0xF39C12",
        "0x2ECC71",
        "0xE67E22",
        "0x9B59B6",
    ]
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        segs = []
        n = 20
        for i in range(n):
            p = tmp_path / f"seg{i:02d}.mp4"
            encode_segment(palette[i % len(palette)], 0.5, p)
            segs.append(p)
        concat(segs, ROOT / "fast-cut-10s.mp4")
    write_manifest(
        "fast-cut-10s",
        10000,
        [500 * i for i in range(1, 20)],
        "Music-video analog: a hard cut every 500 ms (19 cuts in 10s).",
    )


def dissolve() -> None:
    dest = ROOT / "dissolve-10s.mp4"
    run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c=0x1ABC9C:s={WIDTH}x{HEIGHT}:d=6:r={FPS}",
            "-f",
            "lavfi",
            "-i",
            f"color=c=0x8E44AD:s={WIDTH}x{HEIGHT}:d=6:r={FPS}",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-filter_complex",
            "[0:v][1:v]xfade=transition=fade:duration=2:offset=4[v]",
            "-map",
            "[v]",
            "-map",
            "2:a",
            "-t",
            "10",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            CRF,
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            str(dest),
        ]
    )
    write_manifest(
        "dissolve-10s",
        10000,
        [],
        "2s crossfade starting at 4s. Weak adjacent-frame scores expected.",
    )


def caption_entry() -> None:
    dest = ROOT / "caption-entry-12s.mp4"
    # Homebrew ffmpeg builds often omit libfreetype, so caption entry is
    # modeled as timed overlay bars rather than drawtext glyphs.
    vf = (
        "drawbox=x=80:y=90:w=480:h=36:color=white@1:t=fill:enable='gte(t,3)',"
        "drawbox=x=120:y=160:w=400:h=28:color=yellow@1:t=fill:enable='gte(t,6)',"
        "drawbox=x=60:y=230:w=160:h=22:color=white@1:t=fill:enable='gte(t,9)',"
        "drawbox=x=240:y=230:w=160:h=22:color=white@1:t=fill:enable='gte(t,9.4)',"
        "drawbox=x=420:y=230:w=160:h=22:color=white@1:t=fill:enable='gte(t,9.8)'"
    )
    run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c=0x111827:s={WIDTH}x{HEIGHT}:d=12:r={FPS}",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-vf",
            vf,
            "-t",
            "12",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            CRF,
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            str(dest),
        ]
    )
    write_manifest(
        "caption-entry-12s",
        12000,
        [],
        "Near-still background. Overlay bars enter at 3s, 6s, 9/9.4/9.8s. Interval sampling required.",
    )


def speech_under_music(stem: str, voice: str, text: str, language: str) -> None:
    dest = ROOT / f"{stem}.mp4"
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        aiff = tmp_path / "speech.aiff"
        wav = tmp_path / "speech.wav"
        mixed = tmp_path / "mix.wav"
        say = shutil.which("say")
        if not say:
            raise SystemExit("macOS `say` is required to generate speech fixtures")
        run([say, "-v", voice, "-r", "180", "-o", str(aiff), text])
        run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(aiff),
                str(wav),
            ]
        )
        # Music bed: two sine tones under the speech, quieter than the voice.
        run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(wav),
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=220:sample_rate=48000",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=330:sample_rate=48000",
                "-filter_complex",
                "[1:a][2:a]amix=inputs=2:duration=first,volume=0.18[bed];"
                "[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.0[voice];"
                "[voice][bed]amix=inputs=2:duration=first:weights=1 0.35[a]",
                "-map",
                "[a]",
                "-t",
                "8",
                str(mixed),
            ]
        )
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                str(mixed),
            ],
            check=True,
            text=True,
            capture_output=True,
        )
        duration = float((probe.stdout or "0").strip() or "0")
        if duration < 1:
            raise RuntimeError(f"speech bed for {stem} is only {duration:.3f}s")
        run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"color=c=0x1F2937:s={WIDTH}x{HEIGHT}:d={max(8.0, duration)}:r={FPS}",
                "-i",
                str(mixed),
                "-shortest",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                CRF,
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                str(dest),
            ]
        )
    write_manifest(
        stem,
        8000,
        [],
        f"{language} speech under a sine music bed. Script: {text!r}",
    )
    (ROOT / f"{stem}.transcript.txt").write_text(text + "\n")


def coverage_40s() -> None:
    """S3 density fixture: 40s of colored holds plus caption events."""
    dest = ROOT / "coverage-40s.mp4"
    colors = ["0x111827", "0x1F2937", "0x374151", "0x4B5563"]
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        segs = []
        for i, color in enumerate(colors):
            p = tmp_path / f"seg{i}.mp4"
            encode_segment(color, 10, p)
            segs.append(p)
        concat(segs, dest)
    # Overlay captions on the concatenated file so S3 has motion between similar frames.
    labeled = ROOT / "coverage-40s-labeled.mp4"
    run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(dest),
            "-vf",
            "drawbox=x=80:y=70:w=480:h=40:color=white@1:t=fill:enable='between(t,1,6)',"
            "drawbox=x=80:y=160:w=480:h=40:color=yellow@1:t=fill:enable='between(t,14,22)',"
            "drawbox=x=80:y=250:w=480:h=40:color=white@1:t=fill:enable='gte(t,32)'",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            CRF,
            "-c:a",
            "copy",
            str(labeled),
        ]
    )
    dest.unlink()
    labeled.rename(dest)
    write_manifest(
        "coverage-40s",
        40000,
        [10000, 20000, 30000],
        "Four 10s holds with captions at 1–6s, 14–22s, 32–40s. Used by S3.",
    )


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    still()
    hard_cuts()
    fast_cut()
    dissolve()
    caption_entry()
    speech_under_music(
        "speech-music-en-8s",
        "Samantha",
        "The queue grows and the workload accelerates until the hold.",
        "en",
    )
    speech_under_music(
        "speech-music-zh-8s",
        "Tingting",
        "队列变长，工作负载加速，然后稳住。",
        "zh",
    )
    speech_under_music(
        "speech-music-es-8s",
        "Paulina",
        "La cola crece y la carga se acelera hasta el corte.",
        "es",
    )
    coverage_40s()
    print("Wrote fixtures to", ROOT)


if __name__ == "__main__":
    main()
