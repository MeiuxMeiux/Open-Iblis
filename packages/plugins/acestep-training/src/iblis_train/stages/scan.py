# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: MIT

# scan: inventory the user's folder, probe durations, and (when ingest=1)
# transcode every accepted track to 44.1 kHz stereo 16-bit WAV in
# <scratch>/originals/ with deterministic zero-padded names.

import os
import subprocess
import wave
from pathlib import Path

from .common import StageError, ffmpeg_path, scratch_dir, slug

AUDIO_EXTS = {".wav", ".flac", ".mp3"}
DEFAULT_MAX_TRACKS = 200


def _probe_duration(path: Path):
    """Return (seconds, reason). seconds is None when unreadable."""
    ext = path.suffix.lower()
    if ext in (".wav", ".flac"):
        try:
            import soundfile

            info = soundfile.info(str(path))
            if info.frames > 0 and info.samplerate > 0:
                return info.frames / info.samplerate, None
            return None, "file contains no audio"
        except ImportError:
            pass  # dev box without the packed runtime: wav fallback below
        except Exception:
            return None, "unreadable audio file"
        if ext == ".wav":
            try:
                with wave.open(str(path), "rb") as handle:
                    frames, rate = handle.getnframes(), handle.getframerate()
                if frames > 0 and rate > 0:
                    return frames / rate, None
                return None, "file contains no audio"
            except (wave.Error, OSError, EOFError):
                return None, "unreadable audio file"
        return None, "FLAC probing needs the packed runtime"
    if ext == ".mp3":
        try:
            import mutagen

            meta = mutagen.File(str(path))
            length = getattr(getattr(meta, "info", None), "length", 0) or 0
            if length > 0:
                return float(length), None
            return None, "file contains no audio"
        except ImportError:
            return None, "MP3 probing needs the packed runtime"
        except Exception:
            return None, "unreadable audio file"
    return None, "unsupported format"


def _collect(source: Path):
    found = []
    for base, _dirs, files in os.walk(source):
        for name in files:
            if Path(name).suffix.lower() in AUDIO_EXTS:
                found.append(Path(base) / name)
    found.sort(key=lambda p: str(p).lower())
    return found


def _ingest(track: Path, dest: Path, ffmpeg: str) -> bool:
    done = subprocess.run(
        [ffmpeg, "-hide_banner", "-nostdin", "-y", "-i", str(track),
         "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", str(dest)],
        capture_output=True, text=True,
    )
    if done.returncode != 0 or not dest.is_file():
        dest.unlink(missing_ok=True)
        return False
    return True


def run(params: dict, progress) -> dict:
    source = Path(str(params.get("source") or ""))
    if not source.is_dir():
        raise StageError(f"the source folder does not exist: {source}")
    scratch = scratch_dir(params)
    max_tracks = int(params.get("maxTracks") or DEFAULT_MAX_TRACKS)
    ingest = bool(params.get("ingest"))

    candidates = _collect(source)
    if len(candidates) > max_tracks:
        raise StageError(
            f"Found {len(candidates)} audio files, over the hard limit of "
            f"{max_tracks} tracks. More tracks dilute a LoRA and push the "
            f"runtime into days; trim the folder and scan again."
        )

    ffmpeg = ffmpeg_path() if ingest else None
    originals = scratch / "originals"
    if ingest:
        originals.mkdir(parents=True, exist_ok=True)

    accepted, skipped, total_duration = 0, [], 0.0
    for index, track in enumerate(candidates):
        progress(
            (index * 100) // max(1, len(candidates)),
            f"Scanning {index + 1}/{len(candidates)}: {track.name}",
        )
        duration, reason = _probe_duration(track)
        if duration is None:
            skipped.append({"name": track.name, "reason": reason})
            continue
        if ingest:
            dest = originals / f"{accepted:03d}-{slug(track.stem)}.wav"
            if not _ingest(track, dest, ffmpeg):
                skipped.append({"name": track.name, "reason": "transcode failed"})
                continue
        accepted += 1
        total_duration += duration

    if accepted == 0:
        raise StageError("no readable audio tracks were found in the folder")
    return {
        "trackCount": accepted,
        "totalDurationSec": round(total_duration, 1),
        "skipped": skipped,
    }
