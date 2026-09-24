# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# export: validate the trained adapters (strict safetensors header check —
# the Python mirror of apps/site/src/Trainings/Safetensors.php) and write
# output/metadata.json for the shell's upload stage.

import json
import struct
from collections import Counter

from .common import StageError, scratch_dir

MAX_HEADER_BYTES = 1 << 20
# Element width per dtype; the same table as the shell and server mirrors.
DTYPE_BYTES = {
    "F64": 8, "F32": 4, "F16": 2, "BF16": 2, "I64": 8, "I32": 4, "I16": 2,
    "I8": 1, "U8": 1, "BOOL": 1, "F8_E4M3": 1, "F8_E5M2": 1,
}
MAX_RANK = 8
TAG_LIMIT = 16


def safetensors_problem(path) -> str:
    """Return None when valid, else a human reason (mirrors Safetensors.php)."""
    try:
        size = path.stat().st_size
    except OSError:
        return "file is missing or too small to be safetensors"
    if size < 9:
        return "file is missing or too small to be safetensors"
    with open(path, "rb") as fh:
        lead = fh.read(8)
        if len(lead) != 8:
            return "file has no safetensors header"
        header_len = struct.unpack("<Q", lead)[0]
        if header_len < 2 or header_len > MAX_HEADER_BYTES:
            # .pt/.ckpt come as raw pickle (0x80) or zip ("PK"). Only named
            # once the length is impossible: a real 128-byte header starts
            # with 0x80 too.
            if lead[0] == 0x80 or lead[:2] == b"PK":
                return "file is a pickle/zip container, not safetensors"
            return "safetensors header length is out of bounds"
        if 8 + header_len > size:
            return "safetensors header exceeds the file"
        header_json = fh.read(header_len)
        if len(header_json) != header_len:
            return "safetensors header is truncated"
    return _header_problem(header_json, size - 8 - header_len)


def _header_problem(header_json: bytes, data_bytes: int):
    try:
        header = json.loads(header_json)
    except ValueError:
        return "safetensors header is not a JSON object"
    if not isinstance(header, dict) or not header:
        return "safetensors header is not a JSON object"
    ranges = []
    for key, entry in header.items():
        if key == "__metadata__":
            if not isinstance(entry, dict) or not all(
                isinstance(v, str) for v in entry.values()
            ):
                return "safetensors __metadata__ is malformed"
            continue
        if not isinstance(entry, dict):
            return "safetensors header contains a non-tensor entry"
        if sorted(entry.keys()) != ["data_offsets", "dtype", "shape"]:
            return f"tensor '{key}' does not have exactly dtype/shape/data_offsets"
        if entry["dtype"] not in DTYPE_BYTES:
            return f"tensor '{key}' has an unsupported dtype"
        shape = entry["shape"]
        if not isinstance(shape, list) or len(shape) > MAX_RANK or not all(
            isinstance(d, int) and not isinstance(d, bool) and d >= 0 for d in shape
        ):
            return f"tensor '{key}' has a malformed shape"
        offsets = entry["data_offsets"]
        if (
            not isinstance(offsets, list)
            or len(offsets) != 2
            or not all(isinstance(o, int) and not isinstance(o, bool) for o in offsets)
        ):
            return f"tensor '{key}' has malformed data_offsets"
        begin, end = offsets
        if begin < 0 or end < begin or end > data_bytes:
            return f"tensor '{key}' has data_offsets outside the file"
        # The range must hold exactly dtype * prod(shape) (audit 2026-09-24,
        # M-TRN2); Python ints do not overflow, so no separate cap is needed.
        want = DTYPE_BYTES[entry["dtype"]]
        for dim in shape:
            want *= dim
        if end - begin != want:
            return f"tensor '{key}' byte range does not match its dtype and shape"
        ranges.append((begin, end))
    if not ranges:
        return "safetensors header describes no tensors"
    return _layout_problem(ranges, data_bytes)


def _layout_problem(ranges, data_bytes):
    # Tensors must tile the data buffer exactly, as the reference loader
    # demands: in offset order each range starts where the previous one
    # ended, from byte 0 to the last data byte. No overlap, no hole, no
    # unclaimed tail (audit 2026-09-24, M-TRN2 follow-up).
    cursor = 0
    for begin, end in sorted(ranges):
        if begin < cursor:
            return "safetensors tensors overlap"
        if begin > cursor:
            return "safetensors tensors leave a hole in the data"
        cursor = end
    if cursor != data_bytes:
        return "safetensors data has bytes no tensor claims"
    return None


def _aggregate_tags(scratch):
    counts = Counter()
    tags_dir = scratch / "tags"
    if tags_dir.is_dir():
        for path in sorted(tags_dir.glob("*.json")):
            try:
                info = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            for tag in info.get("tags", []):
                if isinstance(tag, str) and tag:
                    counts[tag] += 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [tag for tag, _n in ranked[:TAG_LIMIT]]


def run(params: dict, progress) -> dict:
    name = str(params.get("name") or "")
    consent = str(params.get("consentSha256") or "")
    categories = [c for c in (params.get("categories") or []) if c in ("texture", "groove")]
    if not name or not consent or not categories:
        raise StageError("export needs name, categories, and consentSha256")
    scratch = scratch_dir(params)
    output = scratch / "output"

    files = []
    for index, category in enumerate(categories):
        adapter = output / f"adapter_{category}.safetensors"
        progress((index * 80) // len(categories), f"Validating {adapter.name}")
        problem = safetensors_problem(adapter)
        if problem:
            raise StageError(f"{adapter.name}: {problem}")
        files.append({"name": adapter.name})

    progress(90, "Writing metadata.json")
    metadata = {
        "name": name,
        "schemaVersion": 1,
        "consentSha256": consent,
        "categories": categories,
        "tags": _aggregate_tags(scratch),
    }
    staged = output / "metadata.json.part"
    staged.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    staged.replace(output / "metadata.json")
    files.append({"name": "metadata.json"})

    return {"files": files}
