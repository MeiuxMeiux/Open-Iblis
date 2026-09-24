# Training a Style

A Style is a LoRA adapter: a small file that nudges the music engine toward
the sound of the songs it was trained on. The Training section builds one on
your own computer from a folder of your music. Training runs locally, like
generation; sharing the result with other people is a separate, optional step
that uses the hosted community Styles service.

## What you need

- **An NVIDIA GPU with CUDA.** 8 GB of VRAM is a supported configuration: the
  app picks low-memory settings, and warns that runs are long and memory is
  tight. Cards that report under about 6 GB are refused, because they would
  run out of memory. Training cannot run without an NVIDIA GPU.
- **Disk space for scratch files.** Intermediate files take roughly 1.25 GB
  per track while training runs (an estimate). The preflight check compares
  this with your free space.
- **The training pack.** A separate, optional plugin from the catalog,
  several GB, installed from the Training section. It contains an isolated,
  embedded Python runtime with PyTorch, Demucs, and the ACE-Step 1.5 trainer,
  plus the base model checkpoints. It never touches the network and does not
  use or change any Python installed on your system. Generation works with or
  without it, and you can remove it in Plugins.
- **Your songs.** A folder of `.wav`, `.flac`, or `.mp3` files that you have
  the rights to train on. Around 10 to 50 tracks is a reasonable range; more
  than 200 is refused.

## The wizard

Training, New training walks through five steps. Each must pass before the
next.

1. **Folder.** Choose the folder. The app lists what it found and what it
   skipped (non-audio files, unreadable audio).
2. **Preflight.** A checklist of GPU memory, free disk against the scratch
   estimate, track count, and engine state, each marked pass, warning, or
   fail, with the numbers. A generation in the queue blocks training until
   it finishes; training never cancels your work.
3. **Name.** Lowercase letters, digits, and hyphens, 3 to 40 characters,
   starting with a letter or digit.
4. **Consent.** Two explicit confirmations, recorded with the job: that you
   hold the rights to train on this audio, and that you understand what
   sharing does if you choose to share.
5. **Plan.** Choose Texture, Groove, or both. Texture learns from separated
   instrument stems (timbre and sound design); Groove learns from full mixes
   (rhythm and arrangement). Both run one after the other, never at once.
   Advanced settings let you override rank, epochs, batch size, gradient
   accumulation, optimizer (AdamW or Adafactor), precision, gradient
   checkpointing, and encoder offload. Every field defaults to Auto, and the
   trainer clamps any override to a safe range.

## What happens in each stage

The running view shows every stage with its own progress bar, the current
detail, elapsed time, and a Cancel button. While training runs, the engine is
stopped to free GPU memory and Create shows that generation is paused.

| Stage | What it does |
| --- | --- |
| Scan | Checks every file and converts it to 44.1 kHz stereo WAV in the job's scratch folder. Your originals are not modified. |
| Stems | Separates each track into instrument stems with Demucs (`htdemucs_6s`). Needed for Texture. |
| Tag | Analyzes each track for BPM, key, and a structure timeline (intro, build, drop, break, outro). |
| Dataset | Builds the Texture dataset from stems and the Groove dataset from full mixes. The two are never mixed. |
| Train (Texture, Groove) | Runs the LoRA trainer on the GPU with settings chosen for your card's memory. |
| Export | Writes each adapter as a `.safetensors` file and checks it. Large intermediate tensors are deleted. |
| Upload, Pull-down | Only when you share: see below. |

The trainer picks settings from your total VRAM:

| Card | Rank / alpha | Optimizer | Gradient accumulation | Encoder offload |
| --- | --- | --- | --- | --- |
| Under 10 GB | 16 / 32 | Adafactor | 8 | On |
| 10 to 16 GB | 32 / 64 | AdamW | 4 | On |
| 16 to 24 GB | 64 / 128 | AdamW | 4 | Off |
| 24 GB and up | 128 / 256 | AdamW | 2 | Off |

Gradient checkpointing is on in every tier. If the app cannot read your VRAM,
it uses the first row.

If the app closes or the computer restarts mid-run, the job shows as
interrupted in Training's history with a Resume button. Resume re-runs the
interrupted stage from its inputs.

## Where the Style lands

Each finished adapter is written to the job's output folder:

```
<data>\training\<job-id>\output\<name>.safetensors
```

`<data>` is `%APPDATA%\Iblis\` unless you moved it in Settings, Data location.
A Style in your Styles library lives in `<data>\adapters\`. In Create, pick a
Style and generate; the engine uses one Style at a time.

## Sharing through community Styles

Community Styles is a hosted library of trainings that other people can
browse and download in the Styles section. Publishing to it, and downloading
from it, needs an activated product key.

When you share a training:

1. The app uploads each adapter in resumable chunks, authenticated by your
   product key's signed lease. If the upload fails, the job waits in
   Awaiting upload with a Retry button; nothing is lost.
2. The service validates the file and adds it to the community index, which
   is signed with the same key as the plugin catalog.
3. Once it is live, the app downloads the published file, checks that its
   SHA-256 matches what you uploaded, and adds it to your Styles library
   marked Yours.

Shared trainings are public and downloadable by anyone with the app and a
key. Training a name again that you already own publishes a new version of
it; a name another person owns cannot be reused. The service applies daily
and concurrent upload limits.

## Building the training pack yourself

`just training-pack-build` assembles the pack's runtime archive from the
hash-pinned inputs in `tools/training-pack/pins.json`. It downloads several
GB on the first run. `just test` includes the trainer sidecar's unit tests,
which need no GPU.
