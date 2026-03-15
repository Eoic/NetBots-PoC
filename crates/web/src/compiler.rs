use anyhow::{Context, Result};
use regex::Regex;
use std::time::Duration;
use tokio::fs;
use tokio::process::Command;

const COMPILATION_TIMEOUT: Duration = Duration::from_secs(10);

fn build_prelude() -> String {
    format!(
        r#"
@external("env", "set_speed") declare function set_speed(speed: f64): void;
@external("env", "rotate") declare function rotate(angle: f64): void;
@external("env", "shoot") declare function shoot(power: f64): void;
@external("env", "scan") declare function scan(): f64;
@external("env", "log_i32") declare function log_i32(val: i32): void;
@external("env", "log_f64") declare function log_f64(val: f64): void;

class WorldContext {{
  arena_width: f64 = {arena_width};
  arena_height: f64 = {arena_height};
  robot_radius: f64 = {robot_radius};
  max_forward_speed: f64 = {max_forward_speed};
  max_backward_speed: f64 = {max_backward_speed};
  max_rotation_per_tick: f64 = {max_rotation_per_tick};
  bullet_speed: f64 = {bullet_speed};
  scan_arc_degrees: f64 = {scan_arc_degrees};
}}

class PlayerContext {{
  tick: u32 = 0;
  energy: f64 = 0.0;
  x: f64 = 0.0;
  y: f64 = 0.0;
  heading: f64 = 0.0;
  speed: f64 = 0.0;
  gun_heat: f64 = 0.0;
  scan: f64 = -1.0;
}}

class UtilityContext {{
  private rng_state: u32 = 0x9E3779B9;

  mix_seed(tick: u32, x: f64, y: f64, heading: f64): void {{
    this.rng_state = this.rng_state ^ tick ^ u32(x * 17.0) ^ u32(y * 23.0) ^ u32(heading * 11.0);
  }}

  rand(): f64 {{
    this.rng_state ^= this.rng_state << 13;
    this.rng_state ^= this.rng_state >> 17;
    this.rng_state ^= this.rng_state << 5;
    return f64(this.rng_state & 0x7FFFFFFF) / f64(0x7FFFFFFF);
  }}

  chance(probability: f64): bool {{
    const p = this.clamp(probability, 0.0, 1.0);
    return this.rand() < p;
  }}

  range(min: f64, max: f64): f64 {{
    if (max <= min) return min;
    return min + this.rand() * (max - min);
  }}

  clamp(value: f64, min: f64, max: f64): f64 {{
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }}

  normalize_angle(delta: f64): f64 {{
    let d: f64 = delta;
    while (d > 180.0) d -= 360.0;
    while (d < -180.0) d += 360.0;
    return d;
  }}

  turn_toward(target_heading: f64, current_heading: f64, max_turn: f64): f64 {{
    const turn_cap = this.clamp(max_turn, 0.0, 180.0);
    const diff = this.normalize_angle(target_heading - current_heading);
    return this.clamp(diff, -turn_cap, turn_cap);
  }}
}}

export const world: WorldContext = new WorldContext();
const player_ctx: PlayerContext = new PlayerContext();
export const util: UtilityContext = new UtilityContext();
export const utils: UtilityContext = util;

export function on_tick(
  tick: u32,
  energy: f64,
  x: f64,
  y: f64,
  heading: f64,
  speed: f64,
  gun_heat: f64
): void {{
  player_ctx.tick = tick;
  player_ctx.energy = energy;
  player_ctx.x = x;
  player_ctx.y = y;
  player_ctx.heading = heading;
  player_ctx.speed = speed;
  player_ctx.gun_heat = gun_heat;
  player_ctx.scan = scan();
  util.mix_seed(tick, x, y, heading);
  __user_on_tick(player_ctx);
}}
"#,
        arena_width = engine::world::ARENA_WIDTH,
        arena_height = engine::world::ARENA_HEIGHT,
        robot_radius = engine::world::ROBOT_RADIUS,
        max_forward_speed = engine::world::MAX_FORWARD_SPEED,
        max_backward_speed = engine::world::MAX_BACKWARD_SPEED,
        max_rotation_per_tick = engine::world::MAX_ROTATION_PER_TICK,
        bullet_speed = engine::world::BULLET_SPEED,
        scan_arc_degrees = engine::world::SCAN_ARC_DEGREES,
    )
}

fn rewrite_source(source: &str) -> Result<String> {
    let on_tick_sig_re = Regex::new(r"export\s+function\s+on_tick\s*\((?P<params>[^)]*)\)")
        .context("Failed to build on_tick signature regex")?;

    let params = on_tick_sig_re
        .captures(source)
        .and_then(|caps| caps.name("params"))
        .map(|m| m.as_str())
        .context("Script must export `on_tick(player: PlayerContext): void`")?;

    if params.contains(',') {
        anyhow::bail!(
            "New API requires `on_tick(player: PlayerContext): void` instead of multiple scalar arguments"
        );
    }

    let on_tick_export_re = Regex::new(r"export\s+function\s+on_tick\s*\(")
        .context("Failed to build on_tick rewrite regex")?;

    Ok(on_tick_export_re
        .replace(source, "export function __user_on_tick(")
        .to_string())
}

pub async fn compile(source: &str) -> Result<Vec<u8>> {
    let tmp_dir = tempfile::tempdir().context("Failed to create temp directory")?;
    let source_path = tmp_dir.path().join("robot.ts");
    let output_path = tmp_dir.path().join("robot.wasm");
    let rewritten_source = rewrite_source(source)?;
    let full_source = format!("{}{}", build_prelude(), rewritten_source);

    fs::write(&source_path, full_source)
        .await
        .context("Failed to write source file")?;

    let output = tokio::time::timeout(
        COMPILATION_TIMEOUT,
        Command::new("npx")
            .args([
                "--yes",
                "asc",
                source_path.to_str().context("Non-UTF8 temp path")?,
                "--outFile",
                output_path.to_str().context("Non-UTF8 temp path")?,
                "--optimize",
                "--runtime",
                "stub",
            ])
            .output(),
    )
    .await
    .context("AssemblyScript compilation timed out")??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        anyhow::bail!("Compilation failed:\n{}\n{}", stderr, stdout);
    }

    fs::read(&output_path)
        .await
        .context("Failed to read compiled WASM")
}
