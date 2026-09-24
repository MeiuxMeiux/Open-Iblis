# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# selftest: hidden stage for the unit suite and dev probes. Only reachable
# when the server was started with IBLIS_TRAIN_SELFTEST=1 (server.py gates
# it). Sleeps through N progress ticks, drops a marker dir so the cancel
# cleanup path is observable, then reports a result.

import time

from .common import scratch_dir


def run(params: dict, progress) -> dict:
    steps = max(1, int(params.get("steps") or 20))
    delay_s = float(params.get("delayMs") or 25) / 1000.0
    marker_dir = None
    if params.get("scratch"):
        marker_dir = scratch_dir(params) / "selftest"
        marker_dir.mkdir(parents=True, exist_ok=True)
        (marker_dir / "marker.txt").write_text("selftest in progress\n", encoding="utf-8")
    for step in range(steps):
        progress((step * 100) // steps, f"selftest step {step + 1}/{steps}")
        time.sleep(delay_s)
    if marker_dir is not None:
        (marker_dir / "marker.txt").unlink(missing_ok=True)
        marker_dir.rmdir()
    return {"ok": True, "steps": steps}
