// SPDX-FileCopyrightText: 2026 Meiux Meiux LLC
// SPDX-License-Identifier: MIT
//
// iblis-stems: the Iblis stem-split processor sidecar.
//
//   iblis-stems --model <id> --weights <file> --port <n>   (server, spawned by the shell)
//   iblis-stems worker ...                                  (one separation, spawned by the server)
//
// The server reads its session secret from $IBLIS_SESSION, binds 127.0.0.1
// only, and never touches the network: weights are a signed, hash-pinned pack
// asset resolved next to this executable.

mod audio;
mod server;
mod worker;

use anyhow::{bail, Context, Result};
use std::path::PathBuf;

fn main() {
    // Windows' 1 MB main-thread stack is too small for the model graph.
    let code = std::thread::Builder::new()
        .name("iblis-stems".into())
        .stack_size(8 * 1024 * 1024)
        .spawn(entry)
        .expect("spawn main thread")
        .join()
        .unwrap_or(101);
    std::process::exit(code);
}

fn entry() -> i32 {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if argv.first().map(String::as_str) == Some("worker") {
        return match worker::parse_args(&argv[1..]) {
            Ok(args) => worker::run(args),
            Err(e) => {
                worker::emit(serde_json::json!({ "event": "error", "message": format!("{e:#}") }));
                2
            }
        };
    }
    match serve(&argv) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("iblis-stems: {e:#}");
            1
        }
    }
}

fn flag(argv: &[String], name: &str) -> Result<String> {
    let i = argv.iter().position(|a| a == name).with_context(|| format!("{name} is required"))?;
    argv.get(i + 1).cloned().with_context(|| format!("{name} needs a value"))
}

fn stems_for(model: &str) -> Result<Vec<String>> {
    let four = ["vocals", "drums", "bass", "other"];
    let list: Vec<&str> = match model {
        "htdemucs" | "htdemucs_ft" => four.to_vec(),
        "htdemucs_6s" => four.iter().copied().chain(["guitar", "piano"]).collect(),
        other => bail!("unknown model {other}"),
    };
    Ok(list.into_iter().map(String::from).collect())
}

fn serve(argv: &[String]) -> Result<()> {
    let port: u16 = flag(argv, "--port")?.parse().context("--port must be 1-65535")?;
    let model = flag(argv, "--model")?;
    let stems = stems_for(&model)?;
    let weights = PathBuf::from(flag(argv, "--weights")?);
    // Relative weights resolve against the executable's own folder, never the
    // working directory, and must stay inside it.
    let base = std::env::current_exe()?.parent().context("exe has no folder")?.to_path_buf();
    if weights.is_absolute() || weights.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        bail!("--weights must be a plain relative path inside the pack");
    }
    let weights = base.join(weights);
    if !weights.is_file() {
        bail!("model weights missing: {}", weights.display());
    }
    let session = std::env::var("IBLIS_SESSION").unwrap_or_default();
    if session.len() < 16 {
        bail!("IBLIS_SESSION is missing or too short");
    }
    server::serve(server::Config { port, session, model, weights, stems })
}
