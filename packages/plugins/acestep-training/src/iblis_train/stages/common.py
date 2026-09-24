# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# Shared helpers for pipeline stages (stdlib only at import time).

import re
import shutil
import sys
from pathlib import Path


class StageError(Exception):
    """An honest, user-presentable stage failure (exit code 3)."""


def pack_root() -> Path:
    here = Path(__file__).resolve()
    for ancestor in here.parents:
        if ancestor.name == "runtime":
            return ancestor.parent
    return Path.cwd()


def scratch_dir(params: dict) -> Path:
    scratch = params.get("scratch")
    if not isinstance(scratch, str) or not scratch:
        raise StageError("stage params are missing the scratch directory")
    path = Path(scratch)
    path.mkdir(parents=True, exist_ok=True)
    return path


def ffmpeg_path() -> str:
    # Bundled binary only on Windows (the shipped platform). A dev/test box
    # may fall back to a system ffmpeg; end users never take that branch —
    # the pack always carries ffmpeg/ffmpeg.exe (see tools/training-pack).
    bundled = pack_root() / "ffmpeg" / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
    if bundled.is_file():
        return str(bundled)
    if sys.platform != "win32":
        found = shutil.which("ffmpeg")
        if found:
            return found
    raise StageError("the training pack's bundled ffmpeg is missing; reinstall the pack")


def slug(text: str, limit: int = 40) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return cleaned[:limit] or "track"


def mmss(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    return f"{total // 60:02d}:{total % 60:02d}"


def apply_torch_threads(params: dict) -> None:
    try:
        threads = int(params.get("threads") or 0)
    except (TypeError, ValueError):
        threads = 0
    if threads <= 0:
        return
    try:
        import torch

        torch.set_num_threads(threads)
    except Exception:  # torch missing or misbehaving: env caps still apply
        pass


def list_originals(scratch: Path):
    originals = sorted((scratch / "originals").glob("*.wav"))
    if not originals:
        raise StageError("no ingested tracks found; run the scan stage first")
    return originals
