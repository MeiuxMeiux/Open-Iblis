# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# iblis_train — the training pack's loopback sidecar (docs/training/01).
#
# The HTTP layer (this package minus stages/) imports NOTHING beyond the
# Python standard library so the server always boots, even if a wheel in the
# heavy toolchain is broken. Heavy imports (torch, demucs, librosa, the
# vendored ACE-Step trainer) live inside stage functions that only ever run
# in a child process spawned per stage.
#
# Code stays 3.10-compatible: the pack ships CPython 3.11 but the repo's
# Linux test box runs the suite on 3.10.

__version__ = "0.1.1"
