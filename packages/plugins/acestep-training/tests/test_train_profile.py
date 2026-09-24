# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# Pure tests for the VRAM-tier training profile engine (no torch, no GPU).
# Covers tier selection by total VRAM, power-user override merge + clamping,
# the adafactor-for-8 GB rule, and the generated trainer argv.

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from iblis_train.stages import profile as P  # noqa: E402


def args_map(argv):
    """Flatten ["--a", "1", "--b"] into {"--a": "1", "--b": True}."""
    out = {}
    i = 0
    while i < len(argv):
        tok = argv[i]
        if tok.startswith("--"):
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                out[tok] = argv[i + 1]
                i += 2
            else:
                out[tok] = True
                i += 1
        else:
            i += 1
    return out


class TierSelectionTest(unittest.TestCase):
    def test_none_vram_picks_smallest_safe_tier(self):
        self.assertEqual(P.base_tier(None)["tier"], "8gb")
        self.assertEqual(P.base_tier(0)["tier"], "8gb")
        self.assertEqual(P.base_tier("garbage")["tier"], "8gb")

    def test_boundaries(self):
        self.assertEqual(P.base_tier(8192)["tier"], "8gb")
        self.assertEqual(P.base_tier(10239)["tier"], "8gb")
        self.assertEqual(P.base_tier(10240)["tier"], "12gb")
        self.assertEqual(P.base_tier(12288)["tier"], "12gb")
        self.assertEqual(P.base_tier(16383)["tier"], "12gb")
        self.assertEqual(P.base_tier(16384)["tier"], "16gb")
        self.assertEqual(P.base_tier(24575)["tier"], "16gb")
        self.assertEqual(P.base_tier(24576)["tier"], "24gb")
        self.assertEqual(P.base_tier(49152)["tier"], "24gb")

    def test_eight_gb_is_low_rank_and_uses_adafactor(self):
        # bitsandbytes is absent from the frozen runtime, so the 8 GB tier must
        # NOT rely on adamw8bit (a silent fallback to full AdamW). adafactor is
        # bundled and genuinely near-zero optimizer state.
        base = P.base_tier(8192)
        self.assertEqual(base["rank"], 16)
        self.assertEqual(base["optimizer_type"], "adafactor")
        self.assertTrue(base["gradient_checkpointing"])
        self.assertTrue(base["offload_encoder"])

    def test_big_card_scales_up_and_stops_offloading(self):
        base = P.base_tier(24576)
        self.assertEqual(base["rank"], 128)
        self.assertEqual(base["batch_size"], 2)
        self.assertFalse(base["offload_encoder"])
        self.assertEqual(base["optimizer_type"], "adamw")


class ResolveProfileTest(unittest.TestCase):
    def test_epochs_default_and_save_every(self):
        prof = P.resolve_profile({"vramTotalMb": 8192})
        self.assertEqual(prof["epochs"], P.DEFAULT_EPOCHS)
        self.assertEqual(prof["save_every"], max(50, P.DEFAULT_EPOCHS // 4))

    def test_explicit_epochs_wins_over_default(self):
        prof = P.resolve_profile({"vramTotalMb": 8192, "epochs": 200})
        self.assertEqual(prof["epochs"], 200)
        self.assertEqual(prof["save_every"], 50)

    def test_low_vram_false_lifts_memory_guards(self):
        prof = P.resolve_profile({"vramTotalMb": 8192, "lowVram": False})
        self.assertFalse(prof["gradient_checkpointing"])
        self.assertFalse(prof["offload_encoder"])
        # but rank/optimizer still come from the tier
        self.assertEqual(prof["rank"], 16)

    def test_overrides_take_precedence_camel_and_snake(self):
        prof = P.resolve_profile({
            "vramTotalMb": 8192,
            "settings": {
                "rank": 64, "batchSize": 2, "optimizer": "adamw",
                "gradientCheckpointing": False, "precision": "bf16",
            },
        })
        self.assertEqual(prof["rank"], 64)
        self.assertEqual(prof["batch_size"], 2)
        self.assertEqual(prof["optimizer_type"], "adamw")
        self.assertFalse(prof["gradient_checkpointing"])
        self.assertEqual(prof["precision"], "bf16")

    def test_overrides_are_clamped(self):
        prof = P.resolve_profile({
            "vramTotalMb": 24576,
            "settings": {"rank": 9999, "batchSize": 0, "learningRate": 5.0},
        })
        self.assertEqual(prof["rank"], 256)          # clamped to max
        self.assertEqual(prof["batch_size"], 1)      # clamped to min
        self.assertEqual(prof["learning_rate"], 1e-2)  # clamped to max

    def test_invalid_enum_and_garbage_are_ignored(self):
        prof = P.resolve_profile({
            "vramTotalMb": 16384,
            "settings": {"optimizer": "nonsense", "precision": "fp8", "rank": "abc"},
        })
        self.assertEqual(prof["optimizer_type"], "adamw")  # tier value stands
        self.assertEqual(prof["precision"], "auto")
        self.assertEqual(prof["rank"], 64)

    def test_non_dict_settings_ignored(self):
        prof = P.resolve_profile({"vramTotalMb": 8192, "settings": "oops"})
        self.assertEqual(prof["rank"], 16)


class BuildArgsTest(unittest.TestCase):
    def test_boolean_flags_render_positive_and_negative(self):
        on = args_map(P.build_train_args(P.resolve_profile({"vramTotalMb": 8192})))
        self.assertIn("--gradient-checkpointing", on)
        self.assertIn("--offload-encoder", on)
        off = args_map(P.build_train_args(P.resolve_profile({"vramTotalMb": 24576})))
        self.assertIn("--no-offload-encoder", off)
        self.assertIn("--gradient-checkpointing", off)

    def test_argv_carries_tier_hyperparams(self):
        prof = P.resolve_profile({"vramTotalMb": 8192, "epochs": 300})
        m = args_map(P.build_train_args(prof))
        self.assertEqual(m["--rank"], "16")
        self.assertEqual(m["--alpha"], "32")
        self.assertEqual(m["--epochs"], "300")
        self.assertEqual(m["--gradient-accumulation"], "8")
        self.assertEqual(m["--optimizer-type"], "adafactor")
        self.assertEqual(m["--batch-size"], "1")
        # learning rate is a plain float literal argparse can parse
        self.assertEqual(float(m["--learning-rate"]), 1e-4)


if __name__ == "__main__":
    unittest.main()
