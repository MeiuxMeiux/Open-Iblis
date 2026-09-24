# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# /props payload: bundled component versions + lazily probed CUDA state.
# The probe runs torch in a short-lived -I subprocess so a wedged CUDA stack
# can never hang or crash the HTTP server; any failure reports null.

import json
import subprocess
import sys
import threading
from pathlib import Path

PROBE_TIMEOUT_S = 10

_probe_lock = threading.Lock()
_probe_cache = None  # (cuda, vramMb) once probed

_PROBE_CODE = (
    "import json,torch\n"
    "cuda=bool(torch.cuda.is_available())\n"
    "vram=None\n"
    "if cuda:\n"
    "    free,_total=torch.cuda.mem_get_info(0)\n"
    "    vram=int(free//1048576)\n"
    "print(json.dumps({'cuda':cuda,'vramMb':vram}))\n"
)


def pack_root() -> Path:
    # spawn.ts runs us with cwd = the pack version dir; inside the pack the
    # package sits at runtime/Lib/site-packages/iblis_train, so walking up to
    # the "runtime" dir also finds the root. cwd wins when both disagree
    # (source checkout during unit tests).
    here = Path(__file__).resolve()
    for ancestor in here.parents:
        if ancestor.name == "runtime":
            return ancestor.parent
    return Path.cwd()


def read_versions() -> dict:
    path = pack_root() / "runtime" / "versions.json"
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except (OSError, ValueError):
        return {}


def probe_cuda():
    global _probe_cache
    with _probe_lock:
        if _probe_cache is not None:
            return _probe_cache
        cuda, vram = None, None
        try:
            done = subprocess.run(
                [sys.executable, "-I", "-c", _PROBE_CODE],
                capture_output=True, text=True, timeout=PROBE_TIMEOUT_S,
            )
            if done.returncode == 0:
                parsed = json.loads(done.stdout.strip().splitlines()[-1])
                cuda = bool(parsed.get("cuda"))
                raw = parsed.get("vramMb")
                vram = int(raw) if isinstance(raw, (int, float)) else None
        except (OSError, ValueError, IndexError, subprocess.SubprocessError):
            cuda, vram = None, None
        _probe_cache = (cuda, vram)
        return _probe_cache


def collect_props() -> dict:
    cuda, vram = probe_cuda()
    return {"ok": True, "versions": read_versions(), "cuda": cuda, "vramMb": vram}
