# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# Loopback HTTP surface of the training sidecar (stdlib only — see
# __init__.py). Serves exactly the contract the shell's sidecar-client.ts
# speaks: /health, /props, /job (start/poll/cancel), /logs.
#
# Security model: binds 127.0.0.1 only; every request (including /health —
# the shell's health poll carries the header too, see the shell's
# sidecar/health.ts) must present X-Iblis-Session matching env IBLIS_SESSION
# or it gets a 403. The sidecar itself NEVER opens an outbound connection.

import json
import os
import urllib.parse
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .jobs import JobManager, STAGES
from .props import collect_props

SESSION_HEADER = "X-Iblis-Session"
MAX_BODY_BYTES = 1 << 20  # generous for a {stage, jobId, params} envelope
LOG_TAIL_LINES = 200

# One session-wide ring buffer: server events + child stdout/stderr lines.
log_ring = deque(maxlen=2 * LOG_TAIL_LINES)


def log_line(line: str) -> None:
    log_ring.append(line.rstrip("\n"))


class TrainingHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "iblis-train"
    # set by create_server
    jobs: JobManager = None  # type: ignore[assignment]

    # -- plumbing -----------------------------------------------------------

    def log_message(self, fmt, *args):  # default writes to stderr; keep it
        log_line("http " + (fmt % args))

    def _send(self, status: int, payload, content_type="application/json") -> None:
        body = (
            payload.encode("utf-8")
            if isinstance(payload, str)
            else (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8")
        )
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        secret = os.environ.get("IBLIS_SESSION", "")
        offered = self.headers.get(SESSION_HEADER, "")
        if secret and offered == secret:
            return True
        self._send(403, {"error": "forbidden"})
        return False

    def _read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY_BYTES:
            self._send(400, {"error": "bad request body"})
            return None
        try:
            parsed = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            parsed = None
        if not isinstance(parsed, dict):
            self._send(400, {"error": "expected a JSON object body"})
            return None
        return parsed

    # -- routes ---------------------------------------------------------------

    def do_GET(self):
        if not self._authorized():
            return
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/health":
            self._send(200, {"status": "ok"})
        elif url.path == "/props":
            self._send(200, collect_props())
        elif url.path == "/job":
            query = urllib.parse.parse_qs(url.query)
            job_id = (query.get("id") or [""])[0]
            self._send(200, self.jobs.poll(job_id))
        elif url.path == "/logs":
            tail = list(log_ring)[-LOG_TAIL_LINES:]
            self._send(200, "\n".join(tail) + "\n", content_type="text/plain; charset=utf-8")
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._authorized():
            return
        url = urllib.parse.urlsplit(self.path)
        if url.path != "/job":
            self._send(404, {"error": "not found"})
            return
        query = urllib.parse.parse_qs(url.query)
        if (query.get("cancel") or [""])[0] == "1":
            job_id = (query.get("id") or [""])[0]
            cancelled = self.jobs.cancel(job_id)
            self._send(200 if cancelled else 404, {"ok": cancelled} if cancelled else {"error": "no such active job"})
            return
        body = self._read_json_body()
        if body is None:
            return
        stage = str(body.get("stage", ""))
        job_id = str(body.get("jobId", ""))
        params = body.get("params")
        if stage not in STAGES or not self._stage_enabled(stage) or not job_id:
            self._send(400, {"error": f"unknown stage or missing jobId: {stage!r}"})
            return
        if not isinstance(params, dict):
            params = {}
        if not self.jobs.start(stage, job_id, params):
            self._send(409, {"error": "busy"})
            return
        self._send(200, {"ok": True})

    @staticmethod
    def _stage_enabled(stage: str) -> bool:
        # "selftest" exists purely so the unit suite (and a dev probe) can
        # exercise the job state machine without the multi-GB toolchain.
        if stage == "selftest":
            return os.environ.get("IBLIS_TRAIN_SELFTEST") == "1"
        return True


def create_server(port: int) -> ThreadingHTTPServer:
    handler = TrainingHandler
    handler.jobs = JobManager(log_line)
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    server.daemon_threads = True
    return server
