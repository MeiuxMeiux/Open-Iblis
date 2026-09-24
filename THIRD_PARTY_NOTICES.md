# Third-Party Notices

Authoritative list of third-party components bundled with or distributed by
Iblis, their pinned versions, and their license obligations. Iblis's own code
is licensed per path: the shell GPL-3.0-or-later (`apps/shell/LICENSE`), the
plugin SDK Apache-2.0 (`packages/plugin-sdk/LICENSE`), and each plugin pack
under the `license` named in its manifest; every source file also states its
license in an SPDX header. The components below retain their own licenses.

**Rule:** never bundle "latest from GitHub." Every entry pins an exact commit
or release. The license compliance note attaches to that exact hash. Track
each distinct component separately — the engine binary, the model weights, the
GGML/llama.cpp dependency, the GPU runtime deps, and UI assets all have
independent licenses.

---

## Compliance status (updated 2026-07-13)

ACE-Step engine pack `0.1.4` is already distributed through the signed
catalog, but this notice inventory was not completed when Phase 3 shipped.
The current manifest also does not install upstream or runtime notice files.
Immutable model/dependency pins are now recorded, the source/model text
payloads are tracked under `packages/plugins/acestep-engine/notices/`, and
future Windows staging refuses mixed or System32 DLL sources. They are not yet
manifest assets; `just engine-notices-stage` can fetch the checksum-pinned
NVIDIA EULA into ignored local staging without rebuilding native code. Before
another engine pack, declare the complete assets, bind them to matching
provenance, and test that they install. The facts below inventory what is live;
they do not declare the outstanding license work complete.

## Shell runtime dependencies (bundled in every installer)

Pinned by `pnpm-lock.yaml`; versions below are the 2026-09-24 lock.

| Component | Version | License | Notes |
| --- | --- | --- | --- |
| Electron (Chromium, Node.js) | 44.4.5 | MIT (Chromium/Node notices ship as `LICENSES.chromium.html` in the install dir) | Runtime |
| electron-updater | 6.8.9 | MIT | Auto-update client |
| extract-zip | 2.0.1 | BSD-2-Clause | Plugin archive extraction |
| music-tempo | 1.0.3 | MIT | Built-in BPM detector |
| essentia.js | 0.1.3 | **AGPL-3.0** | Built-in BPM/key detector (Essentia WASM) |
| aubiojs | 0.2.1 | wrapper MIT; compiled **aubio is GPL-3.0** | Built-in BPM detector (aubio WASM) |

**Obligation:** the AGPL/GPL detectors require the combined shell to be
distributed under compatible terms with corresponding source available. The
shell's GPL-3.0-or-later license (2026-09-24) satisfies this once the public
source repository is live; until then, source is available on request from
the contact address on the Iblis site. Earlier alpha installers (alpha.37
through alpha.45) shipped these detectors under the old proprietary LICENSE;
the relicensed release supersedes them.

## acestep.cpp (shipped audio engine)

- **Source:** https://github.com/ServeurpersoCom/acestep.cpp
- **Pinned commit:** `948b92977eda15c28b052bb59ecf04142e147564`
- **License:** MIT; CI confirms `LICENSE` exists at the pin
- **Distributed as:** compiled `ace-server.exe`, built in Windows CI and
  delivered by engine pack `0.1.4`
- **Obligation:** MIT requires preserving the copyright/license notice in our
  distribution. Bundling full source is optional, not required. Include the
  upstream MIT `LICENSE` text (verbatim) with the shipped binary.
- **Outstanding:** add the upstream license/notice as an installed manifest
  asset and preserve the exact source pin in release provenance.

## ACE-Step model weights / GGUFs (shipped vendor-direct assets)

- **Artifact source:**
  [`Serveurperso/ACE-Step-1.5-GGUF`](https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/tree/9b3707625776cc4cf775e9b12ab82f9fe48335ff),
  pinned at `9b3707625776cc4cf775e9b12ab82f9fe48335ff`.
- **Pack 0.1.4 files:** 1.7B LM Q8_0, Qwen3 embedding Q8_0, turbo DiT Q8_0,
  and VAE BF16; exact byte counts and SHA-256 values live in
  `packages/plugins/acestep-engine/manifest.source.json` and exact LFS evidence
  lives in `packages/plugins/acestep-engine/UPSTREAM.txt`. The separately
  verified SFT Q8_0 asset is not part of pack 0.1.4.
- **License and attribution presented by source:** the
  [immutable model card](https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/blob/9b3707625776cc4cf775e9b12ab82f9fe48335ff/README.md)
  declares MIT, identifies `ACE-Step/Ace-Step1.5` as its base, and credits the
  original model weights to ACE Studio and StepFun. The selected plain SFT is
  not the separately credited SFT/Turbo merge.
- **Upstream notice:** ACE-Step's
  [MIT license](https://github.com/ace-step/ACE-Step-1.5/blob/ce2108509c4feb83b21c46f02e5f59093f01980a/LICENSE)
  carries `Copyright (c) 2026 ACEStep`. This is separate from the
  `acestep.cpp` authors' MIT notice.
- **Distributed as:** vendor-direct first-run downloads from Hugging Face,
  never in the shell installer; the signed catalog pins each byte by SHA-256.
- **Provenance limit:** the artifact pin proves the distributed bytes, but the
  repository supplies no exact input revisions or conversion attestation.
- **Outstanding:** install the ACE-Step MIT license and attribution with the
  model assets before another engine pack.

### Qwen-derived model components

- **Embedding provenance:**
  [ACE-Step's bundled encoder](https://huggingface.co/ACE-Step/Ace-Step1.5/tree/19671f406d603126926c1b7e2adc169acbcade22/Qwen3-Embedding-0.6B)
  at revision `19671f4` and the
  [official Qwen embedding](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B/tree/c54f2e6e80b2d7b7de06f51cec4959f6b3e03418)
  have the same 1,191,586,416-byte LFS object,
  `sha256:0437e45c94563b09e13cb7a64478fc406947a93cb34a7e05870fc8dcd48e23fd`.
  The shipped GGUF is a converted and Q8_0-quantized form.
- **LM provenance:** ACE-Step's
  [official model card](https://huggingface.co/ACE-Step/Ace-Step1.5/blob/19671f406d603126926c1b7e2adc169acbcade22/README.md)
  identifies the shipped 1.7B LM as pretrained from Qwen3-1.7B.
- **License:** both Qwen sources are Apache-2.0. The
  [Qwen3-0.6B-Base license](https://huggingface.co/Qwen/Qwen3-0.6B-Base/blob/da87bfb608c14b7cf20ba1ce41287e8de496c0cd/LICENSE)
  and the
  [Qwen3-1.7B-Base license](https://huggingface.co/Qwen/Qwen3-1.7B-Base/blob/ea980cb0a6c2ae4b936e82123acc929f1cec04c1/LICENSE)
  carry `Copyright 2024 Alibaba Cloud`.
- **Obligation:** distribute the Apache License 2.0 text, preserve applicable
  attribution, and identify the GGUF conversion/quantization. The inspected
  Qwen repositories expose no separate `NOTICE` file.
- **Outstanding:** install that Apache license and Qwen attribution for both
  the embedding and LM before another engine pack.

## GGML and incorporated engine dependencies

- **GGML:** the only gitlink at the pinned `acestep.cpp` commit is `ggml` at
  [`b677b63`](https://github.com/ggml-org/ggml/commit/b677b63c54461750dca4a54892d75baaa84bcb7c),
  MIT, `Copyright (c) 2023-2026 The ggml authors`. It has no recursive
  submodules. Its llama/whisper SHAs are code-sync provenance markers, not
  linked runtime dependencies.
- **YaRN:** derived code is compiled into the CPU and CUDA GGML backends;
  preserve its MIT notice for Jeffrey Quesnelle and Bowen Peng.
- **Static engine code:** the binary incorporates cpp-httplib `0.44.0`
  (`811dd0b`), yyjson content from `de7abc1`, and minimp3 content blob
  `3220ae1`. The first two are MIT; minimp3 is CC0-1.0. The copied minimp3
  content is exact, but upstream did not record a complete checkout pin.
- **Embedded engine UI:** `ace-server.exe` embeds a web UI containing Svelte
  `5.55.2`, Lucide `0.577.0` (including Feather-derived terms), YAML `2.8.4`,
  and conservatively its clsx `2.1.1` / esm-env `1.2.2` runtime dependencies.
  Build-only Vite/Rollup/esbuild/TypeScript are not distributed components.
- **Distributed as:** `ace-server.exe`, `ggml.dll`, `ggml-base.dll`,
  `ggml-cpu.dll`, and `ggml-cuda.dll`.
- **Outstanding:** install the exact MIT/ISC/CC0 notices and a component-to-pin
  index with the next engine pack. Full source is optional under MIT; the
  copyright and permission notices are not.

## GPU / compute runtime dependencies (shipped CUDA alpha)

- **Build toolkit:** NVIDIA CUDA `12.9.1`.
- **Distributed runtime files:** `cudart64_12.dll`, `cublas64_12.dll`, and
  `cublasLt64_12.dll`. No cuDNN, Vulkan, or Metal runtime is in the current
  Windows pack.
- **NVIDIA terms:** the
  [CUDA 12.9.1 EULA](https://docs.nvidia.com/cuda/archive/12.9.1/pdf/EULA.pdf)
  Attachment A lists these runtime families
  as redistributable subject to its application-only, downstream-terms, and
  NVIDIA-GPU conditions. Attachment B carries the cuBLAS third-party notices.
  Future CI checksum-gates the archived 12.9.1 EULA and records the exact DLL
  versions, hashes, and NVIDIA signatures with the artifact.
- **MSVC runtime files:** `vcruntime140.dll`, `vcruntime140_1.dll`,
  `msvcp140.dll`, and `concrt140.dll`. Future staging requires one complete
  Visual Studio `VC\Redist\MSVC\<version>\x64\Microsoft.VC143.CRT` directory,
  consistent with Microsoft's
  [Visual Studio 2022 REDIST list](https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution);
  the former System32 fallback is forbidden. It records versions, hashes, and
  valid Authenticode signatures.
- **Outstanding:** produce the next matching artifacts through those corrected
  workflows, include their NVIDIA/third-party notices and provenance in the
  installed pack, confirm Meiux's applicable Visual Studio license, and satisfy
  the Microsoft/NVIDIA downstream terms in the user agreement. Before 0.1.5,
  obtain counsel or vendor confirmation on whether public per-DLL GCS objects
  conflict with NVIDIA's no-standalone-distribution condition. Presence on a
  CI runner alone is not permission to ship.

## UI assets / fonts / brand imagery

- First-party brand assets and UI icons (`packages/brand/`) plus
  ImageRouter-generated decor are owned by Meiux Meiux LLC, all rights
  reserved (not open-source licensed), and listed here only for completeness.
- Any third-party font or icon set added later gets its own entry with the
  pinned version and license.

---

_A signed hash proves byte integrity, not redistribution compliance. Keep this
inventory and the installed notice assets in lockstep with every pack._
