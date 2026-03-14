# Sandbox Testing Rework — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace matchmaking-based flow with an instant testing sandbox supporting N robots with team-based combat, CodeMirror 6 editor, and built-in bot templates.

**Architecture:** Generalize the engine from 2 fixed robots to N team-based robots. Replace all match lifecycle API endpoints with a single stateless `POST /api/run`. Rewrite the frontend with a new layout: arena (top-left), CodeMirror editor with file tree (bottom-left), controls sidebar (right).

**Tech Stack:** Rust (engine, wasm_runner, axum web server), AssemblyScript (robot scripts), CodeMirror 6 (editor), Pixi.js 8 (rendering), ES modules via CDN import maps.

---

## Chunk 1: Engine — N-Robot Team Support

### Task 1: Add team and name fields to Robot, Bullet, and snapshot structs

**Files:**
- Modify: `crates/engine/src/world.rs`

- [ ] **Step 1: Update Robot struct**

Add `name: String` and `team: u8` fields to `Robot`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Robot {
    pub id: usize,
    pub name: String,
    pub team: u8,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub speed: f64,
    pub energy: f64,
    pub gun_heat: f64,
    pub alive: bool,
}
```

- [ ] **Step 2: Update Bullet struct**

Add `owner_team: u8` to `Bullet`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bullet {
    pub owner_id: usize,
    pub owner_team: u8,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub speed: f64,
    pub power: f64,
}
```

- [ ] **Step 3: Update RobotSnapshot**

Add `name: String` and `team: u8`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RobotSnapshot {
    pub id: usize,
    pub name: String,
    pub team: u8,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
    pub energy: f64,
    pub alive: bool,
}
```

- [ ] **Step 4: Update BulletSnapshot**

Add `owner_id: usize`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulletSnapshot {
    pub owner_id: usize,
    pub x: f64,
    pub y: f64,
    pub heading: f64,
}
```

- [ ] **Step 5: Update GameStatus**

Change `Finished` variant from robot-id to team-based:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum GameStatus {
    Running,
    Finished { winner_team: Option<u8> },
}
```

Remove `WaitingForPlayers` — no longer needed.

- [ ] **Step 6: Add RobotConfig and update GameWorld::new()**

Replace `SPAWN_POSITIONS` constant and `GameWorld::new()` with a configurable constructor:

```rust
#[derive(Debug, Clone)]
pub struct RobotConfig {
    pub name: String,
    pub team: u8,
}

impl GameWorld {
    pub fn new(configs: &[RobotConfig]) -> Self {
        let team0: Vec<usize> = configs.iter().enumerate()
            .filter(|(_, c)| c.team == 0).map(|(i, _)| i).collect();
        let team1: Vec<usize> = configs.iter().enumerate()
            .filter(|(_, c)| c.team != 0).map(|(i, _)| i).collect();

        let robots = configs.iter().enumerate().map(|(id, config)| {
            let (x, y, heading) = if config.team == 0 {
                let idx = team0.iter().position(|&i| i == id).unwrap();
                let y = ARENA_HEIGHT * (idx as f64 + 1.0) / (team0.len() as f64 + 1.0);
                (100.0, y, 0.0)
            } else {
                let idx = team1.iter().position(|&i| i == id).unwrap();
                let y = ARENA_HEIGHT * (idx as f64 + 1.0) / (team1.len() as f64 + 1.0);
                (550.0, y, 180.0)
            };
            Robot {
                id,
                name: config.name.clone(),
                team: config.team,
                x, y, heading,
                speed: 0.0,
                energy: STARTING_ENERGY,
                gun_heat: STARTING_GUN_HEAT,
                alive: true,
            }
        }).collect();

        Self {
            tick: 0,
            arena_width: ARENA_WIDTH,
            arena_height: ARENA_HEIGHT,
            robots,
            bullets: Vec::new(),
            status: GameStatus::Running,
        }
    }
}
```

- [ ] **Step 7: Fix all compilation errors in tick.rs**

Update `capture_snapshot` to include new fields:

```rust
pub fn capture_snapshot(world: &GameWorld, events: Vec<GameEvent>) -> TickSnapshot {
    TickSnapshot {
        tick: world.tick,
        robots: world.robots.iter().map(|r| RobotSnapshot {
            id: r.id,
            name: r.name.clone(),
            team: r.team,
            x: r.x,
            y: r.y,
            heading: r.heading,
            energy: r.energy,
            alive: r.alive,
        }).collect(),
        bullets: world.bullets.iter().map(|b| BulletSnapshot {
            owner_id: b.owner_id,
            x: b.x,
            y: b.y,
            heading: b.heading,
        }).collect(),
        events,
    }
}
```

Update bullet creation in `run_resolution_phase` to include `owner_team`:

```rust
RobotAction::Shoot(power) if !shot && world.robots[i].gun_heat <= 0.0 => {
    let power = power.clamp(1.0, 3.0);
    let robot = &world.robots[i];
    let heading_rad = robot.heading.to_radians();
    world.bullets.push(Bullet {
        owner_id: robot.id,
        owner_team: robot.team,
        x: robot.x + heading_rad.cos() * ROBOT_RADIUS,
        y: robot.y - heading_rad.sin() * ROBOT_RADIUS,
        heading: robot.heading,
        speed: BULLET_SPEED,
        power,
    });
    // ... rest unchanged
}
```

- [ ] **Step 8: Fix compilation errors in collision.rs**

Update `detect_bullet_robot_collisions` to use team-based friendly fire:

```rust
pub fn detect_bullet_robot_collisions(world: &GameWorld) -> Vec<BulletHit> {
    let mut hits = Vec::new();
    for (bi, bullet) in world.bullets.iter().enumerate() {
        for robot in &world.robots {
            if !robot.alive || robot.team == bullet.owner_team {
                continue;
            }
            if distance(bullet.x, bullet.y, robot.x, robot.y) < ROBOT_RADIUS {
                hits.push(BulletHit {
                    bullet_index: bi,
                    robot_id: robot.id,
                    damage: bullet.power * 4.0,
                    power: bullet.power,
                    shooter_id: bullet.owner_id,
                });
            }
        }
    }
    hits
}
```

- [ ] **Step 9: Update compute_scan for team-based targeting**

In `tick.rs`, change `compute_scan` to skip same-team robots:

```rust
pub fn compute_scan(world: &GameWorld, robot_id: usize) -> f64 {
    let robot = &world.robots[robot_id];
    if !robot.alive {
        return -1.0;
    }

    let mut min_dist = f64::MAX;
    let heading_rad = robot.heading.to_radians();

    for other in &world.robots {
        if other.team == robot.team || !other.alive {
            continue;
        }
        // ... rest unchanged
    }

    if min_dist == f64::MAX { -1.0 } else { min_dist }
}
```

- [ ] **Step 10: Update check_win for team-based winning**

```rust
pub fn check_win(world: &mut GameWorld) {
    // Collect alive teams
    let mut alive_teams: Vec<u8> = world.robots.iter()
        .filter(|r| r.alive)
        .map(|r| r.team)
        .collect();
    alive_teams.sort_unstable();
    alive_teams.dedup();

    if alive_teams.len() <= 1 {
        world.status = GameStatus::Finished {
            winner_team: alive_teams.first().copied(),
        };
    } else if world.tick >= MAX_TICKS {
        // Team with highest total energy wins
        use std::collections::HashMap;
        let mut team_energy: HashMap<u8, f64> = HashMap::new();
        for r in world.robots.iter().filter(|r| r.alive) {
            *team_energy.entry(r.team).or_default() += r.energy;
        }
        let winner_team = team_energy.into_iter()
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
            .map(|(team, _)| team);
        world.status = GameStatus::Finished { winner_team };
    }
}
```

- [ ] **Step 11: Fix existing engine tests**

All tests use `GameWorld::new()` which now requires configs. Create a helper:

```rust
#[cfg(test)]
fn test_world_2v2() -> GameWorld {
    GameWorld::new(&[
        RobotConfig { name: "bot-0".to_string(), team: 0 },
        RobotConfig { name: "bot-1".to_string(), team: 1 },
    ])
}
```

Replace all `GameWorld::new()` calls in tests with `test_world_2v2()`.

Update `test_win_condition_last_alive` to check for `winner_team`:

```rust
assert_eq!(
    world.status,
    GameStatus::Finished { winner_team: Some(0) }
);
```

Update `test_bullet_doesnt_hit_owner` — now uses team-based check, so a bullet from team 0 won't hit team 0 robots. The existing test still works since the bullet owner is robot 0 (team 0) and robot 0 is also team 0.

Update any `Bullet` construction in tests to include `owner_team: 0`.

- [ ] **Step 12: Run engine tests and verify they pass**

Run: `cargo test -p engine`
Expected: All tests pass.

- [ ] **Step 13: Commit engine changes**

```bash
git add crates/engine/
git commit -m "feat(engine): generalize to N robots with team-based combat"
```

### Task 2: Add log capture to wasm_runner

**Files:**
- Modify: `crates/wasm_runner/src/linker.rs`
- Modify: `crates/wasm_runner/src/runner.rs`

- [ ] **Step 1: Add log storage to RobotState**

In `linker.rs`, add `logs: Vec<String>` to `RobotState`:

```rust
pub struct RobotState {
    pub robot_id: usize,
    pub actions: Vec<RobotAction>,
    pub scan_result: f64,
    pub logs: Vec<String>,
}

impl RobotState {
    pub fn new(robot_id: usize) -> Self {
        Self {
            robot_id,
            actions: Vec::new(),
            scan_result: -1.0,
            logs: Vec::new(),
        }
    }

    pub fn clear_actions(&mut self) {
        self.actions.clear();
    }
}
```

- [ ] **Step 2: Update log host functions to capture output**

```rust
linker.func_wrap("env", "log_i32", |mut caller: Caller<'_, RobotState>, val: i32| {
    caller.data_mut().logs.push(format!("i32: {}", val));
})?;

linker.func_wrap("env", "log_f64", |mut caller: Caller<'_, RobotState>, val: f64| {
    caller.data_mut().logs.push(format!("f64: {}", val));
})?;
```

- [ ] **Step 3: Add method to retrieve logs from RobotRunner**

In `runner.rs`, add a method to drain logs:

```rust
impl RobotRunner {
    pub fn take_logs(&mut self) -> Vec<String> {
        std::mem::take(&mut self.store.data_mut().logs)
    }
}
```

- [ ] **Step 4: Handle WASM traps gracefully**

In `runner.rs`, update each `call_on_*` method so that non-fuel traps return `Ok(vec![])` instead of `Err` (robot is killed at the caller level, not here). Replace the existing error propagation:

```rust
// In call_on_tick, call_on_hit, call_on_collision:
Err(e) => {
    if e.downcast_ref::<Trap>().map_or(false, |t| *t == Trap::OutOfFuel) {
        // Out of fuel — forfeit turn
    } else {
        // Other trap — log it, robot forfeits turn (caller will kill it)
        self.store.data_mut().logs.push(format!("WASM trap: {}", e));
    }
}
```

Add a public `has_trapped` flag to track if a non-fuel trap occurred, so the caller can kill the robot:

In `linker.rs`, add `pub trapped: bool` to `RobotState` (default `false`).

In `runner.rs`, set it on non-fuel traps:

```rust
} else {
    self.store.data_mut().logs.push(format!("WASM trap: {}", e));
    self.store.data_mut().trapped = true;
}
```

Add a public method:

```rust
pub fn has_trapped(&self) -> bool {
    self.store.data().trapped
}
```

- [ ] **Step 5: Fix wasm_runner integration tests**

Update `crates/wasm_runner/tests/integration.rs`:
- `GameWorld::new()` → use `RobotConfig` vec
- `GameStatus::Finished { winner }` → `GameStatus::Finished { winner_team }`
- Add `owner_team` to any manual `Bullet` construction

- [ ] **Step 6: Run wasm_runner tests**

Run: `cargo test -p wasm_runner`
Expected: All tests pass.

- [ ] **Step 7: Commit wasm_runner changes**

```bash
git add crates/wasm_runner/
git commit -m "feat(wasm_runner): add log capture and graceful trap handling"
```

### Task 3: Replace web API with POST /api/run

**Files:**
- Modify: `crates/web/src/main.rs`
- Modify: `crates/web/src/routes.rs`
- Modify: `crates/web/src/match_runner.rs`
- Modify: `crates/web/src/compiler.rs`
- Delete: `crates/web/src/state.rs`
- Delete: `crates/web/src/ws.rs`
- Modify: `crates/web/Cargo.toml`

- [ ] **Step 1: Simplify compiler.rs**

Remove the `language` parameter, always compile AssemblyScript:

```rust
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
```

- [ ] **Step 2: Rewrite match_runner.rs**

Update `run_match` to accept `RobotConfig` slice, return logs, and use team-based winner:

```rust
use anyhow::{Context, Result};
use engine::tick::*;
use engine::world::*;
use wasm_runner::RobotRunner;

pub struct MatchResult {
    pub replay: Vec<TickSnapshot>,
    pub winner_team: Option<u8>,
    pub total_ticks: u32,
    pub logs: Vec<(String, Vec<String>)>, // (robot_name, messages)
}

pub fn run_match(configs: &[RobotConfig], wasm_modules: &[Vec<u8>]) -> Result<MatchResult> {
    let mut runners: Vec<RobotRunner> = wasm_modules
        .iter()
        .enumerate()
        .map(|(id, bytes)| {
            RobotRunner::new(bytes, id)
                .context(format!("Failed to create runner for robot {}", id))
        })
        .collect::<Result<Vec<_>>>()?;

    let mut world = GameWorld::new(configs);
    let mut replay = Vec::new();

    while world.status == GameStatus::Running && world.tick < MAX_TICKS {
        // Phase 1: Events
        let (tick_events, _) = run_events_phase(&mut world);

        let mut all_actions: Vec<PlayerActions> =
            vec![PlayerActions::default(); world.robots.len()];

        for hit in &tick_events.hits {
            if hit.robot_id < runners.len() && world.robots[hit.robot_id].alive {
                if let Ok(actions) = runners[hit.robot_id].call_on_hit(hit.damage) {
                    all_actions[hit.robot_id].actions.extend(actions);
                }
                // Kill robot if WASM trapped
                if runners[hit.robot_id].has_trapped() {
                    world.robots[hit.robot_id].alive = false;
                    world.robots[hit.robot_id].energy = 0.0;
                }
            }
        }

        for col in &tick_events.collisions {
            if col.robot_id < runners.len() && world.robots[col.robot_id].alive {
                if let Ok(actions) =
                    runners[col.robot_id].call_on_collision(col.kind, col.x, col.y)
                {
                    all_actions[col.robot_id].actions.extend(actions);
                }
                if runners[col.robot_id].has_trapped() {
                    world.robots[col.robot_id].alive = false;
                    world.robots[col.robot_id].energy = 0.0;
                }
            }
        }

        // Phase 2: Decisions
        for (i, robot) in world.robots.iter().enumerate() {
            if !robot.alive || i >= runners.len() {
                continue;
            }
            let scan = compute_scan(&world, i);
            if let Ok(actions) = runners[i].call_on_tick(
                world.tick + 1,
                robot.energy,
                robot.x,
                robot.y,
                robot.heading,
                robot.speed,
                robot.gun_heat,
                scan,
            ) {
                all_actions[i].actions.extend(actions);
            }
            if runners[i].has_trapped() {
                world.robots[i].alive = false;
                world.robots[i].energy = 0.0;
            }
        }

        let snapshot = run_tick(&mut world, &all_actions);
        replay.push(snapshot);
    }

    let winner_team = match world.status {
        GameStatus::Finished { winner_team } => winner_team,
        _ => None,
    };

    let logs: Vec<(String, Vec<String>)> = configs
        .iter()
        .enumerate()
        .map(|(i, config)| (config.name.clone(), runners[i].take_logs()))
        .collect();

    Ok(MatchResult {
        replay,
        winner_team,
        total_ticks: world.tick,
        logs,
    })
}
```

- [ ] **Step 3: Rewrite routes.rs**

Remove all match lifecycle routes. Add `POST /api/run`. Keep the `index()` handler:

```rust
use askama::Template;
use axum::http::StatusCode;
use axum::response::{Html, Json};
use serde::{Deserialize, Serialize};

use engine::world::RobotConfig;

use crate::compiler;
use crate::match_runner;

#[derive(Template)]
#[template(path = "index.html")]
pub struct IndexTemplate;

pub async fn index() -> Html<String> {
    Html(IndexTemplate.render().unwrap())
}

#[derive(Deserialize)]
pub struct RunRequest {
    pub robots: Vec<RobotEntry>,
}

#[derive(Deserialize)]
pub struct RobotEntry {
    pub name: String,
    pub source: String,
    pub team: u8,
}

#[derive(Serialize)]
pub struct RunResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replay: Option<ReplayData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner_team: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_ticks: Option<u32>,
    #[serde(default)]
    pub errors: Vec<RobotError>,
    #[serde(default)]
    pub logs: Vec<RobotLog>,
}

#[derive(Serialize)]
pub struct ReplayData {
    pub arena: ArenaInfo,
    pub robots: Vec<RobotInfo>,
    pub ticks: Vec<engine::world::TickSnapshot>,
}

#[derive(Serialize)]
pub struct ArenaInfo {
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize)]
pub struct RobotInfo {
    pub name: String,
    pub team: u8,
}

#[derive(Serialize)]
pub struct RobotError {
    pub robot: String,
    pub error: String,
}

#[derive(Serialize)]
pub struct RobotLog {
    pub robot: String,
    pub messages: Vec<String>,
}

pub async fn run(Json(req): Json<RunRequest>) -> (StatusCode, Json<RunResponse>) {
    if req.robots.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(RunResponse {
                ok: false,
                replay: None,
                winner_team: None,
                total_ticks: None,
                errors: vec![RobotError {
                    robot: "".to_string(),
                    error: "No robots provided".to_string(),
                }],
                logs: vec![],
            }),
        );
    }

    // Compile all robots concurrently
    let compile_futures: Vec<_> = req
        .robots
        .iter()
        .map(|r| {
            let source = r.source.clone();
            let name = r.name.clone();
            async move { (name, compiler::compile(&source).await) }
        })
        .collect();

    let results = futures::future::join_all(compile_futures).await;

    let mut wasm_modules = Vec::new();
    let mut errors = Vec::new();

    for (name, result) in results {
        match result {
            Ok(bytes) => wasm_modules.push(bytes),
            Err(e) => errors.push(RobotError {
                robot: name,
                error: e.to_string(),
            }),
        }
    }

    if !errors.is_empty() {
        return (
            StatusCode::OK,
            Json(RunResponse {
                ok: false,
                replay: None,
                winner_team: None,
                total_ticks: None,
                errors,
                logs: vec![],
            }),
        );
    }

    // Build configs
    let configs: Vec<RobotConfig> = req
        .robots
        .iter()
        .map(|r| RobotConfig {
            name: r.name.clone(),
            team: r.team,
        })
        .collect();

    // Run simulation (blocking — move to spawn_blocking)
    let result =
        tokio::task::spawn_blocking(move || match_runner::run_match(&configs, &wasm_modules))
            .await;

    match result {
        Ok(Ok(match_result)) => {
            let robots: Vec<RobotInfo> = req
                .robots
                .iter()
                .map(|r| RobotInfo {
                    name: r.name.clone(),
                    team: r.team,
                })
                .collect();

            let logs: Vec<RobotLog> = match_result
                .logs
                .into_iter()
                .filter(|(_, msgs)| !msgs.is_empty())
                .map(|(name, messages)| RobotLog {
                    robot: name,
                    messages,
                })
                .collect();

            (
                StatusCode::OK,
                Json(RunResponse {
                    ok: true,
                    replay: Some(ReplayData {
                        arena: ArenaInfo {
                            width: engine::world::ARENA_WIDTH,
                            height: engine::world::ARENA_HEIGHT,
                        },
                        robots,
                        ticks: match_result.replay,
                    }),
                    winner_team: match_result.winner_team,
                    total_ticks: Some(match_result.total_ticks),
                    errors: vec![],
                    logs,
                }),
            )
        }
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RunResponse {
                ok: false,
                replay: None,
                winner_team: None,
                total_ticks: None,
                errors: vec![RobotError {
                    robot: "".to_string(),
                    error: format!("Simulation error: {}", e),
                }],
                logs: vec![],
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(RunResponse {
                ok: false,
                replay: None,
                winner_team: None,
                total_ticks: None,
                errors: vec![RobotError {
                    robot: "".to_string(),
                    error: format!("Task error: {}", e),
                }],
                logs: vec![],
            }),
        ),
    }
}
```

- [ ] **Step 4: Rewrite main.rs**

Remove state, ws, old routes. Add `futures` dependency:

```rust
mod compiler;
mod match_runner;
mod routes;

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/api/run", post(routes::run))
        .route("/", get(routes::index))
        .nest_service("/static", ServeDir::new("crates/web/static"))
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("Failed to bind to port 3000");

    println!("NetBots server running on http://localhost:3000");

    axum::serve(listener, app).await.expect("Server failed");
}
```

- [ ] **Step 5: Delete state.rs and ws.rs**

```bash
rm crates/web/src/state.rs crates/web/src/ws.rs
```

- [ ] **Step 6: Update web Cargo.toml**

Add `futures` dependency, remove `dashmap` and `uuid` (no longer needed):

```toml
[package]
name = "web"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = { version = "0.8", features = ["ws", "multipart"] }
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tower-http = { version = "0.6", features = ["cors", "fs"] }
futures = "0.3"
engine = { path = "../engine" }
wasm_runner = { path = "../wasm_runner" }
askama = "0.15"
anyhow = "1"
tempfile = "3"
```

- [ ] **Step 7: Build and verify**

Run: `cargo build`
Expected: Compiles without errors.

- [ ] **Step 8: Commit web backend changes**

```bash
git add -A
git commit -m "feat(web): replace match lifecycle with stateless POST /api/run"
```

---

## Chunk 2: Frontend — Layout, Editor, and Bot Templates

### Task 4: Create bot template files

**Files:**
- Create: `crates/web/static/templates/sitter.ts`
- Create: `crates/web/static/templates/spinner.ts`
- Create: `crates/web/static/templates/chaser.ts`
- Create: `crates/web/static/templates/wall-hugger.ts`

- [ ] **Step 1: Create sitter template**

```typescript
// Sitter Bot — does nothing, stays still
// A stationary target for testing your aim and movement

@external("env", "set_speed") declare function set_speed(speed: f64): void;
@external("env", "rotate") declare function rotate(angle: f64): void;
@external("env", "shoot") declare function shoot(power: f64): void;
@external("env", "scan") declare function scan(): f64;
@external("env", "log_i32") declare function log_i32(val: i32): void;
@external("env", "log_f64") declare function log_f64(val: f64): void;

export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  // Do nothing — just sit here
}

export function on_hit(damage: f64): void {
  // Take it
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  // Ignore
}
```

- [ ] **Step 2: Create spinner template**

```typescript
// Spinner Bot — rotates and fires continuously
// Tests your ability to dodge incoming fire

@external("env", "set_speed") declare function set_speed(speed: f64): void;
@external("env", "rotate") declare function rotate(angle: f64): void;
@external("env", "shoot") declare function shoot(power: f64): void;
@external("env", "scan") declare function scan(): f64;
@external("env", "log_i32") declare function log_i32(val: i32): void;
@external("env", "log_f64") declare function log_f64(val: f64): void;

export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  rotate(7.0);
  if (gun_heat == 0.0) {
    shoot(1.5);
  }
}

export function on_hit(damage: f64): void {
  // Keep spinning
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  set_speed(3.0);
}
```

- [ ] **Step 3: Create chaser template**

```typescript
// Chaser Bot — scans, turns toward enemies, and fires
// A competent opponent that actively hunts you

@external("env", "set_speed") declare function set_speed(speed: f64): void;
@external("env", "rotate") declare function rotate(angle: f64): void;
@external("env", "shoot") declare function shoot(power: f64): void;
@external("env", "scan") declare function scan(): f64;
@external("env", "log_i32") declare function log_i32(val: i32): void;
@external("env", "log_f64") declare function log_f64(val: f64): void;

let scanDir: f64 = 5.0;

export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  const dist: f64 = scan();

  if (dist > 0.0) {
    // Enemy in scan arc — fire and advance
    if (gun_heat == 0.0) {
      const power: f64 = dist < 200.0 ? 3.0 : 1.5;
      shoot(power);
    }
    set_speed(6.0);
    // Narrow scan to track target
    scanDir = scanDir > 0.0 ? 2.0 : -2.0;
  } else {
    // No enemy — sweep scan wider
    scanDir = scanDir > 0.0 ? 8.0 : -8.0;
    set_speed(4.0);
  }

  rotate(scanDir);
  scanDir = -scanDir;

  // Wall avoidance
  if (x < 60.0 || x > 740.0 || y < 60.0 || y > 540.0) {
    rotate(10.0);
    set_speed(5.0);
  }
}

export function on_hit(damage: f64): void {
  rotate(45.0);
  set_speed(8.0);
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  rotate(90.0);
  set_speed(6.0);
}
```

- [ ] **Step 4: Create wall-hugger template**

```typescript
// Wall Hugger Bot — drives along the arena walls
// Tests your ability to track a moving target on predictable paths

@external("env", "set_speed") declare function set_speed(speed: f64): void;
@external("env", "rotate") declare function rotate(angle: f64): void;
@external("env", "shoot") declare function shoot(power: f64): void;
@external("env", "scan") declare function scan(): f64;
@external("env", "log_i32") declare function log_i32(val: i32): void;
@external("env", "log_f64") declare function log_f64(val: f64): void;

export function on_tick(
  tick: u32, energy: f64,
  x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64
): void {
  set_speed(6.0);

  // Scan and shoot opportunistically
  const dist: f64 = scan();
  if (dist > 0.0 && gun_heat == 0.0) {
    shoot(2.0);
  }
}

export function on_hit(damage: f64): void {
  set_speed(8.0);
}

export function on_collision(kind: i32, x: f64, y: f64): void {
  // Hit a wall or robot — turn right 90 degrees
  rotate(-90.0);
  set_speed(6.0);
}
```

- [ ] **Step 5: Commit bot templates**

```bash
git add crates/web/static/templates/
git commit -m "feat: add built-in bot templates (sitter, spinner, chaser, wall-hugger)"
```

### Task 5: Rewrite HTML template and CSS

**Files:**
- Modify: `crates/web/templates/index.html`
- Modify: `crates/web/static/style.css`

- [ ] **Step 1: Rewrite index.html**

Replace with new layout. Add CodeMirror 6 import map with pinned versions. Structure: left column (arena + editor), right sidebar (controls).

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NetBots</title>
    <link rel="stylesheet" href="/static/style.css">
    <script type="importmap">
    {
        "imports": {
            "pixi.js": "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.mjs",
            "codemirror": "https://esm.sh/codemirror@6.0.1",
            "@codemirror/lang-javascript": "https://esm.sh/@codemirror/lang-javascript@6.2.3",
            "@codemirror/theme-one-dark": "https://esm.sh/@codemirror/theme-one-dark@6.1.2",
            "@codemirror/state": "https://esm.sh/@codemirror/state@6.5.2",
            "@codemirror/view": "https://esm.sh/@codemirror/view@6.36.5"
        }
    }
    </script>
</head>
<body>
    <div class="app">
        <!-- Left column: arena + editor -->
        <div class="left-column">
            <!-- Arena -->
            <div class="arena-panel" id="arena-panel">
                <div id="arena"></div>
                <div id="arena-overlay" class="arena-overlay">Press Run to start</div>
            </div>

            <!-- Resize handle -->
            <div class="resize-handle" id="resize-handle"></div>

            <!-- Editor panel -->
            <div class="editor-panel" id="editor-panel">
                <!-- Tab bar -->
                <div class="tab-bar">
                    <button class="tab active" data-tab="code">Code</button>
                    <button class="tab" data-tab="logs">Logs</button>
                </div>
                <div class="editor-body">
                    <!-- File tree -->
                    <div class="file-tree" id="file-tree"></div>
                    <!-- Code editor -->
                    <div class="editor-content" id="editor-content">
                        <div id="codemirror-container"></div>
                        <pre id="logs-container" class="hidden"></pre>
                    </div>
                </div>
            </div>
        </div>

        <!-- Right sidebar: controls -->
        <div class="sidebar">
            <div class="sidebar-section">
                <button id="btn-run" class="primary run-btn">Run</button>
                <div class="shortcut-hint">Ctrl+Enter</div>
            </div>

            <div class="sidebar-section">
                <label class="sidebar-label">Add Bot</label>
                <div class="add-bot-row">
                    <select id="template-select">
                        <option value="sitter">Sitter</option>
                        <option value="spinner">Spinner</option>
                        <option value="chaser" selected>Chaser</option>
                        <option value="wall-hugger">Wall Hugger</option>
                    </select>
                    <button id="btn-add-bot">+</button>
                </div>
            </div>

            <div class="sidebar-section">
                <label class="sidebar-label">Replay</label>
                <div class="replay-controls">
                    <div class="replay-buttons">
                        <button id="btn-restart" disabled title="Restart">&#8634;</button>
                        <button id="btn-play-pause" disabled title="Play/Pause">&#9654;</button>
                    </div>
                    <div class="speed-buttons">
                        <button class="speed-btn" data-speed="0.5">0.5x</button>
                        <button class="speed-btn active" data-speed="1">1x</button>
                        <button class="speed-btn" data-speed="2">2x</button>
                        <button class="speed-btn" data-speed="4">4x</button>
                    </div>
                    <input type="range" id="tick-scrubber" min="0" max="0" value="0" disabled>
                    <div id="tick-display" class="tick-display">0 / 0</div>
                </div>
            </div>

            <div class="sidebar-section results" id="results-section" style="display:none;">
                <label class="sidebar-label">Result</label>
                <div id="result-text"></div>
            </div>
        </div>
    </div>

    <script type="module" src="/static/js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Rewrite style.css**

Complete CSS rewrite for the new layout:

```css
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: monospace;
    background: #0a0a1a;
    color: #e0e0e0;
    height: 100vh;
    overflow: hidden;
}

.app {
    display: flex;
    height: 100vh;
}

/* Left column */
.left-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
}

/* Arena */
.arena-panel {
    flex: 1;
    min-height: 200px;
    background: #1a1a2e;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}

#arena {
    display: flex;
    align-items: center;
    justify-content: center;
}

.arena-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #555;
    font-size: 16px;
    pointer-events: none;
}

.arena-overlay.hidden {
    display: none;
}

/* Resize handle */
.resize-handle {
    flex-shrink: 0;
    height: 5px;
    background: #1e1e3e;
    cursor: row-resize;
    border-top: 1px solid #333;
    border-bottom: 1px solid #333;
}

.resize-handle:hover {
    background: #00aa55;
}

/* Editor panel */
.editor-panel {
    flex: 0 0 280px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-top: 1px solid #333;
}

/* Tab bar */
.tab-bar {
    display: flex;
    background: #12122a;
    border-bottom: 1px solid #333;
    flex-shrink: 0;
}

.tab {
    padding: 6px 16px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: #888;
    font-family: monospace;
    font-size: 12px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.tab:hover {
    color: #ccc;
}

.tab.active {
    color: #00ff88;
    border-bottom-color: #00ff88;
}

/* Editor body: file tree + content */
.editor-body {
    flex: 1;
    display: flex;
    overflow: hidden;
}

/* File tree */
.file-tree {
    flex: 0 0 140px;
    background: #0d0d20;
    border-right: 1px solid #333;
    overflow-y: auto;
    padding: 4px 0;
}

.file-item {
    display: flex;
    align-items: center;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
    color: #aaa;
    gap: 4px;
}

.file-item:hover {
    background: #1a1a3a;
}

.file-item.active {
    background: #1e1e3e;
    color: #00ff88;
}

.file-item .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.file-item .file-delete {
    opacity: 0;
    color: #ff4444;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
}

.file-item:hover .file-delete {
    opacity: 0.6;
}

.file-item .file-delete:hover {
    opacity: 1;
}

.file-team-0 .file-name { color: #00ff88; }
.file-team-0.active .file-name { color: #00ff88; }
.file-team-1 .file-name { color: #ff6666; }
.file-team-1.active .file-name { color: #ff6666; }

/* Editor content */
.editor-content {
    flex: 1;
    overflow: hidden;
    position: relative;
}

#codemirror-container {
    height: 100%;
    overflow: auto;
}

#codemirror-container .cm-editor {
    height: 100%;
}

#logs-container {
    height: 100%;
    overflow-y: auto;
    padding: 8px 12px;
    font-size: 12px;
    background: #0d0d20;
    color: #ccc;
    white-space: pre-wrap;
    word-break: break-all;
}

.hidden {
    display: none !important;
}

/* Right sidebar */
.sidebar {
    flex: 0 0 220px;
    background: #12122a;
    border-left: 1px solid #333;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
}

.sidebar-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.sidebar-label {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.shortcut-hint {
    font-size: 10px;
    color: #555;
    text-align: center;
}

/* Buttons */
button {
    background: #1e1e3e;
    color: #e0e0e0;
    border: 1px solid #444;
    padding: 6px 10px;
    font-family: monospace;
    font-size: 13px;
    cursor: pointer;
    border-radius: 4px;
}

button:hover {
    background: #2a2a4e;
    border-color: #00ff88;
}

button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

button:disabled:hover {
    background: #1e1e3e;
    border-color: #444;
}

button.primary {
    background: #00aa55;
    color: #fff;
    border-color: #00ff88;
    font-size: 15px;
    padding: 10px;
}

button.primary:hover {
    background: #00cc66;
}

button.primary:disabled {
    background: #1e1e3e;
    border-color: #444;
    color: #888;
}

.run-btn {
    width: 100%;
}

.run-btn.loading {
    background: #1e1e3e;
    border-color: #444;
    color: #888;
    cursor: wait;
}

/* Add bot row */
.add-bot-row {
    display: flex;
    gap: 4px;
}

.add-bot-row select {
    flex: 1;
    background: #0d0d20;
    color: #e0e0e0;
    border: 1px solid #444;
    padding: 6px 8px;
    font-family: monospace;
    font-size: 12px;
    border-radius: 4px;
}

.add-bot-row button {
    flex: 0 0 32px;
    font-size: 16px;
    padding: 4px;
}

/* Replay controls */
.replay-controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.replay-buttons {
    display: flex;
    gap: 4px;
}

.replay-buttons button {
    flex: 1;
    font-size: 16px;
    padding: 6px;
}

.speed-buttons {
    display: flex;
    gap: 2px;
}

.speed-btn {
    flex: 1;
    font-size: 10px;
    padding: 3px 4px;
    border-radius: 3px;
}

.speed-btn.active {
    background: #00aa55;
    color: #fff;
    border-color: #00ff88;
}

#tick-scrubber {
    width: 100%;
    accent-color: #00ff88;
}

.tick-display {
    font-size: 11px;
    color: #888;
    text-align: center;
}

/* Results */
.results {
    padding-top: 8px;
    border-top: 1px solid #333;
}

#result-text {
    font-size: 13px;
}

.result-win { color: #00ff88; }
.result-lose { color: #ff4444; }
.result-draw { color: #ffaa00; }

/* Log entries in logs tab */
.log-robot-header {
    color: #00ff88;
    margin-top: 8px;
    font-weight: bold;
}

.log-error {
    color: #ff4444;
}
```

- [ ] **Step 3: Commit HTML and CSS**

```bash
git add crates/web/templates/index.html crates/web/static/style.css
git commit -m "feat(frontend): new sandbox layout with arena, editor panel, and sidebar"
```

### Task 6: Rewrite frontend JavaScript

**Files:**
- Rewrite: `crates/web/static/js/main.js`
- Rewrite: `crates/web/static/js/api.js`
- Rewrite: `crates/web/static/js/renderer.js`
- Delete: `crates/web/static/js/ws.js`

- [ ] **Step 1: Rewrite api.js**

Single endpoint:

```javascript
export async function runSimulation(robots) {
    const resp = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ robots }),
    });
    return resp.json();
}
```

- [ ] **Step 2: Rewrite renderer.js for N robots**

Support N robots with team-based coloring, labels, and bullet coloring. Add scrubbing support (render any tick on demand).

```javascript
import { Application, Graphics, Text, TextStyle } from 'pixi.js';

let app = null;
let robotGraphics = [];
let bulletGraphics = [];
let labelTexts = [];

const TEAM_COLORS = [0x00ff88]; // team 0
const ENEMY_PALETTE = [0xff4444, 0xff8800, 0xaa44ff, 0x44ccff, 0xffff44, 0xff44aa];
const ROBOT_SIZE = 18;

function colorForRobot(robotIndex, robotInfos) {
    const info = robotInfos[robotIndex];
    if (!info) return 0xffffff;
    if (info.team === 0) return TEAM_COLORS[0];
    // Assign from enemy palette based on index among team-1 robots
    const enemyIndex = robotInfos
        .slice(0, robotIndex)
        .filter(r => r.team !== 0).length;
    return ENEMY_PALETTE[enemyIndex % ENEMY_PALETTE.length];
}

export async function initArena(container, width, height, robotInfos) {
    destroy();
    app = new Application();
    await app.init({
        width,
        height,
        background: '#1a1a2e',
        antialias: true,
    });
    container.appendChild(app.canvas);

    // Border
    const border = new Graphics();
    border.rect(0, 0, width, height);
    border.stroke({ color: 0x333355, width: 2 });
    app.stage.addChild(border);

    // Create robot graphics
    robotGraphics = [];
    labelTexts = [];
    for (let i = 0; i < robotInfos.length; i++) {
        const color = colorForRobot(i, robotInfos);

        const g = new Graphics();
        // Body circle
        g.circle(0, 0, ROBOT_SIZE);
        g.fill({ color, alpha: 0.3 });
        g.circle(0, 0, ROBOT_SIZE);
        g.stroke({ color, width: 2 });
        // Heading line
        g.moveTo(0, 0);
        g.lineTo(ROBOT_SIZE + 8, 0);
        g.stroke({ color, width: 3 });
        app.stage.addChild(g);
        robotGraphics.push({ graphic: g, color });

        // Label: name + energy
        const style = new TextStyle({
            fontSize: 10,
            fill: color,
            fontFamily: 'monospace',
        });
        const text = new Text({ text: robotInfos[i].name, style });
        text.anchor.set(0.5, 0);
        app.stage.addChild(text);
        labelTexts.push(text);
    }

    return app;
}

export function renderTick(tickData, robotInfos) {
    if (!app) return;

    // Update robots
    tickData.robots.forEach((r, i) => {
        if (i >= robotGraphics.length) return;
        const { graphic } = robotGraphics[i];
        graphic.x = r.x;
        graphic.y = r.y;
        graphic.rotation = -(r.heading * Math.PI) / 180;
        graphic.visible = r.alive;
        graphic.alpha = r.alive ? 1.0 : 0.2;

        // Label
        const label = labelTexts[i];
        label.text = `${robotInfos[i].name} ${Math.round(r.energy)}`;
        label.x = r.x;
        label.y = r.y + ROBOT_SIZE + 4;
        label.visible = r.alive;
    });

    // Clear old bullets
    bulletGraphics.forEach(b => {
        app.stage.removeChild(b);
        b.destroy();
    });
    bulletGraphics = [];

    // Draw bullets colored by owner
    if (tickData.bullets) {
        tickData.bullets.forEach(b => {
            const g = new Graphics();
            const ownerIdx = b.owner_id;
            const color = (ownerIdx < robotGraphics.length)
                ? robotGraphics[ownerIdx].color
                : 0xffff00;
            g.circle(0, 0, 3);
            g.fill(color);
            g.x = b.x;
            g.y = b.y;
            app.stage.addChild(g);
            bulletGraphics.push(g);
        });
    }
}

export function destroy() {
    if (app) {
        app.destroy(true);
        app = null;
        robotGraphics = [];
        bulletGraphics = [];
        labelTexts = [];
    }
}
```

- [ ] **Step 3: Delete ws.js**

```bash
rm crates/web/static/js/ws.js
```

- [ ] **Step 4: Rewrite main.js**

Core orchestration: file management, CodeMirror editor, template loading, run button, replay playback with controls.

```javascript
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { runSimulation } from './api.js';
import { initArena, renderTick, destroy } from './renderer.js';

// --- State ---
const files = new Map(); // filename -> source code
let activeFile = null;
let editor = null; // CodeMirror EditorView
let replayData = null; // { ticks, robotInfos }
let playbackState = { playing: false, index: 0, speed: 1, rafId: null };
const templateCache = new Map();

// --- DOM ---
const arenaContainer = document.getElementById('arena');
const arenaOverlay = document.getElementById('arena-overlay');
const cmContainer = document.getElementById('codemirror-container');
const logsContainer = document.getElementById('logs-container');
const fileTreeEl = document.getElementById('file-tree');
const runBtn = document.getElementById('btn-run');
const addBotBtn = document.getElementById('btn-add-bot');
const templateSelect = document.getElementById('template-select');
const tabBtns = document.querySelectorAll('.tab');
const playPauseBtn = document.getElementById('btn-play-pause');
const restartBtn = document.getElementById('btn-restart');
const scrubber = document.getElementById('tick-scrubber');
const tickDisplay = document.getElementById('tick-display');
const speedBtns = document.querySelectorAll('.speed-btn');
const resultsSection = document.getElementById('results-section');
const resultText = document.getElementById('result-text');
const editorPanel = document.getElementById('editor-panel');

// --- CodeMirror Setup ---
function createEditor() {
    const state = EditorState.create({
        doc: '',
        extensions: [
            basicSetup,
            javascript({ typescript: true }),
            oneDark,
            EditorView.theme({
                '&': { height: '100%' },
                '.cm-scroller': { overflow: 'auto' },
            }),
        ],
    });
    editor = new EditorView({ state, parent: cmContainer });
}

function setEditorContent(text) {
    editor.setState(EditorState.create({
        doc: text,
        extensions: [
            basicSetup,
            javascript({ typescript: true }),
            oneDark,
            EditorView.theme({
                '&': { height: '100%' },
                '.cm-scroller': { overflow: 'auto' },
            }),
        ],
    }));
}

function getEditorContent() {
    return editor.state.doc.toString();
}

// --- File Management ---
function saveCurrentFile() {
    if (activeFile && files.has(activeFile)) {
        files.set(activeFile, getEditorContent());
    }
}

function switchToFile(filename) {
    saveCurrentFile();
    activeFile = filename;
    setEditorContent(files.get(filename) || '');
    renderFileTree();
}

function renderFileTree() {
    fileTreeEl.innerHTML = '';
    for (const [name] of files) {
        const div = document.createElement('div');
        const isPlayer = name === 'my-bot.ts';
        const team = isPlayer ? 0 : 1;
        div.className = `file-item file-team-${team}${name === activeFile ? ' active' : ''}`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.textContent = name;
        div.appendChild(nameSpan);

        if (!isPlayer) {
            const del = document.createElement('span');
            del.className = 'file-delete';
            del.textContent = '\u00d7';
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                files.delete(name);
                if (activeFile === name) {
                    switchToFile('my-bot.ts');
                } else {
                    renderFileTree();
                }
            });
            div.appendChild(del);
        }

        div.addEventListener('click', () => switchToFile(name));
        fileTreeEl.appendChild(div);
    }
}

// --- Templates ---
async function loadTemplate(name) {
    if (templateCache.has(name)) return templateCache.get(name);
    try {
        const resp = await fetch(`/static/templates/${name}.ts`);
        const text = await resp.text();
        templateCache.set(name, text);
        return text;
    } catch {
        return `// Failed to load ${name} template`;
    }
}

async function loadPlayerTemplate() {
    try {
        const resp = await fetch('/static/robot-template.ts');
        return await resp.text();
    } catch {
        return '// Write your robot code here';
    }
}

function nextBotName(templateName) {
    let count = 1;
    while (files.has(`${templateName}-${count}.ts`)) count++;
    return `${templateName}-${count}.ts`;
}

// --- Add Bot ---
addBotBtn.addEventListener('click', async () => {
    const template = templateSelect.value;
    const name = nextBotName(template);
    const source = await loadTemplate(template);
    files.set(name, source);
    switchToFile(name);
});

// --- Tabs ---
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        cmContainer.classList.toggle('hidden', tab !== 'code');
        logsContainer.classList.toggle('hidden', tab !== 'logs');
    });
});

// --- Run ---
async function runGame() {
    saveCurrentFile();
    stopPlayback();

    runBtn.disabled = true;
    runBtn.textContent = 'Running...';
    runBtn.classList.add('loading');
    resultsSection.style.display = 'none';

    const robots = [];
    for (const [name, source] of files) {
        robots.push({
            name: name.replace('.ts', ''),
            source,
            team: name === 'my-bot.ts' ? 0 : 1,
        });
    }

    try {
        const result = await runSimulation(robots);

        // Show logs
        logsContainer.textContent = '';
        if (result.errors && result.errors.length > 0) {
            result.errors.forEach(err => {
                const header = document.createElement('div');
                header.className = 'log-error';
                header.textContent = `[${err.robot || 'error'}] ${err.error}`;
                logsContainer.appendChild(header);
            });
            // Switch to logs tab
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelector('[data-tab="logs"]').classList.add('active');
            cmContainer.classList.add('hidden');
            logsContainer.classList.remove('hidden');
        }

        if (result.logs) {
            result.logs.forEach(log => {
                if (log.messages.length > 0) {
                    const header = document.createElement('div');
                    header.className = 'log-robot-header';
                    header.textContent = `[${log.robot}]`;
                    logsContainer.appendChild(header);
                    log.messages.forEach(msg => {
                        const line = document.createElement('div');
                        line.textContent = `  ${msg}`;
                        logsContainer.appendChild(line);
                    });
                }
            });
        }

        if (!result.ok) {
            runBtn.disabled = false;
            runBtn.textContent = 'Run';
            runBtn.classList.remove('loading');
            return;
        }

        // Setup replay
        const replay = result.replay;
        const robotInfos = replay.robots;
        replayData = { ticks: replay.ticks, robotInfos };

        // Init arena
        destroy();
        arenaContainer.innerHTML = '';
        arenaOverlay.classList.add('hidden');
        await initArena(arenaContainer, replay.arena.width, replay.arena.height, robotInfos);

        // Setup scrubber
        scrubber.max = replay.ticks.length - 1;
        scrubber.value = 0;
        scrubber.disabled = false;
        playPauseBtn.disabled = false;
        restartBtn.disabled = false;

        // Show result
        resultsSection.style.display = '';
        if (result.winner_team === 0) {
            resultText.className = 'result-win';
            resultText.textContent = `You win! (${result.total_ticks} ticks)`;
        } else if (result.winner_team != null) {
            resultText.className = 'result-lose';
            resultText.textContent = `You lose. (${result.total_ticks} ticks)`;
        } else {
            resultText.className = 'result-draw';
            resultText.textContent = `Draw. (${result.total_ticks} ticks)`;
        }

        // Auto-play
        startPlayback();
    } catch (e) {
        logsContainer.textContent = `Error: ${e.message}`;
    } finally {
        runBtn.disabled = false;
        runBtn.textContent = 'Run';
        runBtn.classList.remove('loading');
    }
}

runBtn.addEventListener('click', runGame);

// Ctrl+Enter shortcut
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!runBtn.disabled) runGame();
    }
});

// --- Playback ---
function startPlayback() {
    if (!replayData) return;
    playbackState.playing = true;
    playPauseBtn.innerHTML = '&#10074;&#10074;'; // pause icon
    playbackStep();
}

function stopPlayback() {
    playbackState.playing = false;
    playPauseBtn.innerHTML = '&#9654;'; // play icon
    if (playbackState.rafId) {
        cancelAnimationFrame(playbackState.rafId);
        playbackState.rafId = null;
    }
}

let lastFrameTime = 0;
function playbackStep(timestamp) {
    if (!playbackState.playing || !replayData) return;

    if (!timestamp) {
        lastFrameTime = 0;
        playbackState.rafId = requestAnimationFrame(playbackStep);
        return;
    }

    if (!lastFrameTime) lastFrameTime = timestamp;
    const elapsed = timestamp - lastFrameTime;
    const interval = 1000 / (30 * playbackState.speed);

    if (elapsed >= interval) {
        lastFrameTime = timestamp;
        if (playbackState.index < replayData.ticks.length) {
            renderTick(replayData.ticks[playbackState.index], replayData.robotInfos);
            scrubber.value = playbackState.index;
            tickDisplay.textContent =
                `${playbackState.index + 1} / ${replayData.ticks.length}`;
            playbackState.index++;
        } else {
            stopPlayback();
            return;
        }
    }

    playbackState.rafId = requestAnimationFrame(playbackStep);
}

playPauseBtn.addEventListener('click', () => {
    if (playbackState.playing) {
        stopPlayback();
    } else {
        if (playbackState.index >= replayData.ticks.length) {
            playbackState.index = 0;
        }
        startPlayback();
    }
});

restartBtn.addEventListener('click', () => {
    stopPlayback();
    playbackState.index = 0;
    if (replayData) {
        renderTick(replayData.ticks[0], replayData.robotInfos);
        scrubber.value = 0;
        tickDisplay.textContent = `1 / ${replayData.ticks.length}`;
    }
});

scrubber.addEventListener('input', () => {
    if (!replayData) return;
    stopPlayback();
    const idx = parseInt(scrubber.value);
    playbackState.index = idx;
    renderTick(replayData.ticks[idx], replayData.robotInfos);
    tickDisplay.textContent = `${idx + 1} / ${replayData.ticks.length}`;
});

speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        speedBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        playbackState.speed = parseFloat(btn.dataset.speed);
    });
});

// --- Resize Handle ---
const resizeHandle = document.getElementById('resize-handle');
let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const leftCol = document.querySelector('.left-column');
    const rect = leftCol.getBoundingClientRect();
    const newEditorHeight = rect.bottom - e.clientY;
    const clamped = Math.max(100, Math.min(newEditorHeight, rect.height - 200));
    editorPanel.style.flex = 'none';
    editorPanel.style.height = clamped + 'px';
});

document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
});

// --- Init ---
async function init() {
    createEditor();
    const playerSource = await loadPlayerTemplate();
    files.set('my-bot.ts', playerSource);
    switchToFile('my-bot.ts');
}

init();
```

- [ ] **Step 5: Commit frontend JavaScript**

```bash
git add crates/web/static/js/
git commit -m "feat(frontend): rewrite JS for sandbox mode with CodeMirror, file tree, replay controls"
```

### Task 7: Integration test — build, run, verify

- [ ] **Step 1: Run all tests**

Run: `cargo test`
Expected: All engine and wasm_runner tests pass.

- [ ] **Step 2: Build the project**

Run: `cargo build`
Expected: Compiles without errors.

- [ ] **Step 3: Run cargo clippy**

Run: `cargo clippy`
Expected: No errors (warnings OK for now).

- [ ] **Step 4: Run cargo fmt**

Run: `cargo fmt`

- [ ] **Step 5: Final commit if any formatting changes**

```bash
git add -A
git commit -m "chore: format code"
```
