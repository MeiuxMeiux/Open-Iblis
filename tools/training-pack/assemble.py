#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
# SPDX-License-Identifier: GPL-3.0-or-later

"""Training-pack build helpers, driven by build.sh (never run directly).

Subcommands:
  manifest <pins.json>                          print "sha<TAB>url<TAB>dest" download lines
  stage <pins> <cache> <stage> <src> <aceGit>   assemble the pack stage tree
  notices <pins> <out.md> [<stage>]             regenerate THIRD_PARTY_NOTICES.md
  zip <stage> <out.zip>                         deterministic zip (sorted, fixed mtime)
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

FIXED_DATE = (2026, 1, 1, 0, 0, 0)
# python311._pth: full isolation. Only the stdlib zip, the runtime dir and
# our frozen site-packages are importable; "import site" stays enabled so
# wheel-provided .pth files (protobuf et al.) work, but PATH/registry/user
# site never participate (embedded distribution semantics).
PTH_CONTENT = "python311.zip\n.\nLib/site-packages\nimport site\n"


def load(pins_path):
    return json.loads(Path(pins_path).read_text(encoding="utf-8"))


def iter_downloads(pins):
    py = pins["python"]
    yield py["sha256"], py["url"], "python-embed.zip"
    for wheel in pins["torch"] + pins["wheels"]:
        yield wheel["sha256"], wheel["url"], f"wheels/{wheel['filename']}"
    ff = pins["ffmpeg"]
    yield ff["sha256"], ff["url"], "ffmpeg.zip"
    dm = pins["demucsModels"]
    yield dm["yaml"]["sha256"], dm["yaml"]["url"], f"demucs/{dm['yaml']['path']}"
    for weight in dm["weights"]:
        yield weight["sha256"], weight["url"], f"demucs/{weight['path']}"
    base = pins["baseModel"]
    for entry in base["files"]:
        yield entry["sha256"], base["urlBase"] + entry["path"], f"acestep-model/{entry['path']}"


def cmd_manifest(pins_path):
    for sha, url, dest in iter_downloads(load(pins_path)):
        print(f"{sha}\t{url}\t{dest}")


def install_wheel(wheel_path, site_packages):
    # Cross-platform wheel install = unzip; RECORD is left in place (it is
    # inert), console scripts and .data payloads other than purelib/platlib
    # are dropped — the pack execs modules, never entry-point shims.
    with zipfile.ZipFile(wheel_path) as archive:
        archive.extractall(site_packages)
    for data_dir in sorted(site_packages.glob("*.data")):
        for sub in sorted(data_dir.iterdir()):
            if sub.name in ("purelib", "platlib"):
                for item in sorted(sub.rglob("*")):
                    if item.is_file():
                        rel = item.relative_to(sub)
                        target = site_packages / rel
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(item), str(target))
        shutil.rmtree(data_dir)


def cmd_stage(pins_path, cache, stage, src, ace_git):
    pins = load(pins_path)
    cache, stage, src, ace_git = Path(cache), Path(stage), Path(src), Path(ace_git)
    downloads = cache / "downloads"
    stage.mkdir(parents=True)

    runtime = stage / "runtime"
    runtime.mkdir()
    with zipfile.ZipFile(downloads / "python-embed.zip") as archive:
        archive.extractall(runtime)
    (runtime / "python311._pth").write_text(PTH_CONTENT, encoding="ascii")

    site_packages = runtime / "Lib" / "site-packages"
    site_packages.mkdir(parents=True)
    for wheel in pins["torch"] + pins["wheels"]:
        print(f"   wheel   {wheel['filename']}")
        install_wheel(downloads / "wheels" / wheel["filename"], site_packages)
    shutil.copytree(src / "iblis_train", site_packages / "iblis_train")

    print("   vendor  ace_step")
    shutil.copytree(
        ace_git, stage / "vendor" / "ace_step",
        ignore=shutil.ignore_patterns(".git", ".github", "__pycache__"),
    )

    print("   ffmpeg  (LGPL shared build: exe + dlls + license)")
    ffmpeg_dir = stage / "ffmpeg"
    ffmpeg_dir.mkdir()
    with zipfile.ZipFile(downloads / "ffmpeg.zip") as archive:
        for name in archive.namelist():
            base = Path(name).name
            keep = (
                base == "ffmpeg.exe"
                or (name.split("/")[1:2] == ["bin"] and base.endswith(".dll"))
                or base.upper().startswith("LICENSE")
            )
            if not keep or name.endswith("/"):
                continue
            with archive.open(name) as member, open(ffmpeg_dir / base, "wb") as out:
                shutil.copyfileobj(member, out)

    print("   models  htdemucs_6s + acestep base checkpoints")
    demucs_dir = stage / "models" / "htdemucs_6s"
    demucs_dir.mkdir(parents=True)
    dm = pins["demucsModels"]
    shutil.copyfile(downloads / "demucs" / dm["yaml"]["path"], demucs_dir / dm["yaml"]["path"])
    for weight in dm["weights"]:
        shutil.copyfile(downloads / "demucs" / weight["path"], demucs_dir / weight["path"])
    for entry in pins["baseModel"]["files"]:
        target = stage / "models" / "acestep" / entry["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(downloads / "acestep-model" / entry["path"], target)

    versions = {"pack": pins["packVersion"], "python": pins["python"]["version"]}
    for wheel in pins["torch"] + pins["wheels"]:
        versions[wheel["name"]] = wheel["version"]
    versions["ace-step"] = pins["aceStep"]["commit"]
    versions["ffmpeg"] = pins["ffmpeg"]["asset"]
    versions["htdemucs_6s"] = dm["weights"][0]["path"]
    versions["acestep-base-model"] = pins["baseModel"]["revision"]
    (runtime / "versions.json").write_text(
        json.dumps(versions, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def cmd_notices(pins_path, out_md, stage=None):
    pins = load(pins_path)
    lines = [
        "# Iblis ACE-Step training pack — third-party notices",
        "",
        "Generated from tools/training-pack/pins.json (regenerated by every",
        "`just training-pack-build`; commit the result). Wheel license texts",
        "ship verbatim inside runtime/Lib/site-packages/*.dist-info/, the",
        "ffmpeg license rides in ffmpeg/, and model provenance is pinned",
        "below. Publish blocker per docs/training/06: this inventory must be",
        "reconciled before the pack first ships.",
        "",
        f"Pack version {pins['packVersion']}, pinned {pins['pinnedAt']}.",
        "",
        "## Runtime",
        "",
        f"- CPython {pins['python']['version']} embeddable (PSF-2.0) — {pins['python']['url']}",
        "",
        "## Vendored trainer",
        "",
        f"- ACE-Step 1.5 ({pins['aceStep']['license']}) — {pins['aceStep']['repo']} @ {pins['aceStep']['commit']}",
        "",
        "## Python wheels",
        "",
    ]
    for wheel in pins["torch"] + sorted(pins["wheels"], key=lambda w: w["name"]):
        lines.append(
            f"- {wheel['name']} {wheel['version']} ({wheel.get('license') or 'see wheel metadata'}) — {wheel['url']}"
        )
    ff = pins["ffmpeg"]
    dm = pins["demucsModels"]
    base = pins["baseModel"]
    lines += [
        "",
        "## FFmpeg",
        "",
        f"- {ff['asset']} ({ff['license']}, {ff['build']}) — {ff['url']}",
        "  Shared LGPL build invoked strictly as a separate process; its",
        "  license text ships next to the binary in ffmpeg/.",
        "",
        "## Model weights",
        "",
        f"- Demucs htdemucs_6s ({dm['license']})",
    ]
    for weight in dm["weights"]:
        lines.append(f"  - {weight['url']} sha256 {weight['sha256']}")
    lines += [
        f"- ACE-Step 1.5 base checkpoints ({base['license']})",
        f"  - https://huggingface.co/{base['repo']} @ {base['revision']}",
        "  - Includes Qwen3-Embedding-0.6B (Apache-2.0, Copyright 2024",
        "    Alibaba Cloud); its license terms are preserved by the pinned",
        "    upstream repository snapshot.",
        "",
        "Every artifact above is sha256-pinned in pins.json; the build fails",
        "on any mismatch. No component phones home at runtime: the sidecar",
        "binds 127.0.0.1 and performs no outbound requests.",
        "",
    ]
    text = "\n".join(lines)
    Path(out_md).write_text(text, encoding="utf-8")
    if stage:
        Path(stage, "THIRD_PARTY_NOTICES.md").write_text(text, encoding="utf-8")
    print(f"   notices {out_md}")


def cmd_zip(stage, out_zip):
    stage = Path(stage)
    entries = sorted(
        (p for p in stage.rglob("*") if p.is_file()),
        key=lambda p: str(p.relative_to(stage)).lower(),
    )
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in entries:
            rel = path.relative_to(stage).as_posix()
            info = zipfile.ZipInfo(rel, date_time=FIXED_DATE)
            mode = 0o755 if path.suffix.lower() in (".exe", ".dll", ".pyd") else 0o644
            info.external_attr = mode << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            # Stream: the base checkpoints are multi-GB; never read_bytes().
            with open(path, "rb") as source, archive.open(info, "w", force_zip64=True) as member:
                shutil.copyfileobj(source, member, 1 << 20)
    print(f"   zipped  {len(entries)} files")


def main(argv):
    commands = {
        "manifest": cmd_manifest,
        "stage": cmd_stage,
        "notices": cmd_notices,
        "zip": cmd_zip,
    }
    if not argv or argv[0] not in commands:
        print(__doc__, file=sys.stderr)
        return 2
    commands[argv[0]](*argv[1:])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
