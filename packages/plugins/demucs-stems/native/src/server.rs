// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: MIT
//
// Processor protocol v2 (transform) over authenticated loopback HTTP.
// Mirrors packages/plugin-sdk/src/processor-transform.ts:
//   GET  /health
//   POST /v2/transform          -> accepted | refused
//   GET  /v2/jobs/:id           -> queued | running | done | error | cancelled
//   POST /v2/jobs/:id/cancel    -> answers only after the worker has exited
// Every request must carry X-Iblis-Session. One job runs at a time; the host
// owns queueing, so a second transform while busy is refused, not queued.

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tiny_http::{Header, Method, Request, Response, Server};

const MAX_BODY: u64 = 16 * 1024;
const KEEP_FINISHED: usize = 16;

pub struct Config {
    pub port: u16,
    pub session: String,
    pub model: String,
    pub weights: PathBuf,
    pub stems: Vec<String>,
}

#[derive(Clone, Default)]
struct Job {
    status: &'static str,
    progress: f64,
    stage: Option<String>,
    backend: Option<String>,
    fallback: Option<String>,
    outputs: Vec<Value>,
    metrics: Option<Value>,
    error: Option<String>,
    seq: u64,
}

#[derive(Default)]
struct State {
    jobs: HashMap<String, Job>,
    child: Option<(String, Child)>,
    cancelled: Option<String>,
    seq: u64,
}

type Shared = Arc<Mutex<State>>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransformRequest {
    protocol_version: u32,
    job_id: String,
    transform: String,
    input: TransformInput,
    staging_dir: String,
    #[serde(default)]
    config: TransformConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransformInput {
    audio_path: String,
    source_sha256: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransformConfig {
    #[serde(default)]
    backend: Option<String>,
}

pub fn serve(cfg: Config) -> anyhow::Result<()> {
    let server = Server::http(("127.0.0.1", cfg.port)).map_err(|e| anyhow::anyhow!("bind failed: {e}"))?;
    let cfg = Arc::new(cfg);
    let state: Shared = Arc::default();
    for mut req in server.incoming_requests() {
        let authorized = req
            .headers()
            .iter()
            .any(|h| h.field.equiv("X-Iblis-Session") && h.value.as_str() == cfg.session);
        let (code, body) = if !authorized {
            (401, json!({ "ok": false, "error": "unauthorized" }))
        } else {
            route(&mut req, &cfg, &state)
        };
        respond(req, code, &body);
    }
    Ok(())
}

fn respond(req: Request, code: u16, body: &Value) {
    let header = Header::from_bytes("Content-Type", "application/json").expect("static header");
    let _ = req.respond(Response::from_string(body.to_string()).with_status_code(code).with_header(header));
}

fn route(req: &mut Request, cfg: &Arc<Config>, state: &Shared) -> (u16, Value) {
    let url = req.url().to_string();
    let parts: Vec<&str> = url.trim_matches('/').split('/').collect();
    match (req.method(), parts.as_slice()) {
        (Method::Get, ["health"]) => (200, health(cfg)),
        (Method::Post, ["v2", "transform"]) => match read_json::<TransformRequest>(req) {
            Ok(body) => start(body, cfg, state),
            Err(msg) => (400, refused("", &msg)),
        },
        (Method::Get, ["v2", "jobs", id]) => job_status(id, state),
        (Method::Post, ["v2", "jobs", id, "cancel"]) => cancel(id, state),
        _ => (404, json!({ "ok": false, "error": "not found" })),
    }
}

fn health(cfg: &Config) -> Value {
    let mut backends = vec!["cpu"];
    if cfg!(feature = "gpu") {
        backends.insert(0, "gpu");
    }
    json!({
        "ok": true, "name": "iblis-stems", "version": env!("CARGO_PKG_VERSION"),
        "protocolVersion": 2, "transforms": ["stem-split"],
        "model": cfg.model, "stems": cfg.stems, "backends": backends,
    })
}

fn read_json<T: for<'de> Deserialize<'de>>(req: &mut Request) -> Result<T, String> {
    let mut raw = String::new();
    req.as_reader().take(MAX_BODY + 1).read_to_string(&mut raw).map_err(|_| "unreadable body".to_string())?;
    if raw.len() as u64 > MAX_BODY {
        return Err("body too large".into());
    }
    serde_json::from_str(&raw).map_err(|e| format!("invalid request: {e}"))
}

fn refused(job_id: &str, error: &str) -> Value {
    json!({ "protocolVersion": 2, "jobId": job_id, "accepted": false, "error": error })
}

fn valid_job_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn validate(body: &TransformRequest) -> Result<(PathBuf, PathBuf, String), String> {
    if body.protocol_version != 2 {
        return Err("unsupported protocolVersion".into());
    }
    if !valid_job_id(&body.job_id) {
        return Err("invalid jobId".into());
    }
    if body.transform != "stem-split" {
        return Err("unsupported transform".into());
    }
    let sha = &body.input.source_sha256;
    if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("invalid sourceSha256".into());
    }
    let input = PathBuf::from(&body.input.audio_path);
    if !input.is_absolute() || !input.is_file() {
        return Err("audioPath must be an existing absolute file".into());
    }
    let staging = PathBuf::from(&body.staging_dir);
    let empty = std::fs::read_dir(&staging).map(|mut d| d.next().is_none()).unwrap_or(false);
    if !staging.is_absolute() || !staging.is_dir() || !empty {
        return Err("stagingDir must be an existing empty absolute directory".into());
    }
    let backend = match body.config.backend.as_deref() {
        None | Some("auto") => if cfg!(feature = "gpu") { "auto" } else { "cpu" },
        Some("cpu") => "cpu",
        Some("gpu") if cfg!(feature = "gpu") => "gpu",
        Some(_) => return Err("unsupported backend".into()),
    };
    Ok((input, staging, backend.to_string()))
}

fn start(body: TransformRequest, cfg: &Arc<Config>, state: &Shared) -> (u16, Value) {
    let (input, staging, backend) = match validate(&body) {
        Ok(v) => v,
        Err(msg) => return (400, refused(&body.job_id, &msg)),
    };
    let mut st = state.lock().expect("state lock");
    if st.child.is_some() || st.jobs.values().any(|j| j.status == "queued" || j.status == "running") {
        return (409, refused(&body.job_id, "busy"));
    }
    if st.jobs.contains_key(&body.job_id) {
        return (409, refused(&body.job_id, "duplicate jobId"));
    }
    st.seq += 1;
    let seq = st.seq;
    st.jobs.insert(body.job_id.clone(), Job { status: "queued", seq, ..Job::default() });
    prune(&mut st);
    drop(st);
    let (id, cfg, state) = (body.job_id.clone(), Arc::clone(cfg), Arc::clone(state));
    std::thread::spawn(move || supervise(&id, &cfg, &state, &input, &staging, &backend));
    (202, json!({ "protocolVersion": 2, "jobId": body.job_id, "accepted": true }))
}

fn prune(st: &mut State) {
    while st.jobs.len() > KEEP_FINISHED {
        let oldest = st
            .jobs
            .iter()
            .filter(|(_, j)| !matches!(j.status, "queued" | "running"))
            .min_by_key(|(_, j)| j.seq)
            .map(|(k, _)| k.clone());
        match oldest {
            Some(k) => st.jobs.remove(&k),
            None => break,
        };
    }
}

fn supervise(id: &str, cfg: &Config, state: &Shared, input: &Path, staging: &Path, backend: &str) {
    let first = if backend == "auto" { "gpu" } else { backend };
    let outcome = run_worker(id, cfg, state, input, staging, first);
    let outcome = match outcome {
        // The GPU never reached separation (no adapter, driver refusal): retry
        // on the CPU inside the same job and say so in the result.
        WorkerOutcome::FailedBeforeSeparation(msg) if backend == "auto" && !is_cancelled(id, state) => {
            clear_dir(staging);
            update(id, state, |j| j.fallback = Some(format!("GPU unavailable, used CPU: {msg}")));
            run_worker(id, cfg, state, input, staging, "cpu")
        }
        other => other,
    };
    let cancelled = is_cancelled(id, state);
    update(id, state, |j| match (&outcome, cancelled) {
        (_, true) => j.status = "cancelled",
        (WorkerOutcome::Done, _) => {
            j.status = "done";
            j.progress = 1.0;
        }
        (WorkerOutcome::Failed(m) | WorkerOutcome::FailedBeforeSeparation(m), _) => {
            j.status = "error";
            j.error = Some(m.clone());
        }
    });
    if !matches!(outcome, WorkerOutcome::Done) {
        clear_dir(staging);
    }
}

enum WorkerOutcome {
    Done,
    Failed(String),
    FailedBeforeSeparation(String),
}

fn run_worker(id: &str, cfg: &Config, state: &Shared, input: &Path, staging: &Path, backend: &str) -> WorkerOutcome {
    let exe = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => return WorkerOutcome::Failed(format!("cannot locate self: {e}")),
    };
    let spawned = Command::new(exe)
        .arg("worker")
        .args(["--model", &cfg.model, "--backend", backend])
        .arg("--weights").arg(&cfg.weights)
        .arg("--input").arg(input)
        .arg("--out").arg(staging)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => return WorkerOutcome::Failed(format!("cannot start worker: {e}")),
    };
    let stdout = child.stdout.take().expect("piped stdout");
    {
        let mut st = state.lock().expect("state lock");
        if st.cancelled.as_deref() == Some(id) {
            let _ = child.kill();
            let _ = child.wait();
            return WorkerOutcome::Failed("cancelled".into());
        }
        st.child = Some((id.to_string(), child));
    }
    update(id, state, |j| {
        j.status = "running";
        j.backend = Some(backend.to_string());
    });
    let (mut separating, mut done, mut last_error) = (false, false, None);
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };
        match ev["event"].as_str().unwrap_or("") {
            "stage" => {
                let stage = ev["stage"].as_str().unwrap_or("").to_string();
                separating |= stage == "separating";
                update(id, state, |j| j.stage = Some(stage));
            }
            "progress" => {
                let f = ev["fraction"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
                update(id, state, |j| j.progress = (f * 0.97).max(j.progress));
            }
            "stem" => update(id, state, |j| j.outputs.push(stem_output(&ev))),
            "done" => {
                done = true;
                update(id, state, |j| j.metrics = Some(metrics(&ev)));
            }
            "error" => last_error = ev["message"].as_str().map(str::to_string),
            _ => {}
        }
    }
    let status = {
        let mut st = state.lock().expect("state lock");
        st.child.take().map(|(_, mut c)| c.wait())
    };
    let ok = matches!(status, Some(Ok(s)) if s.success());
    let msg = last_error.unwrap_or_else(|| "the separation worker stopped unexpectedly".into());
    match (ok && done, separating) {
        (true, _) => WorkerOutcome::Done,
        (false, false) => WorkerOutcome::FailedBeforeSeparation(msg),
        (false, true) => WorkerOutcome::Failed(msg),
    }
}

fn stem_output(ev: &Value) -> Value {
    let role = ev["role"].as_str().unwrap_or("");
    json!({
        "role": format!("stem.{role}"),
        "path": ev["file"],
        "peakDb": ev["peakDb"],
        "rmsDb": ev["rmsDb"],
    })
}

fn metrics(ev: &Value) -> Value {
    json!({
        "sampleRate": ev["sampleRate"], "frames": ev["frames"], "seconds": ev["seconds"],
        "residualDb": ev["residualDb"], "computeMs": ev["computeMs"],
    })
}

fn update(id: &str, state: &Shared, f: impl FnOnce(&mut Job)) {
    if let Some(job) = state.lock().expect("state lock").jobs.get_mut(id) {
        f(job);
    }
}

fn is_cancelled(id: &str, state: &Shared) -> bool {
    state.lock().expect("state lock").cancelled.as_deref() == Some(id)
}

fn clear_dir(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

fn job_status(id: &str, state: &Shared) -> (u16, Value) {
    let st = state.lock().expect("state lock");
    let Some(j) = st.jobs.get(id) else {
        return (404, json!({ "protocolVersion": 2, "jobId": id, "error": "unknown-job" }));
    };
    let mut body = json!({ "protocolVersion": 2, "jobId": id, "status": j.status, "progress": j.progress });
    let obj = body.as_object_mut().expect("object");
    if let Some(s) = &j.stage { obj.insert("stage".into(), json!(s)); }
    if let Some(b) = &j.backend { obj.insert("backend".into(), json!(b)); }
    if let Some(f) = &j.fallback { obj.insert("notice".into(), json!(f)); }
    if j.status == "done" {
        obj.insert("outputs".into(), json!(j.outputs));
        obj.insert("metrics".into(), j.metrics.clone().unwrap_or(Value::Null));
    }
    if let Some(e) = &j.error { obj.insert("error".into(), json!(e)); }
    (200, body)
}

fn cancel(id: &str, state: &Shared) -> (u16, Value) {
    let mut st = state.lock().expect("state lock");
    let Some(job) = st.jobs.get(id) else {
        return (200, json!({ "protocolVersion": 2, "jobId": id, "cancelled": false, "reason": "unknown-job" }));
    };
    if !matches!(job.status, "queued" | "running") {
        return (200, json!({ "protocolVersion": 2, "jobId": id, "cancelled": false, "reason": "already-terminal" }));
    }
    st.cancelled = Some(id.to_string());
    // Kill and reap while holding the lock: when this returns, the worker
    // process is gone and holds no source or staging handle.
    if let Some((cid, child)) = st.child.as_mut() {
        if cid == id {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Some(job) = st.jobs.get_mut(id) {
        job.status = "cancelled";
    }
    (200, json!({ "protocolVersion": 2, "jobId": id, "cancelled": true }))
}
