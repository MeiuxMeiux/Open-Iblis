# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# Child entry for a single pipeline stage.
#
# Contract (jobs.py is the only caller):
#   <python> -I -m iblis_train.run_stage <stage> <paramsfile.json>
# In a source checkout (unit tests, no embedded ._pth) jobs.py invokes this
# file by absolute path instead; the bootstrap below restores the package
# path that -m would have had. Identical isolation and protocol either way.
#
# Protocol on stdout: "PROGRESS <0-100> <detail...>" lines, then exactly one
# "RESULT <compact json>". Anything on stderr is diagnostics; the parent
# reports the tail of it when the exit code is nonzero.

import json
import os
import sys
from pathlib import Path

if __package__ in (None, ""):  # script-path invocation (dev box)
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

STAGE_MODULES = {
    "scan": "scan",
    "stems": "stems",
    "tag": "tag",
    "dataset": "dataset",
    "train-texture": "train",
    "train-groove": "train",
    "export": "export",
    "selftest": "selftest",
}


def _apply_thread_cap(params: dict) -> None:
    # The shell resolves the balanced perf-profile cap (never max — BSOD
    # rule) and passes it as params.threads; export it before any heavy
    # import so OpenMP/MKL pools and the vendored trainer inherit it.
    try:
        threads = int(params.get("threads") or 0)
    except (TypeError, ValueError):
        threads = 0
    if threads <= 0:
        return
    for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_MAX_THREADS"):
        os.environ.setdefault(var, str(threads))
    os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")


def _progress(percent, detail: str) -> None:
    print(f"PROGRESS {max(0, min(100, int(percent)))} {detail}", flush=True)


def main(argv) -> int:
    if len(argv) != 2:
        print("usage: run_stage <stage> <paramsfile.json>", file=sys.stderr)
        return 2
    stage, params_path = argv
    module_name = STAGE_MODULES.get(stage)
    if module_name is None:
        print(f"unknown stage: {stage}", file=sys.stderr)
        return 2
    try:
        with open(params_path, "r", encoding="utf-8") as fh:
            params = json.load(fh)
    except (OSError, ValueError) as err:
        print(f"cannot read stage params: {err}", file=sys.stderr)
        return 2
    if stage.startswith("train-"):
        params = dict(params)
        params.setdefault("category", stage.split("-", 1)[1])

    _apply_thread_cap(params)

    import importlib

    from iblis_train.stages.common import StageError

    module = importlib.import_module(f"iblis_train.stages.{module_name}")
    try:
        result = module.run(params, _progress)
    except StageError as err:
        print(str(err), file=sys.stderr)
        return 3
    print("RESULT " + json.dumps(result, separators=(",", ":")), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
