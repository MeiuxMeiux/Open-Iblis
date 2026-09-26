// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: MIT
//
// Decode and encode for the stem worker. The shell only splits WAV masters
// (the Library's canonical format), so decode is hound over PCM 8/16/24/32
// and IEEE float 32, bounded by channel count, sample rate, and duration.

use anyhow::{bail, Context, Result};
use hound::{SampleFormat, WavReader, WavSpec, WavWriter};
use std::path::Path;

/// Longest input accepted, in seconds. Twenty minutes of stereo f32 at 48 kHz
/// is about 460 MB before stems; longer inputs are refused, not truncated.
pub const MAX_SECONDS: f64 = 20.0 * 60.0;

pub struct Stereo {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
    pub sample_rate: u32,
}

impl Stereo {
    pub fn seconds(&self) -> f64 {
        self.left.len() as f64 / self.sample_rate as f64
    }
}

/// Read a mono or stereo WAV into two channels. The reader (and its file
/// handle) is dropped before this returns, so a cancel after decode never
/// holds the source open.
pub fn read(path: &Path) -> Result<Stereo> {
    let reader = WavReader::open(path).context("cannot open the source WAV")?;
    let spec = reader.spec();
    let ch = spec.channels as usize;
    if ch == 0 || ch > 2 {
        bail!("expected mono or stereo audio, got {ch} channels");
    }
    if !(8_000..=192_000).contains(&spec.sample_rate) {
        bail!("sample rate {} Hz is outside 8-192 kHz", spec.sample_rate);
    }
    let frames = reader.duration() as usize;
    if frames == 0 {
        bail!("no audio samples in the source");
    }
    if frames as f64 / spec.sample_rate as f64 > MAX_SECONDS {
        bail!("source is longer than {} minutes", MAX_SECONDS / 60.0);
    }
    let interleaved: Vec<f32> = match (spec.sample_format, spec.bits_per_sample) {
        (SampleFormat::Float, 32) => reader.into_samples::<f32>().collect::<Result<_, _>>()?,
        (SampleFormat::Int, bits @ 8..=32) => {
            let scale = 1.0 / (1u64 << (bits - 1)) as f32;
            reader
                .into_samples::<i32>()
                .map(|s| s.map(|v| v as f32 * scale))
                .collect::<Result<_, _>>()?
        }
        (format, bits) => bail!("unsupported WAV sample format {format:?} {bits}-bit"),
    };
    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    for frame in interleaved.chunks_exact(ch) {
        let l = sanitize(frame[0]);
        left.push(l);
        right.push(if ch == 2 { sanitize(frame[1]) } else { l });
    }
    Ok(Stereo { left, right, sample_rate: spec.sample_rate })
}

fn sanitize(s: f32) -> f32 {
    if s.is_finite() { s } else { 0.0 }
}

/// Write a stereo IEEE-float WAV. Float keeps headroom: separated stems can
/// exceed full scale, and clipping them here would corrupt the re-sum.
pub fn write_wav(path: &Path, left: &[f32], right: &[f32], sample_rate: u32) -> Result<()> {
    let spec = WavSpec { channels: 2, sample_rate, bits_per_sample: 32, sample_format: SampleFormat::Float };
    let mut w = WavWriter::create(path, spec).context("cannot create stem file")?;
    for (l, r) in left.iter().zip(right.iter()) {
        w.write_sample(sanitize(*l))?;
        w.write_sample(sanitize(*r))?;
    }
    w.finalize().context("cannot finalize stem file")?;
    Ok(())
}

/// Peak and RMS in dBFS over both channels (floor -120 dB).
pub fn levels(left: &[f32], right: &[f32]) -> (f64, f64) {
    let mut peak = 0f64;
    let mut sum = 0f64;
    for s in left.iter().chain(right.iter()) {
        let v = f64::from(*s).abs();
        peak = peak.max(v);
        sum += v * v;
    }
    let n = (left.len() + right.len()).max(1) as f64;
    (to_db(peak), to_db((sum / n).sqrt()))
}

pub fn to_db(v: f64) -> f64 {
    if v <= 1e-6 { -120.0 } else { (20.0 * v.log10()).max(-120.0) }
}
