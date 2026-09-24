# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# train (train-texture / train-groove): drive the vendored ACE-Step 1.5
# trainer (vendor/ace_step/train.py, Side-Step "fixed" CLI) in two phases:
# preprocess-to-tensors, then LoRA training. Hyperparameters come from
# profile.resolve_profile(): a VRAM-tier base (rank/alpha/accumulation/
# optimizer/checkpointing/offload chosen from the card's memory) merged with
# any power-user overrides. See docs/training/01-training-pack.md "VRAM tiers".
#
# Fragmentation guard: every torch subprocess runs with
# PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True, which lets the CUDA caching
# allocator grow segments in place instead of OOM-ing on fragmented-but-free
# VRAM — the single highest-value, zero-risk win for tight 8 GB cards.
#
# Engine exclusion: the shell's resource-state module stops the engine
# sidecar BEFORE any train stage is admitted and owns that ordering; this
# process deliberately does not probe localhost ports for a live engine
# (engines sit on ephemeral ports — a probe would be guesswork, and any
# outbound-looking connection from this sidecar is contractually banned).
#
# Progress parsing is heuristic over the trainer's --plain stdout (epoch/step
# counters); D8: verified and calibrated during Jack's consolidated E2E.

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from . import profile as train_profile
from .common import StageError, pack_root, scratch_dir

# Grow CUDA allocator segments in place rather than OOM on fragmented free VRAM.
TORCH_ALLOC_CONF = "expandable_segments:True"
EPOCH_RE = re.compile(r"[Ee]poch[ :=]+(\d+)\s*/\s*(\d+)")
STEP_RE = re.compile(r"[Ss]tep[ :=]+(\d+)\s*/\s*(\d+)")
COUNT_RE = re.compile(r"(\d+)\s*/\s*(\d+)")


def _torch_env():
    env = os.environ.copy()
    # Only extend a value the caller did not already pin, so a user override
    # (or a future pack default) still wins.
    if not env.get("PYTORCH_CUDA_ALLOC_CONF"):
        env["PYTORCH_CUDA_ALLOC_CONF"] = TORCH_ALLOC_CONF
    return env


def _stream(argv, cwd, on_line):
    proc = subprocess.Popen(
        argv, cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", env=_torch_env(),
    )
    tail = []
    for line in proc.stdout:
        line = line.rstrip("\n")
        tail.append(line)
        del tail[:-30]
        on_line(line)
    proc.stdout.close()
    if proc.wait() != 0:
        raise StageError("the trainer failed:\n" + "\n".join(tail[-8:]))


def _trainer_paths(category, scratch):
    root = pack_root()
    vendor = root / "vendor" / "ace_step" / "train.py"
    checkpoints = root / "models" / "acestep"
    if not vendor.is_file() or not checkpoints.is_dir():
        raise StageError("the pack's trainer or base checkpoints are missing; reinstall the pack")
    dataset_dir = scratch / f"dataset_{category}"
    dataset_json = scratch / f"dataset_{category}.json"
    if not dataset_dir.is_dir() or not dataset_json.is_file():
        raise StageError(f"the {category} dataset is missing; run the dataset stage first")
    return vendor, checkpoints, dataset_dir, dataset_json


def _common_args(checkpoints, tensors, train_out, precision):
    return [
        "fixed", "--plain", "--yes",
        "--checkpoint-dir", str(checkpoints), "--model-variant", "turbo",
        "--dataset-dir", str(tensors), "--output-dir", str(train_out),
        "--num-workers", "0", "--precision", precision,
    ]


def _newest_safetensors(train_out: Path):
    candidates = sorted(
        train_out.rglob("*.safetensors"), key=lambda p: p.stat().st_mtime
    )
    if not candidates:
        raise StageError("training finished but produced no .safetensors adapter")
    return candidates[-1]


def run(params: dict, progress) -> dict:
    category = params.get("category")
    if category not in ("texture", "groove"):
        raise StageError(f"unknown training category: {category!r}")
    scratch = scratch_dir(params)
    profile = train_profile.resolve_profile(params)
    epochs = profile["epochs"]
    precision = profile["precision"]

    vendor, checkpoints, dataset_dir, dataset_json = _trainer_paths(category, scratch)
    tensors = scratch / "tensors" / category
    train_out = scratch / f"train_{category}"
    output = scratch / "output"
    output.mkdir(parents=True, exist_ok=True)

    # Phase A (0-30%): preprocess audio + prompts into training tensors.
    progress(0, f"Preparing {category} tensors")

    def on_preprocess_line(line):
        match = COUNT_RE.search(line)
        if match and int(match.group(2)) > 0:
            done, total = int(match.group(1)), int(match.group(2))
            progress(min(29, (done * 30) // total), f"Preparing tensors {done}/{total}")

    _stream(
        [sys.executable, "-I", str(vendor)]
        + _common_args(checkpoints, tensors, train_out, precision)
        + ["--preprocess", "--audio-dir", str(dataset_dir),
           "--dataset-json", str(dataset_json), "--tensor-output", str(tensors)],
        vendor.parent, on_preprocess_line,
    )

    # Phase B (30-97%): the LoRA training loop.
    progress(30, f"Training {category} LoRA, epoch 0/{epochs}")
    state = {"epoch": 0, "step": ""}

    def on_train_line(line):
        epoch_match = EPOCH_RE.search(line)
        if epoch_match:
            state["epoch"] = min(int(epoch_match.group(1)), epochs)
        step_match = STEP_RE.search(line)
        if step_match:
            state["step"] = f" step {step_match.group(1)}/{step_match.group(2)}"
        if epoch_match or step_match:
            percent = 30 + (state["epoch"] * 67) // max(1, epochs)
            progress(min(97, percent), f"epoch {state['epoch']}/{epochs}{state['step']}")

    train_args = (
        _common_args(checkpoints, tensors, train_out, precision)
        + train_profile.build_train_args(profile)
    )
    _stream([sys.executable, "-I", str(vendor)] + train_args, vendor.parent, on_train_line)

    progress(98, "Collecting the trained adapter")
    adapter = _newest_safetensors(train_out)
    final = output / f"adapter_{category}.safetensors"
    staged = final.with_suffix(".part")
    shutil.copyfile(adapter, staged)
    staged.replace(final)

    # Tensors are the multi-GB intermediate; drop them after success.
    shutil.rmtree(tensors, ignore_errors=True)
    shutil.rmtree(train_out, ignore_errors=True)

    return {
        "category": category, "file": final.name, "epochs": epochs,
        "tier": profile["tier"], "rank": profile["rank"],
        "optimizer": profile["optimizer_type"], "precision": precision,
    }
