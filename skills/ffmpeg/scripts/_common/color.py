"""Colour: the bt709 tagging arguments and the HDR-to-SDR conversion path, plus colour-token
validation for the tools that take a `--color`.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple
from _common.emit import die
from _common.runner import ffmpeg_version


# The SDR matrices (ffprobe's names) whose pixels an output tagged BT.709 has to convert: BT.601
# (`smpte170m` 525-line, `bt470bg` 625-line: the same coefficients) and the two rare pre-BT.709
# ones the colorspace filter also reads. bt2020nc/c sources take the HDR/BT.2020 path.
NON_BT709_MATRICES = ("smpte170m", "bt470bg", "fcc", "smpte240m")


def bt709_matrix_filter(meta: "Optional[Dict[str, Any]]") -> "Optional[str]":
    """The filter that converts the probed source's pixels to BT.709, or None when nothing needs
    converting: only an SDR source tagged with a non-BT.709 matrix (NON_BT709_MATRICES). An
    untagged or BT.709 source, an HDR/BT.2020 one (it keeps its own tags, or color.py --to-sdr
    converts it) and a missing probe get None, so their commands are what they were.

    The matrix is converted and nothing else: primaries and transfer are passed through
    (iprimaries/itrc = the output's), so the picture a player that decodes with the source's
    matrix showed is the picture the BT.709 output shows. The `colorspace` filter is in every
    FFmpeg build (no zscale needed) and takes explicit input properties, so the conversion does
    not depend on how a build reads or negotiates the frames' own tags. The range is left as it
    is. One -vf / -filter_complex accepts this string as it stands; a tool's own filter graph
    is not replaced by it -- runner.run() folds it in (see _fold_bt709_matrix)."""
    v = (meta or {}).get("video") or {}
    matrix = v.get("color_space")
    wide = v.get("color_primaries") == "bt2020" or v.get("color_transfer") in ("smpte2084", "arib-std-b67")
    if wide or matrix not in NON_BT709_MATRICES:
        return None
    return f"colorspace=ispace={matrix}:iprimaries=bt709:itrc=bt709:space=bt709:primaries=bt709:trc=bt709"


def bt709_matrix_args(meta: "Optional[Dict[str, Any]]") -> List[str]:
    """["-vf", bt709_matrix_filter(meta)] for an encoder line that tags its output BT.709, or [].

    An encoder line whose tags are BT.709 but whose pixels are not is the reproduced defect: a
    BT.601 source came out labelled BT.709 over BT.601 pixels (measured on the managed crop tool
    through FFmpeg 9.0.2: pure red decoded as 255,24,0 instead of 254,0,0). This appends the
    conversion once for the whole command; run() folds it into the tool's own graph before the
    command is recorded or run, so a tool's -vf still applies."""
    f = bt709_matrix_filter(meta)
    return ["-vf", f] if f else []


_MATRIX_FILTER_RE = re.compile(r"^colorspace=ispace=(?:%s):iprimaries=bt709:itrc=bt709:space=bt709:primaries=bt709:trc=bt709$"
                               % "|".join(NON_BT709_MATRICES))


def _fold_bt709_matrix(cmd: "Sequence[str]") -> List[str]:
    """`cmd` with the conversion bt709_matrix_args() appended to its encoder line moved into the
    tool's own filter graph, where it runs first, on the decoded source:

    - no other filter: unchanged (the -vf is the graph);
    - a -vf: the conversion is prepended to that chain;
    - a -filter_complex: a `[0:v]` / `[0:v:0]` reference to the command's first input reads that
      input through the conversion instead. Other inputs are untouched (an overlay's still is
      not converted by the base picture's matrix).

    A -filter_complex with no `[0:v]` reference is left as it is rather than run with two graphs.
    Every other command is returned unchanged. Folding happens once per command; a command that
    already carries the conversion is returned as it is."""
    out: List[str] = []
    conv, at = None, -1
    i = 0
    while i < len(cmd):
        if cmd[i] == "-vf" and i + 1 < len(cmd) and _MATRIX_FILTER_RE.match(str(cmd[i + 1])):
            conv, at = conv or str(cmd[i + 1]), (at if at >= 0 else len(out))
            i += 2
            continue
        out.append(cmd[i])
        i += 1
    if conv is None:
        return list(cmd)
    graph_at = next((k for k, a in enumerate(out[:-1]) if a in ("-filter_complex", "-lavfi")), None)
    if graph_at is not None:
        graph = str(out[graph_at + 1])
        ref = next((r for r in ("[0:v]", "[0:v:0]") if r in graph), None)
        if ref is None:
            return out  # the graph never reads input 0's video, so nothing needs converting
        out[graph_at + 1] = f"{ref}{conv}[bt709src];" + graph.replace(ref, "[bt709src]", 1)
        return out
    vf_at = next((k for k, a in enumerate(out[:-1]) if a == "-vf"), None)
    if vf_at is not None:
        out[vf_at + 1] = f"{conv},{out[vf_at + 1]}"
        return out
    return out[:at] + ["-vf", conv] + out[at:]


def bt709_tag_args(encoder: str = "libx264", meta: "Optional[Dict[str, Any]]" = None) -> List[str]:
    """Tag an SDR output as BT.709, converting a non-BT.709 source's pixels to match.

    Up to FFmpeg 7.0 the output options -colorspace/-color_primaries/-color_trc were tags only.
    7.1 added colourspace negotiation to libavfilter and feeds those options into the graph's
    output constraints, so on a source whose bitstream carries no colour tags (test sources,
    screen recordings, many cameras) the CLI now auto-inserts a *real* matrix conversion (its
    guess for "unknown" is bt601) into every SDR re-encode: a --lut-strength 0 no-op grade
    came back ~24 dB PSNR from its source on 7.1. From 7.1 on, the tags therefore go through
    the encoder's own VUI parameters instead, which libavfilter never sees.

    These tags are a label on every FFmpeg version: they never convert the pixels. A source
    whose matrix is not BT.709 (a BT.601 `smpte170m`/`bt470bg` file) gets its pixels converted
    separately, by bt709_matrix_args(); through 2.4.2 nothing did, and such a source came out
    labelled BT.709 over BT.601 pixels. An HDR/BT.2020 source keeps its own tags (the old path
    leaves it alone; the encoder VUI is a label, not a conversion).
    """
    if ffmpeg_version() < (7, 1):
        return ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"] + bt709_matrix_args(meta)
    if encoder == "libx265":
        return ["-x265-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709"] + bt709_matrix_args(meta)
    return ["-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709"] + bt709_matrix_args(meta)


def _sdr_bt709(encoder: str) -> "Tuple[str, List[str]]":
    """BT.709 SDR tags for `encoder` as (encoder-params string, extra output options): the two
    spellings bt709_tag_args() picks between, split so a caller that already builds an encoder
    params string can merge them (the option given twice keeps only the last)."""
    if ffmpeg_version() < (7, 1):
        return "", ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
    if encoder == "libsvtav1":
        return "color-primaries=1:transfer-characteristics=1:matrix-coefficients=1", []
    if encoder == "libaom-av1":
        return "", []  # no VUI params option; an untagged 8-bit stream reads as BT.709 everywhere
    return "colorprim=bt709:transfer=bt709:colormatrix=bt709", []


def color_hex(value: str) -> str:
    """Normalise '#ffd200' / 'ffd200' / '0xFFD200' to 'FFD200'."""
    v = str(value).strip().lstrip("#")
    if v.lower().startswith("0x"):
        v = v[2:]
    if len(v) != 6:
        die(f"colour must be RRGGBB, got '{value}'")
    return v.upper()


_COLOR_TOKEN_RE = re.compile(r"^(0[xX][0-9A-Fa-f]{6,8}|#[0-9A-Fa-f]{6,8}|[A-Za-z][A-Za-z0-9]*)(@(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?$")  # alpha is 0..1; "red@2" used to reach ffmpeg


def validate_color(value: str, flag: str = "--color") -> str:
    """Refuse a colour argument that isn't a plain ffmpeg colour token (named colour, 0xRRGGBB[AA],
    #RRGGBB[AA], optionally with an @alpha suffix). Every caller that string-formats a colour flag
    straight into a filter graph (color=c=..., tpad=...:color=..., rotate=...:fillcolor=...) must
    validate it first -- ffmpeg filter options are comma/colon-delimited, so an unvalidated value
    containing those characters lets a caller splice in an entirely different filter (a real,
    demonstrated filter-graph injection: --color "black,drawtext=text=..." renders arbitrary burnt-in
    text), not just an odd colour. This is the same "no filter graph accepted from the caller"
    invariant every other typed flag in this codebase already holds to."""
    if not _COLOR_TOKEN_RE.match(value):
        die(f"{flag} must be a plain colour (a name, 0xRRGGBB[AA], or #RRGGBB[AA], optionally @alpha), got '{value}'")
    return value
