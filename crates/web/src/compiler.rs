use std::time::Duration;

use anyhow::{bail, Context, Result};
use tokio::fs;
use tokio::process::Command;

pub async fn compile(source: &str, language: &str) -> Result<Vec<u8>> {
    match language {
        "assemblyscript" => compile_assemblyscript(source).await,
        _ => bail!("Unsupported language: {}", language),
    }
}

async fn compile_assemblyscript(source: &str) -> Result<Vec<u8>> {
    let tmp_dir = tempfile::tempdir().context("Failed to create temp directory")?;
    let source_path = tmp_dir.path().join("robot.ts");
    let output_path = tmp_dir.path().join("robot.wasm");

    // Write source to temp file
    fs::write(&source_path, source)
        .await
        .context("Failed to write source file")?;

    // Run AssemblyScript compiler with timeout
    let output = tokio::time::timeout(
        Duration::from_secs(10),
        Command::new("npx")
            .args([
                "--yes",
                "asc",
                source_path.to_str().unwrap(),
                "--outFile",
                output_path.to_str().unwrap(),
                "--optimize",
                "--runtime",
                "stub",
            ])
            .output(),
    )
    .await
    .context("AssemblyScript compilation timed out (10s)")??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        bail!(
            "AssemblyScript compilation failed:\n{}\n{}",
            stderr,
            stdout
        );
    }

    // Read compiled WASM
    let wasm_bytes = fs::read(&output_path)
        .await
        .context("Failed to read compiled WASM")?;

    Ok(wasm_bytes)
}
