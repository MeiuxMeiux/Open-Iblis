# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# VRAM-tier training profiles: turn measured GPU memory (and optional
# power-user overrides) into the exact set of trainer hyperparameters and CLI
# flags. Pure stdlib, no torch import -- unit-testable on any box.
#
# Design (docs/training/01-training-pack.md "VRAM tiers"):
#   - The vendored Side-Step trainer ships tuned presets per VRAM class
#     (rank/alpha, gradient accumulation, checkpointing, encoder offload).
#     We mirror them by *total* VRAM so an 8 GB card trains at rank 16 instead
#     of the 16 GB-class rank 64 the shell used to hardcode.
#   - The 8 GB tier's optimizer is adafactor, NOT the preset's adamw8bit:
#     bitsandbytes is not in the frozen runtime (adamw8bit silently falls back
#     to full AdamW), whereas adafactor IS present (transformers) and is the
#     upstream-recommended near-zero-state optimizer for low VRAM.
#   - Power users override any field via params["settings"]; every override is
#     range-clamped so a bad value degrades to a bound instead of crashing the
#     trainer 20 minutes in.

from __future__ import annotations

# Optimizers the frozen runtime can actually honor differently. adamw8bit and
# prodigy are accepted by the trainer but fall back to adamw (their wheels are
# not bundled); we keep them selectable for forward-compat but never pick them
# automatically.
OPTIMIZERS = ("adamw", "adafactor", "adamw8bit", "prodigy")
SCHEDULERS = ("cosine", "cosine_restarts", "linear", "constant", "constant_with_warmup")
PRECISIONS = ("auto", "bf16", "fp16", "fp32")

# Per-field clamp bounds for power-user overrides (min, max).
_BOUNDS = {
    "rank": (1, 256),
    "alpha": (1, 512),
    "batch_size": (1, 8),
    "gradient_accumulation": (1, 64),
    "epochs": (1, 5000),
    "warmup_steps": (0, 5000),
    "learning_rate": (1e-6, 1e-2),
    "dropout": (0.0, 0.9),
    "save_every": (1, 5000),
}


# Tiers keyed by an inclusive upper bound on total VRAM (MB). None/unknown VRAM
# takes the smallest tier -- the safe, always-fits configuration.
_TIERS = (
    (10240, {
        "tier": "8gb", "rank": 16, "alpha": 32, "batch_size": 1,
        "gradient_accumulation": 8, "optimizer_type": "adafactor",
        "gradient_checkpointing": True, "offload_encoder": True,
    }),
    (16384, {
        "tier": "12gb", "rank": 32, "alpha": 64, "batch_size": 1,
        "gradient_accumulation": 4, "optimizer_type": "adamw",
        "gradient_checkpointing": True, "offload_encoder": True,
    }),
    (24576, {
        "tier": "16gb", "rank": 64, "alpha": 128, "batch_size": 1,
        "gradient_accumulation": 4, "optimizer_type": "adamw",
        "gradient_checkpointing": True, "offload_encoder": False,
    }),
)
_TIER_TOP = {
    "tier": "24gb", "rank": 128, "alpha": 256, "batch_size": 2,
    "gradient_accumulation": 2, "optimizer_type": "adamw",
    "gradient_checkpointing": True, "offload_encoder": False,
}

# Fields common to every tier (not VRAM-dependent). epochs is the training
# length, decoupled from VRAM: the shell passes it (dataset-size derived).
_COMMON = {
    "dropout": 0.1,
    "learning_rate": 1e-4,
    "warmup_steps": 100,
    "scheduler_type": "cosine",
    "precision": "auto",
}

DEFAULT_EPOCHS = 500  # tutorial: 10-20 tracks -> 500-800; calibrated at E2E


def base_tier(vram_total_mb) -> dict:
    """Pick the tuned tier for a card's total VRAM. None -> smallest (safe)."""
    if not isinstance(vram_total_mb, (int, float)) or vram_total_mb <= 0:
        return dict(_TIERS[0][1])
    for ceiling, preset in _TIERS:
        if vram_total_mb < ceiling:
            return dict(preset)
    return dict(_TIER_TOP)


def _clamp_number(key, value, cast):
    lo, hi = _BOUNDS[key]
    try:
        num = cast(value)
    except (TypeError, ValueError):
        return None
    return max(lo, min(hi, num))


def _apply_overrides(profile: dict, settings) -> None:
    """Merge a power-user settings dict over the tier base, in place.

    Unknown keys are ignored; out-of-range numbers clamp to the nearest bound;
    invalid enums/booleans are dropped (the tier value stands). The renderer
    validates too -- this is the defensive server-side floor.
    """
    if not isinstance(settings, dict):
        return
    int_keys = ("rank", "alpha", "batch_size", "gradient_accumulation",
                "epochs", "warmup_steps", "save_every")
    # Accept both snake_case and the renderer's camelCase spellings.
    aliases = {
        "batchSize": "batch_size",
        "gradientAccumulation": "gradient_accumulation",
        "warmupSteps": "warmup_steps",
        "learningRate": "learning_rate",
        "saveEvery": "save_every",
        "optimizer": "optimizer_type",
        "scheduler": "scheduler_type",
        "gradientCheckpointing": "gradient_checkpointing",
        "offloadEncoder": "offload_encoder",
    }
    for raw_key, value in settings.items():
        key = aliases.get(raw_key, raw_key)
        if value is None:
            continue
        if key in int_keys:
            clamped = _clamp_number(key, value, int)
            if clamped is not None:
                profile[key] = clamped
        elif key in ("learning_rate", "dropout"):
            clamped = _clamp_number(key, value, float)
            if clamped is not None:
                profile[key] = clamped
        elif key == "optimizer_type" and value in OPTIMIZERS:
            profile[key] = value
        elif key == "scheduler_type" and value in SCHEDULERS:
            profile[key] = value
        elif key == "precision" and value in PRECISIONS:
            profile[key] = value
        elif key in ("gradient_checkpointing", "offload_encoder"):
            profile[key] = bool(value)


def resolve_profile(params: dict) -> dict:
    """Full hyperparameter set for a train run.

    Precedence: VRAM tier base < common defaults < explicit params (epochs,
    lowVram) < power-user params["settings"] overrides.
    """
    profile = dict(_COMMON)
    profile.update(base_tier(params.get("vramTotalMb")))

    # epochs: explicit param wins, else tier-independent default. A power-user
    # override (settings.epochs) can still replace it below.
    epochs = _clamp_number("epochs", params.get("epochs") or DEFAULT_EPOCHS, int)
    profile["epochs"] = epochs if epochs is not None else DEFAULT_EPOCHS

    # Legacy lowVram flag: when explicitly False, lift the memory guards the
    # tier would otherwise impose (a knowledgeable caller on a big card).
    low_vram = params.get("lowVram")
    if low_vram is False:
        profile["gradient_checkpointing"] = False
        profile["offload_encoder"] = False

    _apply_overrides(profile, params.get("settings"))

    # Derive save_every from the FINAL epoch count (after any override) so a
    # short run still checkpoints a few times and never past its own end. A
    # settings.save_every override, if given, wins.
    if "save_every" not in profile:
        profile["save_every"] = min(profile["epochs"], max(50, profile["epochs"] // 4))
    return profile


def _flag(name, enabled) -> str:
    return f"--{name}" if enabled else f"--no-{name}"


def build_train_args(profile: dict) -> list:
    """Trainer CLI flags for the LoRA training phase (not preprocess)."""
    return [
        "--epochs", str(profile["epochs"]),
        "--batch-size", str(profile["batch_size"]),
        "--gradient-accumulation", str(profile["gradient_accumulation"]),
        "--learning-rate", repr(float(profile["learning_rate"])),
        "--warmup-steps", str(profile["warmup_steps"]),
        "--rank", str(profile["rank"]),
        "--alpha", str(profile["alpha"]),
        "--dropout", repr(float(profile["dropout"])),
        "--optimizer-type", profile["optimizer_type"],
        "--scheduler-type", profile["scheduler_type"],
        "--save-every", str(profile["save_every"]),
        _flag("gradient-checkpointing", profile["gradient_checkpointing"]),
        _flag("offload-encoder", profile["offload_encoder"]),
    ]
