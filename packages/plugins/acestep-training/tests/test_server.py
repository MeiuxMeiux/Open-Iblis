# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# Exercises the real HTTP surface end to end: auth, health, props, the job
# state machine (via the hidden selftest stage), busy refusal, cancel with
# partial-output cleanup, and the log tail. stdlib only; runs on the repo's
# Linux box with python3.10.

import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

SECRET = "test-secret"
os.environ["IBLIS_SESSION"] = SECRET
os.environ["IBLIS_TRAIN_SELFTEST"] = "1"

from iblis_train.server import create_server  # noqa: E402


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server(0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.scratch = tempfile.mkdtemp(prefix="iblis-train-test-")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, method, path, body=None, secret=SECRET):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {}
        if secret is not None:
            headers["X-Iblis-Session"] = secret
        payload = None
        if body is not None:
            payload = json.dumps(body)
            headers["Content-Type"] = "application/json"
        conn.request(method, path, body=payload, headers=headers)
        response = conn.getresponse()
        raw = response.read()
        conn.close()
        return response.status, raw

    def request_json(self, method, path, body=None, secret=SECRET):
        status, raw = self.request(method, path, body, secret)
        return status, json.loads(raw)

    def start_job(self, job_id, params):
        return self.request_json(
            "POST", "/job", {"stage": "selftest", "jobId": job_id, "params": params}
        )

    def wait_for(self, job_id, states, timeout=15.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            _status, poll = self.request_json("GET", f"/job?id={job_id}")
            if poll["state"] in states:
                return poll
            time.sleep(0.05)
        self.fail(f"job {job_id} never reached {states}")

    # -- auth ---------------------------------------------------------------

    def test_missing_or_wrong_session_header_gets_403(self):
        for secret in (None, "wrong"):
            status, body = self.request_json("GET", "/health", secret=secret)
            self.assertEqual(status, 403)
            self.assertEqual(body["error"], "forbidden")
        status, _body = self.request_json("POST", "/job", body={}, secret=None)
        self.assertEqual(status, 403)

    # -- simple endpoints -----------------------------------------------------

    def test_health(self):
        status, body = self.request_json("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"status": "ok"})

    def test_props_shape(self):
        status, body = self.request_json("GET", "/props")
        self.assertEqual(status, 200)
        self.assertIs(body["ok"], True)
        self.assertIsInstance(body["versions"], dict)
        # This box has no torch: the lazy probe must fail into nulls, never
        # an exception or a hang.
        self.assertIn(body["cuda"], (None, True, False))
        self.assertTrue(body["vramMb"] is None or isinstance(body["vramMb"], int))

    def test_unknown_stage_is_400_and_unknown_job_is_idle(self):
        status, body = self.request_json(
            "POST", "/job", {"stage": "bogus", "jobId": "j0", "params": {}}
        )
        self.assertEqual(status, 400)
        self.assertIn("unknown stage", body["error"])
        _status, poll = self.request_json("GET", "/job?id=never-started")
        self.assertEqual(poll["state"], "idle")

    # -- job lifecycle ---------------------------------------------------------

    def test_job_runs_to_done_with_progress(self):
        job_id = "tj-done:selftest"
        status, body = self.start_job(job_id, {"steps": 6, "delayMs": 40})
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})
        running = self.wait_for(job_id, {"running", "done"})
        self.assertIn(running["state"], ("running", "done"))
        poll = self.wait_for(job_id, {"done"})
        self.assertEqual(poll["percent"], 100)
        self.assertEqual(poll["result"], {"ok": True, "steps": 6})
        self.assertEqual(poll["stage"], "selftest")

    def test_second_job_while_busy_is_409(self):
        job_id = "tj-busy:selftest"
        self.start_job(job_id, {"steps": 40, "delayMs": 100})
        self.wait_for(job_id, {"running"})
        status, body = self.start_job("tj-other:selftest", {"steps": 2})
        self.assertEqual(status, 409)
        self.assertEqual(body["error"], "busy")
        # cancel to unblock the suite
        self.request_json("POST", f"/job?id={job_id}&cancel=1")
        self.wait_for(job_id, {"cancelled"})

    def test_cancel_by_record_prefix_cleans_partial_outputs(self):
        scratch = Path(self.scratch) / "cancel-case"
        job_id = "tj-cancel:selftest"
        self.start_job(job_id, {"steps": 200, "delayMs": 100, "scratch": str(scratch)})
        self.wait_for(job_id, {"running"})
        deadline = time.time() + 5
        while not (scratch / "selftest" / "marker.txt").exists():
            self.assertLess(time.time(), deadline, "selftest marker never appeared")
            time.sleep(0.05)
        # cancel with only the part before ':' (the pipeline's record id)
        status, body = self.request_json("POST", "/job?id=tj-cancel&cancel=1")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})
        poll = self.wait_for(job_id, {"cancelled"})
        self.assertEqual(poll["state"], "cancelled")
        self.assertFalse((scratch / "selftest").exists(), "partial outputs survived cancel")

    def test_cancel_unknown_job_is_404(self):
        status, body = self.request_json("POST", "/job?id=nope&cancel=1")
        self.assertEqual(status, 404)
        self.assertIn("error", body)

    def test_logs_tail(self):
        job_id = "tj-logs:selftest"
        self.start_job(job_id, {"steps": 2, "delayMs": 10})
        self.wait_for(job_id, {"done"})
        status, raw = self.request("GET", "/logs")
        self.assertEqual(status, 200)
        text = raw.decode("utf-8")
        self.assertIn("PROGRESS", text)
        self.assertLessEqual(len(text.splitlines()), 200)


if __name__ == "__main__":
    unittest.main()
