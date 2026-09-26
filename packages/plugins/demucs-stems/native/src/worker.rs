// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: MIT
//
// One separation in its own process. The server spawns
//   iblis-stems worker --model <id> --weights <file> --input <audio>
//                      --out <staging dir> --backend gpu|cpu
// and reads one JSON object per stdout line. Killing this process is the
// cancel path: it releases the GPU context and every file handle at once.

use crate::audio;
use anyhow::{bail, Context, Result};
use demucs_core::listener::{ForwardEvent, ForwardListener};
use demucs_core::model::metadata::{StemId, HTDEMUCS_6S_ID, HTDEMUCS_FT_ID, HTDEMUCS_ID};
use demucs_core::{num_chunks, Demucs, ModelOptions};
use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

pub struct WorkerArgs {
    pub model: String,
    pub weights: PathBuf,
    pub input: PathBuf,
    pub out: PathBuf,
    pub backend: String,
}

pub fn emit(value: serde_json::Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

pub fn run(args: WorkerArgs) -> i32 {
    match run_inner(&args) {
        Ok(()) => 0,
        Err(err) => {
            emit(json!({ "event": "error", "message": format!("{err:#}") }));
            1
        }
    }
}

fn options_for(model: &str) -> Result<ModelOptions> {
    Ok(match model {
        HTDEMUCS_ID => ModelOptions::FourStem,
        HTDEMUCS_6S_ID => ModelOptions::SixStem,
        HTDEMUCS_FT_ID => ModelOptions::FineTuned(vec![StemId::Drums, StemId::Bass, StemId::Other, StemId::Vocals]),
        other => bail!("unknown model {other}"),
    })
}

fn run_inner(args: &WorkerArgs) -> Result<()> {
    let opts = options_for(&args.model)?;
    emit(json!({ "event": "stage", "stage": "decoding" }));
    let source = audio::read(&args.input)?;
    emit(json!({ "event": "stage", "stage": "loading" }));
    let weights = std::fs::read(&args.weights).context("cannot read model weights")?;
    match args.backend.as_str() {
        "cpu" => separate::<burn::backend::NdArray<f32>>(opts, &weights, &source, args, "cpu"),
        #[cfg(feature = "gpu")]
        "gpu" => {
            init_gpu();
            separate::<burn::backend::wgpu::Wgpu>(opts, &weights, &source, args, "gpu")
        }
        other => bail!("backend {other} is not available in this build"),
    }
}

#[cfg(feature = "gpu")]
fn init_gpu() {
    use burn::backend::wgpu::{graphics::AutoGraphicsApi, init_setup, RuntimeOptions, WgpuDevice};
    use cubecl::config::{autotune::AutotuneConfig, cache::CacheConfig, GlobalConfig};
    GlobalConfig::set(GlobalConfig {
        autotune: AutotuneConfig { cache: CacheConfig::Global, ..Default::default() },
        ..Default::default()
    });
    let device = WgpuDevice::default();
    init_setup::<AutoGraphicsApi>(&device, RuntimeOptions { tasks_max: 128, ..Default::default() });
}

fn separate<B: burn::prelude::Backend>(
    opts: ModelOptions,
    weights: &[u8],
    source: &audio::Stereo,
    args: &WorkerArgs,
    backend: &str,
) -> Result<()> {
    let started = Instant::now();
    let n_models = if matches!(opts, ModelOptions::FineTuned(_)) { 4 } else { 1 };
    let device: B::Device = Default::default();
    let model = Demucs::<B>::from_bytes(opts, weights, device).context("model weights failed to load")?;
    emit(json!({ "event": "stage", "stage": "separating", "backend": backend }));

    let frames_44k = (source.left.len() as f64 * 44_100.0 / source.sample_rate as f64).ceil() as usize;
    let chunks = num_chunks(frames_44k);
    let mut listener = Progress::new(n_models * 18 * chunks);
    let stems = pollster::block_on(model.separate_with_listener(
        &source.left,
        &source.right,
        source.sample_rate,
        &mut listener,
    ))
    .context("separation failed")?;

    emit(json!({ "event": "stage", "stage": "writing" }));
    let residual = residual_db(source, &stems);
    for stem in &stems {
        let role = stem.id.as_str();
        let file = format!("{role}.wav");
        audio::write_wav(&args.out.join(&file), &stem.left, &stem.right, source.sample_rate)?;
        let (peak, rms) = audio::levels(&stem.left, &stem.right);
        emit(json!({ "event": "stem", "role": role, "file": file, "peakDb": round1(peak), "rmsDb": round1(rms) }));
    }
    emit(json!({
        "event": "done",
        "backend": backend,
        "sampleRate": source.sample_rate,
        "frames": source.left.len(),
        "seconds": round1(source.seconds()),
        "residualDb": round1(residual),
        "computeMs": started.elapsed().as_millis() as u64,
    }));
    Ok(())
}

/// Re-sum error relative to the mix, in dB. A quality signal for the UI, not
/// a promise of perfect reconstruction: -30 dB or lower is typical.
fn residual_db(source: &audio::Stereo, stems: &[demucs_core::Stem]) -> f64 {
    let (mut err, mut mix) = (0f64, 0f64);
    for i in 0..source.left.len() {
        let (mut sl, mut sr) = (0f64, 0f64);
        for s in stems {
            sl += f64::from(s.left.get(i).copied().unwrap_or(0.0));
            sr += f64::from(s.right.get(i).copied().unwrap_or(0.0));
        }
        let (l, r) = (f64::from(source.left[i]), f64::from(source.right[i]));
        err += (l - sl).powi(2) + (r - sr).powi(2);
        mix += l * l + r * r;
    }
    if mix <= 1e-12 { return -120.0; }
    audio::to_db((err / mix).sqrt())
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

struct Progress {
    total: usize,
    done: usize,
    last_pct: i64,
}

impl Progress {
    fn new(total: usize) -> Self {
        Self { total: total.max(1), done: 0, last_pct: -1 }
    }
}

impl ForwardListener for Progress {
    fn on_event(&mut self, event: ForwardEvent) {
        if matches!(
            event,
            ForwardEvent::EncoderDone { .. } | ForwardEvent::DecoderDone { .. } | ForwardEvent::TransformerDone { .. } | ForwardEvent::Denormalized
        ) {
            self.done = (self.done + 1).min(self.total);
            let pct = (self.done * 100 / self.total) as i64;
            if pct != self.last_pct {
                self.last_pct = pct;
                emit(json!({ "event": "progress", "fraction": self.done as f64 / self.total as f64 }));
            }
        }
    }
}

pub fn parse_args(argv: &[String]) -> Result<WorkerArgs> {
    let get = |flag: &str| -> Result<String> {
        let i = argv.iter().position(|a| a == flag).with_context(|| format!("missing {flag}"))?;
        argv.get(i + 1).cloned().with_context(|| format!("missing value for {flag}"))
    };
    let out = PathBuf::from(get("--out")?);
    if !Path::new(&out).is_dir() {
        bail!("--out must be an existing directory");
    }
    Ok(WorkerArgs {
        model: get("--model")?,
        weights: PathBuf::from(get("--weights")?),
        input: PathBuf::from(get("--input")?),
        out,
        backend: get("--backend")?,
    })
}
