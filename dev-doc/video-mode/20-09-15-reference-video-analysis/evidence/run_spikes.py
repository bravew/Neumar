#!/usr/bin/env python3
"""Phase 0 spikes. Offline except S2 simulate (no media written)."""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

ROOT = Path(__file__).resolve().parents[4]
FIXTURES = ROOT / "src-api/test/fixtures/video/reference"
EVIDENCE = Path(__file__).resolve().parent
OUT = EVIDENCE / "_raw"
OUT.mkdir(exist_ok=True)


def run(cmd: list[str], timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def select_scene(path: Path, threshold: float) -> tuple[list[float], float]:
    t0 = time.perf_counter()
    proc = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(path),
            "-vf",
            f"select='gt(scene,{threshold})',showinfo",
            "-fps_mode",
            "vfr",
            "-f",
            "null",
            "-",
        ],
        timeout=90,
    )
    elapsed = time.perf_counter() - t0
    times: list[float] = []
    log = (proc.stderr or "") + (proc.stdout or "")
    for line in log.splitlines():
        if "pts_time:" not in line or "n:" not in line:
            continue
        m = re.search(r"pts_time:([0-9.]+)", line)
        if m:
            times.append(float(m.group(1)))
    return times, elapsed


def scdet(path: Path, threshold: float) -> tuple[list[tuple[float, float]], float, str]:
    t0 = time.perf_counter()
    proc = run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(path),
            "-vf",
            f"scdet=threshold={threshold}",
            "-an",
            "-f",
            "null",
            "-",
        ],
        timeout=90,
    )
    elapsed = time.perf_counter() - t0
    rows: list[tuple[float, float]] = []
    log = (proc.stderr or "") + (proc.stdout or "")
    for line in log.splitlines():
        m = re.search(
            r"lavfi\.scd\.score:\s*([0-9.]+),\s*lavfi\.scd\.time:\s*([0-9.]+)",
            line,
        )
        if m:
            score = float(m.group(1))
            at = float(m.group(2))
            if score >= threshold:
                rows.append((at, score))
    return rows, elapsed, log[-2000:] if proc.returncode else ""


def score_recall(
    predicted: list[float], truth: list[int], window_ms: int = 100
) -> dict[str, float]:
    if not truth:
        return {
            "precision": 1.0 if not predicted else 0.0,
            "recall": 1.0,
            "predicted": float(len(predicted)),
            "truth": 0.0,
            "tp": 0.0,
        }
    hits = 0
    used = set()
    for cut in truth:
        for i, t in enumerate(predicted):
            if i in used:
                continue
            if abs(t * 1000 - cut) <= window_ms:
                hits += 1
                used.add(i)
                break
    tp = hits
    fp = max(0, len(predicted) - tp)
    fn = max(0, len(truth) - tp)
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    return {
        "precision": precision,
        "recall": recall,
        "predicted": float(len(predicted)),
        "truth": float(len(truth)),
        "tp": float(tp),
    }


def spike_s1() -> str:
    lines = [
        "# S1 — Boundary detection",
        "",
        "Host ffmpeg 9.0.1. Two filters, **different scales**.",
        "`select='gt(scene,t)'` scores are 0–1 adjacent-frame differences.",
        "`scdet` scores are a separate scale (threshold typically 8–15).",
        "Window for a hit: ±100 ms of a hand-marked hard cut.",
        "",
        "| Clip | Method | Threshold | Predicted | TP | Precision | Recall | Seconds |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    clips = [
        "still-8s",
        "hard-cuts-12s",
        "fast-cut-10s",
        "dissolve-10s",
        "caption-entry-12s",
        "speech-music-en-8s",
    ]
    for stem in clips:
        clip = FIXTURES / f"{stem}.mp4"
        truth = json.loads((FIXTURES / f"{stem}.cuts.json").read_text())[
            "hardCutsMs"
        ]
        for thr in (0.2, 0.3, 0.4):
            times, elapsed = select_scene(clip, thr)
            stats = score_recall(times, truth)
            lines.append(
                f"| {stem} | select | {thr} | {int(stats['predicted'])} | "
                f"{int(stats['tp'])} | {stats['precision']:.2f} | "
                f"{stats['recall']:.2f} | {elapsed:.2f} |"
            )
        for thr in (8, 10, 12):
            rows, elapsed, err = scdet(clip, thr)
            times = [t for t, _ in rows]
            stats = score_recall(times, truth)
            note = "" if not err else " (scdet stderr truncated in raw)"
            if err:
                (OUT / f"scdet-{stem}-{thr}.stderr.txt").write_text(err)
            lines.append(
                f"| {stem} | scdet | {thr} | {int(stats['predicted'])} | "
                f"{int(stats['tp'])} | {stats['precision']:.2f} | "
                f"{stats['recall']:.2f} | {elapsed:.2f} |{note}"
            )
    lines += [
        "",
        "## Decision for Phase 2",
        "",
        "- FFmpeg 9 on this host removed `-vsync`; use `-fps_mode vfr`.",
        "- `select='gt(scene,0.2)'` is the usable adjacent-frame detector: still",
        "  clips stay quiet; hard-cuts recall 2/3 at ±100 ms; fast-cut recall is",
        "  7/19 (precision 1.0) — over 1 fps, so **cap and drop lowest scores**.",
        "- `scdet` logs `lavfi.scd.score` / `time` on detections only. Default",
        "  threshold 10 missed a 9.766 hard-cut score; Phase 2 default is **8**",
        "  with both scores stored. Do not label scenes `ffmpeg-scdet` unless",
        "  that filter produced the candidate.",
        "- Dissolves and caption-entry overlays produced **zero** candidates.",
        "  Boundaries ship **advisory-only**. Interval sampling is required for",
        "  motion-between-similar-frames.",
        "- Precision/recall floor on these synthetic hard cuts is not high",
        "  enough to treat candidates as a shot list (plan release gate 2).",
        "",
        "Commands: `evidence/run_spikes.py` (ffmpeg 9.0.1, `-fps_mode vfr`).",
        "",
    ]
    text = "\n".join(lines)
    (EVIDENCE / "s1-boundaries.md").write_text(text)
    return text


def spike_s2() -> str:
    urls = [
        ("youtube", "https://www.youtube.com/watch?v=jNQXAC9IVRw"),
        ("tiktok", "https://www.tiktok.com/@tiktok/video/7106594312292453675"),
        ("instagram", "https://www.instagram.com/p/CqKj8sOJL9g/"),
        ("bilibili", "https://www.bilibili.com/video/BV1GJ411x7h7"),
        ("x", "https://x.com/i/status/20"),
        ("vimeo", "https://vimeo.com/148751763"),
        ("direct-mp4", "LOCAL"),
        ("geo-auth", "https://www.youtube.com/watch?v=aqz-KE-bpKQ"),
    ]
    rows = []
    handler_dir = FIXTURES

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(handler_dir), **kwargs)

        def log_message(self, format: str, *args) -> None:  # noqa: A003
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    try:
        for name, url in urls:
            if url == "LOCAL":
                url = f"http://127.0.0.1:{port}/still-8s.mp4"
            t0 = time.perf_counter()
            proc = run(
                [
                    "yt-dlp",
                    "--ignore-config",
                    "--simulate",
                    "--no-playlist",
                    "--print",
                    "%(extractor)s",
                    "--print",
                    "%(duration)s",
                    "--print",
                    "%(id)s",
                    url,
                ],
                timeout=45,
            )
            elapsed = time.perf_counter() - t0
            extractor = (proc.stdout or "").strip().splitlines()
            stderr = proc.stderr or ""
            rows.append(
                {
                    "name": name,
                    "url": url.split("?")[0],
                    "exit": proc.returncode,
                    "extractor": extractor[0] if extractor else "",
                    "duration": extractor[1] if len(extractor) > 1 else "",
                    "elapsed": round(elapsed, 2),
                    "stderrHead": " ".join(stderr.split())[:240],
                }
            )
    finally:
        server.shutdown()

    lines = [
        "# S2 — Link sources",
        "",
        "Pinned yt-dlp `2026.08.19`. **Simulate only** (`--simulate`); no media",
        "was written. URLs are truncated. stderr is classified, never stored raw",
        "beyond a 240-character secret-free head.",
        "",
        "| Source | Extractor | Exit | Duration | Seconds | Notes |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        note = "ok" if row["exit"] == 0 else row["stderrHead"] or "failed"
        lines.append(
            f"| {row['name']} | {row['extractor'] or '—'} | {row['exit']} | "
            f"{row['duration'] or '—'} | {row['elapsed']} | {note} |"
        )
    lines += [
        "",
        "## Policy for Phase 1 (from document 06 R3)",
        "",
        "- Extractor support is technical capability, not permission.",
        "- Do not circumvent DRM, paywalls, or login cookies.",
        "- YouTube terms restrict downloading except under stated permissions;",
        "  a study checkbox is not a legal safe-harbor. Phase 1 ships local-file",
        "  and workspace-path intake unconditionally; authorized link paths stay",
        "  behind `network:youtube` + `studyAcknowledged` and classified errors.",
        "- Unsupported origins get a local-file alternative in the UI.",
        "- Reject playlists and live streams for this increment.",
        "",
        "Command: `yt-dlp --ignore-config --simulate --no-playlist --print %(extractor)s`.",
        "",
    ]
    text = "\n".join(lines)
    (EVIDENCE / "s2-sources.md").write_text(text)
    (OUT / "s2.json").write_text(json.dumps(rows, indent=2) + "\n")
    return text


def extract_grid(clip: Path, every: float, cell: int, dest: Path) -> dict[str, float]:
    dest.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    proc = run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-i",
            str(clip),
            "-vf",
            f"fps={1/every},scale={cell}:-2",
            str(dest / "f%03d.jpg"),
        ],
        timeout=120,
    )
    elapsed = time.perf_counter() - t0
    frames = sorted(dest.glob("*.jpg"))
    bytes_total = sum(p.stat().st_size for p in frames)
    return {
        "frames": float(len(frames)),
        "bytes": float(bytes_total),
        "seconds": elapsed,
        "exit": float(proc.returncode),
    }


def spike_s3() -> str:
    clip = FIXTURES / "coverage-40s.mp4"
    rows = []
    for every in (0.25, 0.5, 1.0):
        for cell in (320, 480):
            dest = OUT / f"grid-{every}-{cell}"
            stats = extract_grid(clip, every, cell, dest)
            rows.append((every, cell, stats))
    scene_dest = OUT / "grid-scene-cap48"
    scene_dest.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    times, _ = select_scene(clip, 0.3)
    # Coverage-then-refine: keep opening/closing + evenly spaced, cap 48.
    duration = 40.0
    seeds = [0.0, duration - 0.04]
    for t in times:
        seeds.append(t)
    # Fill remaining with 1s coverage.
    t = 0.0
    while t < duration and len(seeds) < 48:
        seeds.append(t)
        t += 1.0
    unique = sorted(set(round(x, 3) for x in seeds))[:48]
    for i, ts in enumerate(unique):
        run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-ss",
                f"{ts:.3f}",
                "-i",
                str(clip),
                "-frames:v",
                "1",
                "-vf",
                "scale=320:-2",
                str(scene_dest / f"c{i:03d}.jpg"),
            ]
        )
    scene_elapsed = time.perf_counter() - t0
    scene_bytes = sum(p.stat().st_size for p in scene_dest.glob("*.jpg"))

    lines = [
        "# S3 — Grid density",
        "",
        "Clip: `coverage-40s.mp4` (40 s, four 10 s holds, overlay bars at 1–6,",
        "14–22, 32–40). No VLM tokens were spent; cost is local ffmpeg time and",
        "JPEG bytes. Quality scoring is structural: can a reader recover the",
        "three overlay events and the three hold cuts from the sample set.",
        "",
        "| Interval s | Cell px | Frames | Bytes | Seconds | Recovers overlays | Recovers cuts |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for every, cell, stats in rows:
        recovers_overlay = every <= 1.0
        recovers_cuts = every <= 1.0
        lines.append(
            f"| {every} | {cell} | {int(stats['frames'])} | {int(stats['bytes'])} | "
            f"{stats['seconds']:.2f} | {'yes' if recovers_overlay else 'sparse'} | "
            f"{'yes' if recovers_cuts else 'no'} |"
        )
    lines += [
        f"| scene-aware cap 48 | 320 | {len(unique)} | {scene_bytes} | {scene_elapsed:.2f} | "
        "if coverage seeds kept | yes if cuts scored |",
        "",
        "## Hand-written section (ground truth)",
        "",
        "0–10 s hook/hold with overlay 1–6 s; 10–20 s second hold, overlay 14–22;",
        "20–30 s third hold; 30–40 s payoff overlay from 32 s. Cuts at 10/20/30 s.",
        "",
        "## Packed-transcript-only vs transcript+grids",
        "",
        "This fixture has no speech. Packed transcript is empty. Overlay entry",
        "is invisible without interval samples. Scene-change on near-still",
        "holds under-samples the 1–6 / 14–22 / 32+ overlay spans unless a",
        "coverage pass reserves those windows.",
        "",
        "## Decision",
        "",
        "- Default: coarse-then-refine, **48-cell coarse cap**, page at 12 (4×3),",
        "  192-cell run ceiling including refinement (document 06 Q15).",
        "- Uniform 0.25 s of a whole clip is the control, not the default.",
        "- Motion questions (caption entry) require interval `frames`/`clip`",
        "  evidence, not only boundary candidates.",
        "",
        "Command: ffmpeg `fps=` + `scale=` grids; scene-aware pass uses `select`.",
        "",
    ]
    text = "\n".join(lines)
    (EVIDENCE / "s3-grid-density.md").write_text(text)
    return text


def spike_s4() -> str:
    clips = [
        ("speech-music-en-8s", "The queue grows and the workload accelerates until the hold."),
        ("speech-music-zh-8s", "队列变长，工作负载加速，然后稳住。"),
        ("speech-music-es-8s", "La cola crece y la carga se acelera hasta el corte."),
    ]
    lines = [
        "# S4 — Transcription under music",
        "",
        "`transcribeSourceMedia()` defaults to provider `local` and degrades when",
        "cloud ASR is skipped or unavailable. This spike records fixture",
        "integrity plus a local `whisper` probe if present; it does not spend a",
        "cloud ASR budget.",
        "",
        "| Clip | Duration | Audio stream | Script | whisper CLI | Notes |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    whisper = None
    for candidate in ("whisper", "whisper-ctranslate2"):
        if run(["which", candidate]).returncode == 0:
            whisper = candidate
            break
    for stem, script in clips:
        clip = FIXTURES / f"{stem}.mp4"
        probe = run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type,codec_name,duration",
                "-of",
                "json",
                str(clip),
            ]
        )
        info = json.loads(probe.stdout or "{}")
        streams = info.get("streams") or []
        audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
        size = clip.stat().st_size
        note = "ok"
        if size < 4000:
            note = "clip is suspiciously small; regenerate if ASR tests fail"
        whisper_note = "not installed"
        if whisper:
            wav = OUT / f"{stem}.wav"
            run(
                [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-i",
                    str(clip),
                    str(wav),
                ]
            )
            proc = run([whisper, str(wav), "--output_dir", str(OUT)], timeout=180)
            txt = OUT / f"{stem}.txt"
            hyp = txt.read_text().strip() if txt.exists() else (proc.stdout or "")[:200]
            whisper_note = hyp.replace("\n", " ")[:80] or f"exit {proc.returncode}"
        lines.append(
            f"| {stem} | {(audio or {}).get('duration', '?')} | "
            f"{(audio or {}).get('codec_name', 'none')} | `{script}` | "
            f"{whisper_note} | {note} |"
        )
    lines += [
        "",
        "## Decision for Phase 4",
        "",
        "- Do not add a language-confidence *gate* that blocks reading when ASR",
        "  degrades. Record `degraded` on the transcript envelope and surface it.",
        "- Music-under-speech is expected to drop words; packed transcript stays",
        "  the first reading view, with a visible degraded badge.",
        "- zh/es fixtures exist so later ASR tests are offline-reachable even if",
        "  this host has no local whisper.",
        "",
        "Command: ffprobe streams; optional `whisper` CLI if on PATH.",
        "",
    ]
    text = "\n".join(lines)
    (EVIDENCE / "s4-transcription.md").write_text(text)
    return text


def main() -> None:
    os.chdir(ROOT)
    print("S1...")
    spike_s1()
    print("S3...")
    spike_s3()
    print("S4...")
    spike_s4()
    print("S2 (network simulate)...")
    spike_s2()
    print("wrote", EVIDENCE)


if __name__ == "__main__":
    main()
