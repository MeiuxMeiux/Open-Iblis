# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# stems: Demucs htdemucs_6s over <scratch>/originals/ into
# <scratch>/stems/<track>/<stem>.wav. Weights load OFFLINE from the pack's
# models/htdemucs_6s/ local repo (yaml + .th staged by tools/training-pack);
# the sidecar never downloads anything.

from .common import StageError, apply_torch_threads, list_originals, pack_root, scratch_dir


def _load_model():
    from demucs.pretrained import get_model

    repo = pack_root() / "models" / "htdemucs_6s"
    if not repo.is_dir():
        raise StageError("the pack's htdemucs_6s weights are missing; reinstall the pack")
    try:
        return get_model("htdemucs_6s", repo=repo)
    except Exception as err:
        raise StageError(f"could not load the stem separation model: {err}")


def run(params: dict, progress) -> dict:
    scratch = scratch_dir(params)
    originals = list_originals(scratch)
    apply_torch_threads(params)

    import torch
    import torchaudio
    from demucs.apply import apply_model

    model = _load_model()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    stems_root = scratch / "stems"

    for index, track in enumerate(originals):
        progress(
            (index * 100) // len(originals),
            f"Separating stems {index + 1}/{len(originals)}: {track.name}",
        )
        wav, rate = torchaudio.load(str(track))
        if rate != model.samplerate:  # originals are 44.1k by construction
            wav = torchaudio.functional.resample(wav, rate, model.samplerate)
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        ref = wav.mean(0)
        std = ref.std().clamp_min(1e-8)
        normalized = (wav - ref.mean()) / std
        with torch.no_grad():
            sources = apply_model(
                model, normalized[None], device=device, shifts=0, split=True, progress=False
            )[0]
        sources = sources * std + ref.mean()
        out_dir = stems_root / track.stem
        out_dir.mkdir(parents=True, exist_ok=True)
        for name, tensor in zip(model.sources, sources):
            torchaudio.save(
                str(out_dir / f"{name}.wav"),
                tensor.clamp(-1, 1).cpu(),
                model.samplerate,
                encoding="PCM_S",
                bits_per_sample=16,
            )
        del sources
        if device == "cuda":
            torch.cuda.empty_cache()

    return {"trackCount": len(originals), "stems": list(model.sources)}
