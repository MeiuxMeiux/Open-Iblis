# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# tag: librosa-based v1 tagger. allin1 cannot ship on Windows (its natten
# dependency has no win_amd64 wheels — packaging decision recorded in
# docs/training/01), so v1 derives BPM (beat_track), key (Krumhansl-
# Schmuckler chroma correlation), and a structure timeline (RMS-novelty
# segmentation) directly. "mood" and "genres" stay reserved empty lists
# (Essentia is out of v1 for the same wheel reason).

import json

from .common import StageError, list_originals, mmss, scratch_dir

NOTES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
# Krumhansl-Schmuckler key profiles.
MAJOR = (6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
MINOR = (6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)

MIN_SECTION_S = 8.0


def _estimate_key(chroma_mean):
    import numpy as np

    best = (-2.0, "C major")
    for mode, profile in (("major", MAJOR), ("minor", MINOR)):
        prof = np.asarray(profile)
        for shift in range(12):
            score = np.corrcoef(np.roll(prof, shift), chroma_mean)[0, 1]
            if score > best[0]:
                best = (float(score), f"{NOTES[shift]} {mode}")
    return best[1]


def _segment_states(smoothed, times):
    """Collapse the smoothed RMS curve into (state, startSec) sections."""
    sections = []
    for value, when in zip(smoothed, times):
        state = "high" if value > 0.65 else ("low" if value < 0.35 else "mid")
        if not sections or sections[-1][0] != state:
            sections.append([state, float(when)])
    merged = [sections[0]]
    for state, start in sections[1:]:  # absorb blips shorter than a phrase
        if start - merged[-1][1] < MIN_SECTION_S and len(merged) > 1:
            continue
        if state == merged[-1][0]:
            continue
        merged.append([state, start])
    return merged


def _label_sections(sections):
    # Heuristic mapping for bass-music structure: a sustained high-RMS onset
    # is a [Drop]; the rising section before it is a [Build]; low/mid valleys
    # between drops are [Break]s; the edges are [Intro]/[Outro].
    labeled = []
    for index, (state, start) in enumerate(sections):
        nxt = sections[index + 1][0] if index + 1 < len(sections) else None
        if index == 0:
            label = "[Drop]" if state == "high" else "[Intro]"
        elif state == "high":
            label = "[Drop]"
        elif nxt == "high":
            label = "[Build]"
        elif index == len(sections) - 1:
            label = "[Outro]"
        else:
            label = "[Break]"
        if labeled and labeled[-1][0] == label:
            continue
        labeled.append((label, start))
    return labeled


def _describe(bpm, rms_norm_mean, centroid_mean, low_ratio):
    tags = ["instrumental"]
    if bpm < 90:
        tags.append("slow tempo")
    elif bpm < 125:
        tags.append("mid-tempo")
    elif bpm < 150:
        tags.append("fast tempo")
    else:
        tags.append("very fast tempo")
    tags.append("high energy" if rms_norm_mean > 0.5 else "dynamic")
    tags.append("bright" if centroid_mean > 3000 else "dark")
    if low_ratio > 0.3:
        tags.append("bass-heavy")
    return tags


def _analyze(path):
    import librosa
    import numpy as np

    y, sr = librosa.load(str(path), sr=22050, mono=True)
    if y.size < sr:
        raise StageError(f"track too short to analyze: {path.name}")

    tempo, _beats = librosa.beat.beat_track(y=y, sr=sr)
    bpm = int(round(float(np.atleast_1d(tempo)[0]))) or 120

    chroma = librosa.feature.chroma_cqt(y=y, sr=sr).mean(axis=1)
    key = _estimate_key(chroma)

    hop = 512
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    window = max(1, int(2.0 * sr / hop))  # ~2 s smoothing
    kernel = np.ones(window) / window
    smoothed = np.convolve(rms, kernel, mode="same")
    peak = smoothed.max() or 1.0
    smoothed = smoothed / peak
    times = librosa.frames_to_time(np.arange(len(smoothed)), sr=sr, hop_length=hop)

    centroid = float(librosa.feature.spectral_centroid(y=y, sr=sr).mean())
    spectrum = np.abs(librosa.stft(y, n_fft=2048))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    total_energy = float((spectrum ** 2).sum()) or 1.0
    low_ratio = float((spectrum[freqs < 150] ** 2).sum()) / total_energy

    timeline = _label_sections(_segment_states(smoothed, times))
    tags = _describe(bpm, float(smoothed.mean()), centroid, low_ratio)
    return bpm, key, timeline, tags


def run(params: dict, progress) -> dict:
    scratch = scratch_dir(params)
    originals = list_originals(scratch)
    tags_dir = scratch / "tags"
    tags_dir.mkdir(parents=True, exist_ok=True)

    for index, track in enumerate(originals):
        progress(
            (index * 100) // len(originals),
            f"Tagging {index + 1}/{len(originals)}: {track.name}",
        )
        bpm, key, timeline, tags = _analyze(track)
        lines = [f"{label} {mmss(start)}" for label, start in timeline]
        (tags_dir / f"{track.stem}.timeline.txt").write_text(
            "\n".join(lines) + "\n", encoding="utf-8"
        )
        payload = {"bpm": bpm, "key": key, "tags": tags, "mood": [], "genres": []}
        (tags_dir / f"{track.stem}.json").write_text(
            json.dumps(payload, indent=2) + "\n", encoding="utf-8"
        )

    return {"trackCount": len(originals)}
