# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# dataset: assemble the exact layout the pinned ACE-Step 1.5 trainer scans
# (vendor/ace_step acestep/training_v2/preprocess_discovery.py): audio files
# plus a dataset JSON of {metadata, samples[{filename, caption, lyrics, bpm,
# keyscale, timesignature, is_instrumental}]}.
#
# Texture trains on isolated stems; Groove trains on full mixes. The two are
# NEVER mixed in one dataset (ratified design, docs/training/01).

import json
import shutil
import wave

from .common import StageError, scratch_dir

TEXTURE_STEMS = ("drums", "bass", "other", "guitar", "piano", "vocals")
SILENCE_PEAK = 300  # int16 peak below this = effectively silent stem


def _load_tags(scratch):
    tags_dir = scratch / "tags"
    if not tags_dir.is_dir():
        raise StageError("no tag sidecars found; run the tag stage first")
    loaded = {}
    for path in tags_dir.glob("*.json"):
        try:
            loaded[path.stem] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
    timelines = {}
    for path in tags_dir.glob("*.timeline.txt"):
        stem = path.name[: -len(".timeline.txt")]
        labels = []
        for line in path.read_text(encoding="utf-8").splitlines():
            label = line.split(" ", 1)[0]
            if label.startswith("[") and (not labels or labels[-1] != label):
                labels.append(label)
        timelines[stem] = labels
    return loaded, timelines


def _wav_is_silent(path):
    try:
        with wave.open(str(path), "rb") as handle:
            frames = handle.readframes(handle.getnframes())
        if not frames:
            return True
        width = 2  # stems are written PCM_S 16-bit by stems.py
        peak = 0
        step = max(width, (len(frames) // 4096) * width or width)
        for offset in range(0, len(frames) - width + 1, step):
            sample = int.from_bytes(frames[offset:offset + width], "little", signed=True)
            peak = max(peak, abs(sample))
        return peak < SILENCE_PEAK
    except (wave.Error, OSError, EOFError):
        return False  # unreadable here is not proof of silence; keep it


def _sample(filename, caption, lyrics, tag_info):
    return {
        "filename": filename,
        "audio_path": filename,
        "caption": caption,
        "lyrics": lyrics,
        "genre": "",
        "bpm": tag_info.get("bpm"),
        "keyscale": tag_info.get("key", ""),
        "timesignature": "4",
        "is_instrumental": True,
    }


def _caption(prefix, tag_info):
    parts = [prefix] + list(tag_info.get("tags", []))
    if tag_info.get("key"):
        parts.append(tag_info["key"])
    if tag_info.get("bpm"):
        parts.append(f"{tag_info['bpm']} bpm")
    return ", ".join(parts)


def _write_dataset(scratch, name, samples):
    payload = {
        "metadata": {"tag_position": "prepend", "genre_ratio": 0, "custom_tag": ""},
        "samples": samples,
    }
    (scratch / f"{name}.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )


def _build_texture(scratch, tags, progress):
    stems_root = scratch / "stems"
    if not stems_root.is_dir():
        raise StageError("no stems found; run the stems stage first")
    out = scratch / "dataset_texture"
    out.mkdir(parents=True, exist_ok=True)
    samples = []
    tracks = sorted(p for p in stems_root.iterdir() if p.is_dir())
    for index, track_dir in enumerate(tracks):
        progress(
            (index * 50) // max(1, len(tracks)),
            f"Texture dataset {index + 1}/{len(tracks)}: {track_dir.name}",
        )
        info = tags.get(track_dir.name, {})
        for stem in TEXTURE_STEMS:
            source = track_dir / f"{stem}.wav"
            if not source.is_file() or _wav_is_silent(source):
                continue
            filename = f"{track_dir.name}__{stem}.wav"
            shutil.copyfile(source, out / filename)
            samples.append(
                _sample(filename, _caption(f"isolated {stem} stem", info), "[Instrumental]", info)
            )
    if not samples:
        raise StageError("every separated stem was silent; cannot build the texture dataset")
    _write_dataset(scratch, "dataset_texture", samples)
    return len(samples)


def _build_groove(scratch, tags, timelines, progress):
    originals = sorted((scratch / "originals").glob("*.wav"))
    if not originals:
        raise StageError("no ingested tracks found; run the scan stage first")
    out = scratch / "dataset_groove"
    out.mkdir(parents=True, exist_ok=True)
    samples = []
    for index, track in enumerate(originals):
        progress(
            50 + (index * 50) // len(originals),
            f"Groove dataset {index + 1}/{len(originals)}: {track.name}",
        )
        info = tags.get(track.stem, {})
        shutil.copyfile(track, out / track.name)
        structure = timelines.get(track.stem) or ["[Intro]", "[Outro]"]
        samples.append(
            _sample(track.name, _caption("full mix", info), "\n".join(structure), info)
        )
    _write_dataset(scratch, "dataset_groove", samples)
    return len(samples)


def run(params: dict, progress) -> dict:
    scratch = scratch_dir(params)
    categories = [c for c in (params.get("categories") or []) if c in ("texture", "groove")]
    if not categories:
        raise StageError("dataset stage needs at least one category (texture, groove)")
    tags, timelines = _load_tags(scratch)

    counts = {}
    if "texture" in categories:
        counts["texture"] = _build_texture(scratch, tags, progress)
    if "groove" in categories:
        counts["groove"] = _build_groove(scratch, tags, timelines, progress)
    return counts
