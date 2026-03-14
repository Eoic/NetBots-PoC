use anyhow::{Context, Result};
use std::time::Duration;
use tokio::fs;
use tokio::process::Command;

pub async fn compile(source: &str) -> Result<Vec<u8>> {
    let tmp_dir = tempfile::tempdir().context("Failed to create temp directory")?;
    let source_path = tmp_dir.path().join("robot.ts");
    let output_path = tmp_dir.path().join("robot.wasm");

    fs::write(&source_path, source).await.context("Failed to write source file")?;

    let output = tokio::time::timeout(
        Duration::from_secs(10),
        Command::new("npx")
            .args([
                "--yes", "asc",
                source_path.to_str().unwrap(),
                "--outFile", output_path.to_str().unwrap(),
                "--optimize", "--runtime", "stub",
            ])
            .output(),
    )
    .await
    .context("AssemblyScript compilation timed out (10s)")??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        anyhow::bail!("Compilation failed:\n{}\n{}", stderr, stdout);
    }

    fs::read(&output_path).await.context("Failed to read compiled WASM")
}
