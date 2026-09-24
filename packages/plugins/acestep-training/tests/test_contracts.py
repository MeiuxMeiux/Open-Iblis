# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# Shared safetensors verdicts (contracts/safetensors/cases.json): the
# trainer's export check must agree with the shell and server mirrors on
# every case.

import base64
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from iblis_train.stages.export import safetensors_problem  # noqa: E402

CASES = Path(__file__).resolve().parents[4] / "contracts" / "safetensors" / "cases.json"


def case_bytes(case):
    if "raw" in case:
        return bytes.fromhex(case["raw"])
    if "headerBase64" in case:
        header = base64.b64decode(case["headerBase64"])
    else:
        header = case["header"].encode()
    header = header.ljust(case.get("padTo", 0), b" ")
    return struct.pack("<Q", len(header)) + header + b"\0" * case.get("dataBytes", 0)


class SharedVerdicts(unittest.TestCase):
    def test_every_case(self):
        cases = json.loads(CASES.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "case.safetensors"
            for case in cases:
                with self.subTest(case["name"]):
                    path.write_bytes(case_bytes(case))
                    problem = safetensors_problem(path)
                    self.assertEqual(case["ok"], problem is None, problem or "accepted")
                    if "reason" in case:
                        self.assertIn(case["reason"], problem or "")


if __name__ == "__main__":
    unittest.main()
