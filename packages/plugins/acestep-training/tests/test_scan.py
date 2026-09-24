# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# Direct tests for the scan stage's probe/limit logic on generated tiny
# WAVs. soundfile is absent on this box, so this also proves the stdlib
# `wave` fallback path. Also covers the export stage's safetensors
# validator (the Python mirror of Safetensors.php).

import json
import math
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from iblis_train.stages import scan  # noqa: E402
from iblis_train.stages.common import StageError  # noqa: E402
from iblis_train.stages.export import safetensors_problem  # noqa: E402


def write_wav(path: Path, seconds=0.2, rate=8000):
    frames = int(seconds * rate)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        payload = b"".join(
            struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / rate)))
            for i in range(frames)
        )
        out.writeframes(payload)


def collect_progress():
    seen = []
    return seen, lambda percent, detail: seen.append((percent, detail))


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="iblis-scan-test-")
        self.source = Path(self.tmp.name) / "songs"
        self.scratch = Path(self.tmp.name) / "scratch"
        self.source.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def test_scan_probes_wavs_and_reports_skips(self):
        for name in ("a.wav", "b.wav", "c.wav"):
            write_wav(self.source / name)
        (self.source / "broken.wav").write_bytes(b"RIFFgarbage")
        (self.source / "notes.txt").write_text("ignored", encoding="utf-8")
        seen, progress = collect_progress()
        result = scan.run(
            {"source": str(self.source), "scratch": str(self.scratch), "ingest": False},
            progress,
        )
        self.assertEqual(result["trackCount"], 3)
        self.assertAlmostEqual(result["totalDurationSec"], 0.6, places=1)
        self.assertEqual(
            result["skipped"], [{"name": "broken.wav", "reason": "unreadable audio file"}]
        )
        self.assertTrue(seen and seen[-1][0] <= 100)

    def test_scan_recurses_subfolders(self):
        nested = self.source / "album1"
        nested.mkdir()
        write_wav(nested / "deep.wav")
        write_wav(self.source / "top.wav")
        _seen, progress = collect_progress()
        result = scan.run(
            {"source": str(self.source), "scratch": str(self.scratch), "ingest": False},
            progress,
        )
        self.assertEqual(result["trackCount"], 2)

    def test_over_max_tracks_is_an_honest_hard_error(self):
        for index in range(3):
            write_wav(self.source / f"t{index}.wav")
        _seen, progress = collect_progress()
        with self.assertRaises(StageError) as caught:
            scan.run(
                {"source": str(self.source), "scratch": str(self.scratch),
                 "ingest": False, "maxTracks": 2},
                progress,
            )
        self.assertIn("hard limit of 2 tracks", str(caught.exception))

    def test_empty_folder_is_an_error(self):
        _seen, progress = collect_progress()
        with self.assertRaises(StageError):
            scan.run(
                {"source": str(self.source), "scratch": str(self.scratch), "ingest": False},
                progress,
            )


class SafetensorsValidatorTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="iblis-st-test-")
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def make(self, header_obj, data=b"\x00" * 16, raw_header=None):
        header = raw_header if raw_header is not None else json.dumps(header_obj).encode()
        path = self.dir / "adapter.safetensors"
        path.write_bytes(struct.pack("<Q", len(header)) + header + data)
        return path

    def test_valid_file_passes(self):
        path = self.make(
            {"__metadata__": {"format": "pt"},
             "w": {"dtype": "F32", "shape": [2, 2], "data_offsets": [0, 16]}}
        )
        self.assertIsNone(safetensors_problem(path))

    def test_pickle_and_zip_signatures_rejected(self):
        pickled = self.dir / "model.safetensors"
        pickled.write_bytes(b"\x80\x04" + b"x" * 32)
        self.assertIn("pickle/zip", safetensors_problem(pickled))
        zipped = self.dir / "model2.safetensors"
        zipped.write_bytes(b"PK\x03\x04" + b"x" * 32)
        self.assertIn("pickle/zip", safetensors_problem(zipped))

    def test_offsets_outside_file_rejected(self):
        path = self.make({"w": {"dtype": "F32", "shape": [8], "data_offsets": [0, 999]}})
        self.assertIn("outside the file", safetensors_problem(path))

    def test_non_tensor_entry_rejected(self):
        path = self.make({"w": {"dtype": "F32", "shape": [4], "data_offsets": [0, 16], "x": 1}})
        self.assertIn("exactly dtype/shape/data_offsets", safetensors_problem(path))

    def test_no_tensors_rejected(self):
        path = self.make({"__metadata__": {"format": "pt"}})
        self.assertIn("describes no tensors", safetensors_problem(path))

    def test_range_must_match_dtype_and_shape(self):
        path = self.make({"w": {"dtype": "F32", "shape": [8], "data_offsets": [0, 16]}})
        self.assertIn("does not match", safetensors_problem(path))
        deep = self.make({"w": {"dtype": "U8", "shape": [1] * 9, "data_offsets": [0, 1]}},
                         data=b"\x00")
        self.assertIn("malformed shape", safetensors_problem(deep))

    def test_tensors_must_tile_the_data(self):
        hole = self.make({"a": {"dtype": "U8", "shape": [2], "data_offsets": [0, 2]},
                          "b": {"dtype": "U8", "shape": [4], "data_offsets": [12, 16]}})
        self.assertIn("hole", safetensors_problem(hole))
        overlap = self.make({"a": {"dtype": "U8", "shape": [12], "data_offsets": [0, 12]},
                             "b": {"dtype": "U8", "shape": [8], "data_offsets": [8, 16]}})
        self.assertIn("overlap", safetensors_problem(overlap))
        tail = self.make({"a": {"dtype": "U8", "shape": [4], "data_offsets": [0, 4]}})
        self.assertIn("no tensor claims", safetensors_problem(tail))
        tiled = self.make({"a": {"dtype": "U8", "shape": [4], "data_offsets": [0, 4]},
                           "b": {"dtype": "F32", "shape": [3], "data_offsets": [4, 16]}})
        self.assertIsNone(safetensors_problem(tiled))

    def test_truncated_header_rejected(self):
        path = self.dir / "trunc.safetensors"
        path.write_bytes(struct.pack("<Q", 4096) + b"{}")
        self.assertIn("exceeds the file", safetensors_problem(path))


if __name__ == "__main__":
    unittest.main()
