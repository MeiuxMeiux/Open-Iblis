# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# Job state machine + per-stage child process supervision (stdlib only).
#
# One job at a time, enforced here (the shell's pipeline also serializes).
# Each stage runs in its own python -I subprocess speaking a line protocol on
# stdout: "PROGRESS <0-100> <detail...>" then a final "RESULT <compact json>".
# Nonzero exit -> error with the last stderr lines as the honest message.

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

STAGES = (
    "scan",
    "stems",
    "tag",
    "dataset",
    "train-texture",
    "train-groove",
    "export",
    "selftest",
)

# Cancel must leave no partial outputs behind (docs/training/01): the dirs a
# stage was building are deleted relative to the job's scratch root. Earlier
# stages' finished outputs are never touched.
CLEANUP_DIRS = {
    "scan": ["originals"],
    "stems": ["stems"],
    "tag": ["tags"],
    "dataset": ["dataset_texture", "dataset_groove", "dataset_texture.json", "dataset_groove.json"],
    "train-texture": ["tensors/texture", "train_texture"],
    "train-groove": ["tensors/groove", "train_groove"],
    "export": ["output/metadata.json"],
    "selftest": ["selftest"],
}

STDERR_TAIL = 40


def _run_stage_argv() -> list:
    # Contract: <python> -I -m iblis_train.run_stage <stage> <paramsfile>.
    # Inside the pack, python311._pth puts Lib/site-packages on the isolated
    # path, so the -m form resolves. On the dev/test box (plain CPython, no
    # ._pth) -I hides the source tree, so we invoke run_stage.py by absolute
    # path instead; run_stage bootstraps its own package path. Same isolation,
    # same protocol, both documented in run_stage.py.
    if (Path(sys.executable).parent / "python311._pth").is_file():
        return [sys.executable, "-I", "-m", "iblis_train.run_stage"]
    return [sys.executable, "-I", str(Path(__file__).resolve().parent / "run_stage.py")]


class JobManager:
    def __init__(self, log_line):
        self._log = log_line
        self._lock = threading.Lock()
        self._active = None  # dict while a job runs
        self._history = {}  # job_id -> final poll dict (last few jobs)

    # -- public surface (called from HTTP handler threads) -------------------

    def start(self, stage: str, job_id: str, params: dict) -> bool:
        with self._lock:
            if self._active is not None:
                return False
            job = {
                "id": job_id,
                "stage": stage,
                "params": params,
                "state": "running",
                "percent": 0,
                "detail": "Starting...",
                "result": None,
                "error": None,
                "cancelled": False,
                "proc": None,
            }
            self._active = job
        threading.Thread(target=self._run, args=(job,), daemon=True).start()
        return True

    def poll(self, job_id: str) -> dict:
        with self._lock:
            job = self._active
            if job is not None and job["id"] == job_id:
                return self._snapshot(job)
            if job_id in self._history:
                return self._history[job_id]
        return {"state": "idle"}

    def cancel(self, job_id: str) -> bool:
        # Exact id, or the pipeline's record id (the part before ':').
        with self._lock:
            job = self._active
            if job is None:
                return False
            active_id = job["id"]
            if job_id not in (active_id, active_id.split(":", 1)[0]):
                return False
            job["cancelled"] = True
            proc = job["proc"]
        self._log(f"job {job_id}: cancel requested")
        if proc is not None:
            _kill_tree(proc)
        return True

    # -- internals ------------------------------------------------------------

    @staticmethod
    def _snapshot(job: dict) -> dict:
        out = {
            "state": job["state"],
            "stage": job["stage"],
            "percent": job["percent"],
            "detail": job["detail"],
        }
        if job["error"] is not None:
            out["error"] = job["error"]
        if job["result"] is not None:
            out["result"] = job["result"]
        return out

    def _run(self, job: dict) -> None:
        stderr_tail = []
        try:
            params_file = self._write_params(job)
            argv = _run_stage_argv() + [job["stage"], params_file]
            popen_kwargs = {
                "stdout": subprocess.PIPE,
                "stderr": subprocess.PIPE,
                "text": True,
                "encoding": "utf-8",
                "errors": "replace",
            }
            if os.name == "posix":
                popen_kwargs["start_new_session"] = True  # enables killpg
            else:
                popen_kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
            proc = subprocess.Popen(argv, **popen_kwargs)
            with self._lock:
                if job["cancelled"]:
                    _kill_tree(proc)
                job["proc"] = proc
            reader = threading.Thread(
                target=self._drain_stderr, args=(proc, stderr_tail), daemon=True
            )
            reader.start()
            for line in proc.stdout:
                self._consume(job, line)
            proc.stdout.close()
            code = proc.wait()
            reader.join(timeout=5)
            self._finish(job, code, stderr_tail)
        except Exception as unexpected:  # never leave the job stuck "running"
            self._finish_error(job, "sidecar_internal", str(unexpected))
        finally:
            self._retire(job)

    def _write_params(self, job: dict) -> str:
        scratch = job["params"].get("scratch")
        directory = None
        if isinstance(scratch, str) and scratch:
            directory = Path(scratch)
            directory.mkdir(parents=True, exist_ok=True)
        fd, path = tempfile.mkstemp(
            prefix=f"params-{job['stage']}-", suffix=".json",
            dir=str(directory) if directory else None,
        )
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(job["params"], fh)
        return path

    def _consume(self, job: dict, line: str) -> None:
        line = line.rstrip("\n")
        self._log(f"[{job['stage']}] {line}")
        if line.startswith("PROGRESS "):
            rest = line[len("PROGRESS "):]
            head, _, detail = rest.partition(" ")
            try:
                percent = max(0, min(100, int(head)))
            except ValueError:
                return
            with self._lock:
                job["percent"] = percent
                if detail:
                    job["detail"] = detail
        elif line.startswith("RESULT "):
            try:
                result = json.loads(line[len("RESULT "):])
            except ValueError:
                return
            with self._lock:
                job["result"] = result

    def _drain_stderr(self, proc, tail: list) -> None:
        for line in proc.stderr:
            line = line.rstrip("\n")
            self._log(f"[stderr] {line}")
            tail.append(line)
            del tail[:-STDERR_TAIL]
        proc.stderr.close()

    def _finish(self, job: dict, code: int, stderr_tail: list) -> None:
        with self._lock:
            cancelled = job["cancelled"]
        if cancelled:
            self._cleanup_partial(job)
            with self._lock:
                job["state"] = "cancelled"
                job["detail"] = "Cancelled."
            return
        if code == 0 and job["result"] is not None:
            with self._lock:
                job["state"] = "done"
                job["percent"] = 100
            return
        message = "\n".join(stderr_tail[-6:]).strip() or f"stage exited with code {code}"
        self._finish_error(job, "stage_failed", message)

    def _finish_error(self, job: dict, code: str, message: str) -> None:
        with self._lock:
            job["state"] = "error"
            job["error"] = {"code": code, "message": message}

    def _cleanup_partial(self, job: dict) -> None:
        scratch = job["params"].get("scratch")
        if not isinstance(scratch, str) or not scratch:
            return
        root = Path(scratch)
        for rel in CLEANUP_DIRS.get(job["stage"], []):
            target = root / rel
            try:
                if target.is_dir():
                    shutil.rmtree(target)
                elif target.exists():
                    target.unlink()
            except OSError as err:
                self._log(f"cleanup {target}: {err}")

    def _retire(self, job: dict) -> None:
        with self._lock:
            self._history[job["id"]] = self._snapshot(job)
            while len(self._history) > 8:
                self._history.pop(next(iter(self._history)))
            self._active = None


def _kill_tree(proc) -> None:
    # Kill the whole stage process tree: the stage child may itself have
    # spawned ffmpeg or the vendored trainer.
    if proc.poll() is not None:
        return
    try:
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                capture_output=True, timeout=15,
            )
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (OSError, subprocess.SubprocessError):
        try:
            proc.kill()
        except OSError:
            pass
