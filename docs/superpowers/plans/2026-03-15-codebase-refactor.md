# Codebase Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce complexity by splitting long files, extracting named constants, removing inline comments, and deduplicating code patterns across the Rust backend and TypeScript frontend.

**Architecture:** Pure structural refactor — no behavioral changes. New files are extracted from existing ones along responsibility boundaries. Constants are promoted from magic numbers to named values. Duplicated code is consolidated into shared helpers.

**Tech Stack:** Rust (Cargo workspace), TypeScript (Vite/esbuild), Pixi.js

---

## Chunk 1: Engine Crate

### Task 1: Add game constants to `world.rs`

**Files:**
- Modify: `crates/engine/src/world.rs`

- [ ] **Step 1: Add constants and remove inline comments**

After line 17 (`pub const MAX_TEAMS: u8 = 16;`), add:

```rust
pub const HIT_REWARD_MULTIPLIER: f64 = 2.0;
pub const ROBOT_COLLISION_DAMAGE: f64 = 1.0;
pub const COLLISION_SEPARATION_BUFFER: f64 = 0.5;
pub const MIN_BULLET_POWER: f64 = 1.0;
pub const MAX_BULLET_POWER: f64 = 3.0;
pub const GUN_HEAT_BASE: f64 = 1.0;
pub const GUN_HEAT_POWER_DIVISOR: f64 = 5.0;
pub const BULLET_DAMAGE_MULTIPLIER: f64 = 4.0;
```

Remove the `// Game configuration constants` comment on line 4.

Remove these `//` comments from the test module:
- Line 225: `// Teams are assigned columns in first-seen order.`

- [ ] **Step 2: Run tests**

Run: `cargo test -p engine`
Expected: all tests pass (no behavioral change).

- [ ] **Step 3: Commit**

```bash
git add crates/engine/src/world.rs
git commit -m "refactor(engine): add named game constants to world.rs"
```

---

### Task 2: Extract `scan.rs` from `tick.rs`

**Files:**
- Create: `crates/engine/src/scan.rs`
- Modify: `crates/engine/src/tick.rs`
- Modify: `crates/engine/src/lib.rs`

- [ ] **Step 1: Create `scan.rs`**

Create `crates/engine/src/scan.rs` with the `compute_scan` function moved from `tick.rs` (lines 300-338) and a new `normalize_angle` helper extracted from the inline while loop (tick.rs lines 317-323):

```rust
use crate::world::*;

pub fn normalize_angle(angle: f64) -> f64 {
    let mut a = angle;
    while a > 180.0 {
        a -= 360.0;
    }
    while a < -180.0 {
        a += 360.0;
    }
    a
}

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
        let dx = other.x - robot.x;
        let dy = -(other.y - robot.y);
        let angle_to = dy.atan2(dx);
        let angle_diff = normalize_angle((heading_rad - angle_to).to_degrees());

        if angle_diff.abs() <= SCAN_ARC_DEGREES {
            let dist = (dx * dx + dy * dy).sqrt();
            if dist < min_dist {
                min_dist = dist;
            }
        }
    }

    if min_dist == f64::MAX {
        -1.0
    } else {
        min_dist
    }
}
```

- [ ] **Step 2: Remove `compute_scan` from `tick.rs`**

Delete the entire `compute_scan` function (lines 299-338) from `tick.rs`.

- [ ] **Step 3: Update `lib.rs`**

Replace the contents of `crates/engine/src/lib.rs` with:

```rust
pub mod collision;
pub mod scan;
pub mod tick;
pub mod world;

pub use scan::*;
pub use tick::*;
pub use world::*;
```

- [ ] **Step 4: Run tests**

Run: `cargo test -p engine`
Expected: all tests pass. The scan tests in `tick.rs` still work because `lib.rs` re-exports `compute_scan` via `pub use scan::*`.

- [ ] **Step 5: Commit**

```bash
git add crates/engine/src/scan.rs crates/engine/src/tick.rs crates/engine/src/lib.rs
git commit -m "refactor(engine): extract scan.rs from tick.rs"
```

---

### Task 3: Split `run_events_phase` and apply constants in `tick.rs`

**Files:**
- Modify: `crates/engine/src/tick.rs`

- [ ] **Step 1: Split `run_events_phase` into three private functions**

Replace the `run_events_phase` function (lines 28-133) with:

```rust
pub fn run_events_phase(world: &mut GameWorld) -> (TickEvents, Vec<GameEvent>) {
    let mut tick_events = TickEvents::default();
    let mut game_events = Vec::new();

    process_bullet_hits(world, &mut tick_events, &mut game_events);
    process_wall_collisions(world, &mut tick_events, &mut game_events);
    process_robot_collisions(world, &mut tick_events, &mut game_events);

    (tick_events, game_events)
}

fn process_bullet_hits(
    world: &mut GameWorld,
    tick_events: &mut TickEvents,
    game_events: &mut Vec<GameEvent>,
) {
    let bullet_hits = detect_bullet_robot_collisions(world);
    let mut bullets_to_remove: Vec<usize> = bullet_hits.iter().map(|h| h.bullet_index).collect();
    bullets_to_remove.sort_unstable();
    bullets_to_remove.dedup();

    for hit in &bullet_hits {
        if let Some(robot) = world.robots.iter_mut().find(|r| r.id == hit.robot_id) {
            robot.energy -= hit.damage;
            if robot.energy <= 0.0 {
                robot.alive = false;
                game_events.push(GameEvent::RobotDied { robot_id: robot.id });
            }
        }
        if let Some(shooter) = world.robots.iter_mut().find(|r| r.id == hit.shooter_id) {
            shooter.energy += hit.power * HIT_REWARD_MULTIPLIER;
        }

        tick_events.hits.push(HitEvent {
            robot_id: hit.robot_id,
            damage: hit.damage,
        });
        game_events.push(GameEvent::Hit {
            robot_id: hit.robot_id,
            damage: hit.damage,
        });
    }

    for &bi in bullets_to_remove.iter().rev() {
        if bi < world.bullets.len() {
            world.bullets.remove(bi);
        }
    }
}

fn process_wall_collisions(
    world: &mut GameWorld,
    tick_events: &mut TickEvents,
    game_events: &mut Vec<GameEvent>,
) {
    let wall_collisions = detect_robot_wall_collisions(world);

    for wc in &wall_collisions {
        tick_events.collisions.push(CollisionEvent {
            robot_id: wc.robot_id,
            kind: 0,
            x: wc.x,
            y: wc.y,
        });
        game_events.push(GameEvent::Collision {
            robot_id: wc.robot_id,
            kind: "wall".to_string(),
        });
    }
}

fn process_robot_collisions(
    world: &mut GameWorld,
    tick_events: &mut TickEvents,
    game_events: &mut Vec<GameEvent>,
) {
    let robot_collisions = detect_robot_robot_collisions(world);
    for rc in &robot_collisions {
        for &rid in &[rc.robot_a, rc.robot_b] {
            if let Some(robot) = world.robots.iter_mut().find(|r| r.id == rid) {
                robot.energy -= ROBOT_COLLISION_DAMAGE;
                if robot.energy <= 0.0 {
                    robot.alive = false;
                    game_events.push(GameEvent::RobotDied { robot_id: rid });
                }
            }

            tick_events.collisions.push(CollisionEvent {
                robot_id: rid,
                kind: 1,
                x: rc.x,
                y: rc.y,
            });

            game_events.push(GameEvent::Collision {
                robot_id: rid,
                kind: "robot".to_string(),
            });
        }

        let (ax, ay) = {
            let a = &world.robots[rc.robot_a];
            (a.x, a.y)
        };

        let (bx, by) = {
            let b = &world.robots[rc.robot_b];
            (b.x, b.y)
        };

        let dx = bx - ax;
        let dy = by - ay;
        let dist = (dx * dx + dy * dy).sqrt().max(0.01);
        let overlap = ROBOT_RADIUS * 2.0 - dist;

        if overlap > 0.0 {
            let push = overlap / 2.0 + COLLISION_SEPARATION_BUFFER;
            let nx = dx / dist;
            let ny = dy / dist;
            world.robots[rc.robot_a].x -= nx * push;
            world.robots[rc.robot_a].y -= ny * push;
            world.robots[rc.robot_b].x += nx * push;
            world.robots[rc.robot_b].y += ny * push;
        }
    }
}
```

- [ ] **Step 2: Apply constants in `run_resolution_phase`**

In `run_resolution_phase`, replace magic numbers:

- Line 166: `let power = power.clamp(1.0, 3.0);` → `let power = power.clamp(MIN_BULLET_POWER, MAX_BULLET_POWER);`
- Line 178: `world.robots[i].gun_heat = 1.0 + power / 5.0;` → `world.robots[i].gun_heat = GUN_HEAT_BASE + power / GUN_HEAT_POWER_DIVISOR;`

- [ ] **Step 3: Remove all `//` inline comments from `tick.rs`**

Remove every `//` comment line in `tick.rs`. Keep all `///` doc comments. Line numbers below reference the original file before Task 2 changes — use the comment text to locate them:
- Line 32: `// Bullet-robot collisions`
- Line 46: `// Shooter gains energy`
- Line 192: `// Move robots`
- Line 199: `// Y-down screen coords` (after `robot.y -= ...`)
- Line 201: `// Clamp to arena`
- Line 209: `// Cool gun`
- Line 213: `// Move bullets`
- Line 220: `// Remove out-of-bounds bullets`
- Line 274: `// Sum energy per team, highest total wins`
- Line 317: `// Normalize to [-180, 180]`
- Lines 346-349: `// Phase 1: Events ...`
- Line 351: `// Phase 3: Resolution`
- Line 354: `// Phase 4: Physics`
- Line 357: `// Phase 5: Capture`
- Line 360: `// Phase 6: Win check`
- Line 399: `// Robot 0 heading is 0° (right), so x should increase`
- Line 420: `// Cool the gun`
- Line 482: `// gun_heat starts at 1.0`
- Line 492: `// Can't shoot, gun is hot`
- Line 581: `// Robot 0 and Robot 1 are placed in separate team columns, directly ahead.`

- [ ] **Step 4: Run tests**

Run: `cargo test -p engine`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/engine/src/tick.rs
git commit -m "refactor(engine): split run_events_phase, apply named constants"
```

---

### Task 4: Apply `BULLET_DAMAGE_MULTIPLIER` in `collision.rs`

**Files:**
- Modify: `crates/engine/src/collision.rs`

- [ ] **Step 1: Replace magic number and remove comments**

In `collision.rs` line 42, replace:
```rust
damage: bullet.power * 4.0,
```
with:
```rust
damage: bullet.power * BULLET_DAMAGE_MULTIPLIER,
```

Remove these `//` comments:
- Line 105: `// Robot 1 is at x=550 for team 1`

- [ ] **Step 2: Run tests**

Run: `cargo test -p engine`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add crates/engine/src/collision.rs
git commit -m "refactor(engine): use BULLET_DAMAGE_MULTIPLIER constant"
```

---

## Chunk 2: WASM Runner Crate

### Task 5: Deduplicate trap handling in `runner.rs`

**Files:**
- Modify: `crates/wasm_runner/src/runner.rs`

- [ ] **Step 1: Add `handle_call_result` method**

Add a private method to `RobotRunner` impl block, after `refuel`:

```rust
fn handle_call_result(&mut self, context: &str, result: anyhow::Result<()>) {
    if let Err(e) = result {
        if e.downcast_ref::<Trap>()
            .is_some_and(|t| *t == Trap::OutOfFuel)
        {
            eprintln!(
                "[robot {}] out of fuel on {}",
                self.store.data().robot_id,
                context
            );
        } else {
            self.store
                .data_mut()
                .logs
                .push(format!("WASM trap: {}", e));
            self.store.data_mut().trapped = true;
        }
    }
}
```

- [ ] **Step 2: Simplify `call_on_tick`**

Replace the match block (lines 79-100) with:

```rust
let result = on_tick.call(
    &mut self.store,
    (tick, energy, x, y, heading, speed, gun_heat),
);
self.handle_call_result(&format!("tick {}", tick), result);
```

- [ ] **Step 3: Simplify `call_on_hit`**

Replace the match block (lines 116-132) with:

```rust
let result = on_hit.call(&mut self.store, (damage,));
self.handle_call_result("on_hit", result);
```

- [ ] **Step 4: Simplify `call_on_collision`**

Replace the match block (lines 148-164) with:

```rust
let result = on_collision.call(&mut self.store, (kind, x, y));
self.handle_call_result("on_collision", result);
```

- [ ] **Step 5: Remove all `//` inline comments from `runner.rs`**

Remove:
- Line 50: `// Drain remaining fuel and set fresh amount`
- Line 85: `// If fuel exhausted, robot forfeits turn but doesn't crash`
- Line 95: `// Non-fuel trap — log it, set trapped flag (caller will kill robot)`
- Line 127: `// Non-fuel trap — log it, set trapped flag (caller will kill robot)`
- Line 159: `// Non-fuel trap — log it, set trapped flag (caller will kill robot)`

(Some of these will already be gone after the refactor in steps 2-4.)

- [ ] **Step 6: Clean up `linker.rs` and `sandbox.rs` comments**

In `linker.rs`, remove:
- Lines 76-77: `// AssemblyScript may emit calls/imports to...`

In `sandbox.rs`, remove:
- Line 7: `// \`on_tick\` is required. Event handlers are optional and checked dynamically.`

- [ ] **Step 7: Run tests**

Run: `cargo test -p wasm_runner`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add crates/wasm_runner/src/runner.rs crates/wasm_runner/src/linker.rs crates/wasm_runner/src/sandbox.rs
git commit -m "refactor(wasm_runner): deduplicate trap handling, clean comments"
```

---

## Chunk 3: Web Crate (Rust)

### Task 6: Extract `validation.rs` from `routes.rs`

**Files:**
- Create: `crates/web/src/validation.rs`
- Modify: `crates/web/src/routes.rs`
- Modify: `crates/web/src/main.rs`

- [ ] **Step 1: Create `validation.rs`**

Create `crates/web/src/validation.rs`:

```rust
use axum::http::StatusCode;
use axum::response::Json;
use std::collections::HashSet;

use crate::routes::{RunRequest, RunResponse, RobotError, error_response};

const MAX_ROBOTS: usize = 16;
const MAX_SOURCE_BYTES: usize = 64 * 1024;
const MAX_ALLOWED_TICKS: u32 = 100_000;

pub struct ValidatedRobot {
    pub name: String,
    pub source: String,
    pub team: u8,
    pub spawn: Option<engine::world::SpawnPoint>,
}

pub struct ValidatedRequest {
    pub robots: Vec<ValidatedRobot>,
    pub max_ticks: u32,
}

pub fn validate_run_request(
    req: &RunRequest,
) -> Result<ValidatedRequest, (StatusCode, Json<RunResponse>)> {
    if req.robots.is_empty() {
        return Err(error_response(StatusCode::BAD_REQUEST, "No robots provided"));
    }

    if req.robots.len() > MAX_ROBOTS {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("Too many robots (max {})", MAX_ROBOTS),
        ));
    }

    let mut teams_in_match: HashSet<u8> = HashSet::new();

    for entry in &req.robots {
        if entry.team >= engine::world::MAX_TEAMS {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                &format!(
                    "Team id for '{}' must be in range 0..{}",
                    entry.name,
                    engine::world::MAX_TEAMS - 1
                ),
            ));
        }

        teams_in_match.insert(entry.team);

        if entry.source.len() > MAX_SOURCE_BYTES {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                &format!(
                    "Source for '{}' exceeds {} KB limit",
                    entry.name,
                    MAX_SOURCE_BYTES / 1024
                ),
            ));
        }

        if let Some(spawn) = &entry.spawn {
            validate_spawn_point(&entry.name, spawn)?;
        }
    }

    if teams_in_match.len() > engine::world::MAX_TEAMS as usize {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!(
                "Too many teams in a single match (max {})",
                engine::world::MAX_TEAMS
            ),
        ));
    }

    let max_ticks = req.max_ticks.unwrap_or(engine::world::MAX_TICKS);

    if max_ticks == 0 {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "max_ticks must be at least 1",
        ));
    }

    if max_ticks > MAX_ALLOWED_TICKS {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("max_ticks exceeds limit ({})", MAX_ALLOWED_TICKS),
        ));
    }

    let robots = req
        .robots
        .iter()
        .map(|entry| ValidatedRobot {
            name: entry.name.clone(),
            source: entry.source.clone(),
            team: entry.team,
            spawn: entry.spawn.as_ref().map(|s| engine::world::SpawnPoint {
                x: s.x,
                y: s.y,
                heading: s.heading,
            }),
        })
        .collect();

    Ok(ValidatedRequest { robots, max_ticks })
}

fn validate_spawn_point(
    robot_name: &str,
    spawn: &crate::routes::SpawnPointRequest,
) -> Result<(), (StatusCode, Json<RunResponse>)> {
    if !spawn.x.is_finite() || !spawn.y.is_finite() {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("Spawn for '{}' must be finite coordinates", robot_name),
        ));
    }

    if spawn.x < engine::world::ROBOT_RADIUS
        || spawn.x > engine::world::ARENA_WIDTH - engine::world::ROBOT_RADIUS
        || spawn.y < engine::world::ROBOT_RADIUS
        || spawn.y > engine::world::ARENA_HEIGHT - engine::world::ROBOT_RADIUS
    {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            &format!("Spawn for '{}' is outside arena bounds", robot_name),
        ));
    }

    if let Some(heading) = spawn.heading {
        if !heading.is_finite() {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                &format!("Spawn heading for '{}' must be finite", robot_name),
            ));
        }
    }

    Ok(())
}
```

- [ ] **Step 2: Update `routes.rs`**

Make `error_response` pub (add `pub` to `fn error_response`). Make `RunRequest`, `RobotEntry`, `SpawnPointRequest`, `RunResponse`, `RobotError` types pub if not already.

Remove the three constants `MAX_ROBOTS`, `MAX_SOURCE_BYTES`, `MAX_ALLOWED_TICKS` from `routes.rs`.

Remove the `use std::collections::HashSet;` import from `routes.rs`.

Replace the validation block in `run()` (lines 114-203) and the config-building block (lines 243-255) with:

```rust
pub async fn run(Json(req): Json<RunRequest>) -> (StatusCode, Json<RunResponse>) {
    let validated = match crate::validation::validate_run_request(&req) {
        Ok(v) => v,
        Err(err) => return err,
    };

    let compile_futures: Vec<_> = validated
        .robots
        .iter()
        .map(|robot| {
            let source = robot.source.clone();
            let name = robot.name.clone();
            async move { (name, compiler::compile(&source).await) }
        })
        .collect();

    let results = futures::future::join_all(compile_futures).await;
    let mut wasm_modules = Vec::new();
    let mut errors = Vec::new();

    for (name, result) in results {
        match result {
            Ok(bytes) => wasm_modules.push(bytes),
            Err(error) => errors.push(RobotError {
                robot: name,
                error: format!("{:#}", error),
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

    let configs: Vec<engine::world::RobotConfig> = validated
        .robots
        .iter()
        .map(|robot| engine::world::RobotConfig {
            name: robot.name.clone(),
            team: robot.team,
            spawn: robot.spawn.clone(),
        })
        .collect();

    let max_ticks = validated.max_ticks;

    let result = tokio::task::spawn_blocking(move || {
        match_runner::run_match(&configs, &wasm_modules, max_ticks)
    })
    .await;

    match result {
        Ok(Ok(match_result)) => {
            let robots: Vec<RobotInfo> = validated
                .robots
                .iter()
                .map(|robot| RobotInfo {
                    name: robot.name.clone(),
                    team: robot.team,
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
        Ok(Err(error)) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Simulation error: {:#}", error),
        ),
        Err(error) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Task error: {}", error),
        ),
    }
}
```

- [ ] **Step 3: Add module to `main.rs`**

Add `mod validation;` after the existing mod declarations in `crates/web/src/main.rs`.

- [ ] **Step 4: Build check**

Run: `cargo build -p web`
Expected: compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add crates/web/src/validation.rs crates/web/src/routes.rs crates/web/src/main.rs
git commit -m "refactor(web): extract validation.rs from routes.rs"
```

---

### Task 7: Clean up `compiler.rs` and `match_runner.rs`

**Files:**
- Modify: `crates/web/src/compiler.rs`
- Modify: `crates/web/src/match_runner.rs`

- [ ] **Step 1: Add timeout constant in `compiler.rs`**

At the top of `compiler.rs`, after the imports, add:

```rust
const COMPILATION_TIMEOUT: Duration = Duration::from_secs(10);
```

Replace `Duration::from_secs(10)` on line 155 with `COMPILATION_TIMEOUT`.

Replace the timeout error message `"AssemblyScript compilation timed out (10s)"` with `"AssemblyScript compilation timed out"`.

- [ ] **Step 2: Extract `kill_robot` helper in `match_runner.rs`**

Add a private helper at the bottom of `match_runner.rs` (before the closing of the file):

```rust
fn kill_robot(robot: &mut engine::world::Robot) {
    robot.alive = false;
    robot.energy = 0.0;
}
```

Replace the three occurrences of the death pattern in `run_match`:

Line 59-60:
```rust
world.robots[hit.robot_id].alive = false;
world.robots[hit.robot_id].energy = 0.0;
```
→ `kill_robot(&mut world.robots[hit.robot_id]);`

Line 71-72:
```rust
world.robots[col.robot_id].alive = false;
world.robots[col.robot_id].energy = 0.0;
```
→ `kill_robot(&mut world.robots[col.robot_id]);`

Line 100-101:
```rust
world.robots[i].alive = false;
world.robots[i].energy = 0.0;
```
→ `kill_robot(&mut world.robots[i]);`

- [ ] **Step 3: Build check**

Run: `cargo build -p web`
Expected: compiles with no errors.

- [ ] **Step 4: Commit**

```bash
git add crates/web/src/compiler.rs crates/web/src/match_runner.rs
git commit -m "refactor(web): add COMPILATION_TIMEOUT, extract kill_robot helper"
```

---

## Chunk 4: Frontend TypeScript

### Task 8: Extract `placement.ts` from `app.ts`

**Files:**
- Create: `crates/web/assets/ts/placement.ts`
- Modify: `crates/web/assets/ts/app.ts`

- [ ] **Step 1: Export `DomElements` type from `dom.ts`**

Add at the end of `crates/web/assets/ts/dom.ts`:
```typescript
export type DomElements = typeof dom;
```

- [ ] **Step 2: Create `placement.ts`**

Create `crates/web/assets/ts/placement.ts`:

```typescript
import type { FileStore } from './file-store';
import type { DomElements } from './dom';
import type { ReplayController } from './replay';
import type { RobotInfo, PreviewPlacementMap } from './renderer';

const DEFAULT_ENEMY_HEADING = 180;

export interface PlacementDeps {
    dom: DomElements;
    files: FileStore;
    replay: ReplayController;
    worldPositionFromClient: (clientX: number, clientY: number) => { x: number; y: number } | null;
    renderPreview: (robotInfos: RobotInfo[], placements: PreviewPlacementMap) => void;
    updateSimulationUiState: () => void;
    clearReplayData: () => void;
    onPlacementEnd: () => void;
}

export function startBotPlacementMode(
    deps: PlacementDeps,
    filename: string,
    source: string,
): () => void {
    const { dom, files, replay } = deps;
    const pendingName = filename.replace('.ts', '');
    const baseRobotInfos = files.getRobotInfos();
    const pendingRobotInfo = { name: pendingName, team: 1 };
    let pendingPlacement: { x: number; y: number; heading: number } | null = null;

    dom.addBotBtn.disabled = true;
    dom.templateSelect.disabled = true;
    dom.arenaContainer.style.cursor = 'crosshair';
    dom.arenaOverlay.textContent = `Click in arena to place ${filename} (Esc to cancel)`;
    dom.arenaOverlay.classList.remove('hidden');

    const renderPendingPreview = (): void => {
        const placements = files.getPreviewPlacements();
        if (pendingPlacement) {
            placements[pendingName] = pendingPlacement;
            deps.renderPreview([...baseRobotInfos, pendingRobotInfo], placements);
            return;
        }
        deps.renderPreview(baseRobotInfos, placements);
    };

    const cleanup = (restorePreview = true): void => {
        document.removeEventListener('mousedown', onMouseDown, true);
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('keydown', onKeyDown, true);
        dom.arenaContainer.style.cursor = '';
        dom.addBotBtn.disabled = false;
        dom.templateSelect.disabled = false;
        dom.arenaOverlay.classList.add('hidden');
        if (restorePreview) {
            deps.renderPreview(
                files.getRobotInfos(),
                files.getPreviewPlacements(),
            );
        }
    };

    const commitPlacement = (spawnX: number, spawnY: number): void => {
        files.setFile(filename, source);
        files.setPlacement(filename, {
            x: spawnX,
            y: spawnY,
            heading: DEFAULT_ENEMY_HEADING,
        });
        deps.clearReplayData();
        replay.clearReplay();
        files.switchToFile(filename);
        cleanup(false);
        deps.renderPreview(
            files.getRobotInfos(),
            files.getPreviewPlacements(),
        );
        deps.updateSimulationUiState();
        deps.onPlacementEnd();
    };

    const onMouseMove = (event: MouseEvent): void => {
        const spawn = deps.worldPositionFromClient(event.clientX, event.clientY);
        if (!spawn) {
            if (pendingPlacement) {
                pendingPlacement = null;
                renderPendingPreview();
            }
            return;
        }
        pendingPlacement = {
            x: spawn.x,
            y: spawn.y,
            heading: DEFAULT_ENEMY_HEADING,
        };
        renderPendingPreview();
    };

    const onMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0) {
            return;
        }
        const spawn = deps.worldPositionFromClient(event.clientX, event.clientY);
        if (!spawn) {
            if (pendingPlacement) {
                pendingPlacement = null;
                renderPendingPreview();
            }
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        commitPlacement(spawn.x, spawn.y);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') {
            return;
        }
        cleanup();
        deps.onPlacementEnd();
    };

    renderPendingPreview();
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('keydown', onKeyDown, true);
    return cleanup;
}
```

- [ ] **Step 2: Update `app.ts`**

Remove the `ENEMY_HEADING` constant (line 27).

Add imports at top:
```typescript
import { startBotPlacementMode, type PlacementDeps } from './placement';
```

Add arena dimension constants (replace `ENEMY_HEADING` line):
```typescript
const ARENA_WIDTH = 1200;
const ARENA_HEIGHT = 800;
```

Replace the `startBotPlacementMode` function call in the `addBotBtn` click handler (line 115):
```typescript
stopPlacementMode = startBotPlacementMode(placementDeps, name, source);
```

Where `placementDeps` is defined once inside `bootstrap()`, after `files` is created:
```typescript
const placementDeps: PlacementDeps = {
    dom,
    files,
    replay,
    worldPositionFromClient,
    renderPreview,
    updateSimulationUiState,
    clearReplayData: () => { replayData = null; },
    onPlacementEnd: () => { stopPlacementMode = null; },
};
```

Delete the entire `startBotPlacementMode` function from `app.ts` (lines 402-507).

Replace `1200, 800` in `refreshArenaPreview` (line 292) with `ARENA_WIDTH, ARENA_HEIGHT`.

Remove the line `stopPlacementMode = null;` from inside the `onKeyDown` handler inside `startBotPlacementMode` (this is now handled inside `placement.ts`).

Remove `stopPlacementMode = null;` from the `commitPlacement` inside `startBotPlacementMode` — same reason.

- [ ] **Step 3: Build check**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run typecheck`
Expected: no type errors.

- [ ] **Step 4: Build frontend**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run build`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add crates/web/assets/ts/placement.ts crates/web/assets/ts/app.ts crates/web/assets/ts/dom.ts
git commit -m "refactor(frontend): extract placement.ts from app.ts"
```

---

### Task 9: Extract `visuals.ts` from `renderer.ts`

**Files:**
- Create: `crates/web/assets/ts/visuals.ts`
- Modify: `crates/web/assets/ts/renderer.ts`

- [ ] **Step 1: Create `visuals.ts`**

Create `crates/web/assets/ts/visuals.ts` with the following types and functions moved from `renderer.ts`:

```typescript
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import type { RobotInfo } from './renderer';

const HP_BAR_WIDTH = 40;
const HP_BAR_HEIGHT = 4;
const HIT_RADIUS_PADDING = 2;

export interface RobotGraphic {
    graphic: Graphics;
    color: number;
}

export interface RobotLabel {
    container: Container;
    text: Text;
    hpBar: Graphics;
    hpBg: Graphics;
    color: number;
}

export interface RobotRenderState {
    x: number;
    y: number;
    heading: number;
    alive: boolean;
}

export interface ArenaTheme {
    sceneBackgroundCss: string;
    textColorCss: string;
    borderColor: number;
    gridColor: number;
    hpBackgroundColor: number;
    hpWarningColor: number;
    hpDangerColor: number;
    teamColors: number[];
    bulletFallbackColor: number;
}

export function colorForRobot(
    robotIndex: number,
    robotInfos: RobotInfo[],
    theme: ArenaTheme,
    maxTeams: number,
): number {
    const info = robotInfos[robotIndex];
    if (!info) return 0xffffff;
    const team = Math.max(0, Math.min(maxTeams - 1, info.team));
    return theme.teamColors[team];
}

export function createRobotVisual(
    viewport: Viewport,
    theme: ArenaTheme,
    index: number,
    robotInfos: RobotInfo[],
    robotSize: number,
    renderScale: number,
    maxTeams: number,
): { graphic: RobotGraphic; label: RobotLabel; state: RobotRenderState } {
    const info = robotInfos[index];
    const color = colorForRobot(index, robotInfos, theme, maxTeams);

    const graphic = new Graphics();
    graphic.circle(0, 0, robotSize);
    graphic.fill({ color, alpha: 0.3 });
    graphic.circle(0, 0, robotSize);
    graphic.stroke({ color, width: 2 });
    graphic.moveTo(0, 0);
    graphic.lineTo(robotSize + 8, 0);
    graphic.stroke({ color, width: 3 });
    viewport.addChild(graphic);

    const labelContainer = new Container();
    const textStyle = new TextStyle({
        fontSize: 11,
        fill: theme.textColorCss,
        fontFamily: 'JetBrains Mono, Roboto Mono, monospace',
        fontWeight: 'bold',
    });
    const text = new Text({ text: info.name, style: textStyle });
    text.anchor.set(0.5, 0);
    text.resolution = renderScale * 2;
    labelContainer.addChild(text);

    const hpBg = new Graphics();
    hpBg.roundRect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT, 2);
    hpBg.fill({ color: theme.hpBackgroundColor, alpha: 0.65 });
    hpBg.y = text.height + 2;
    labelContainer.addChild(hpBg);

    const hpBar = new Graphics();
    hpBar.y = hpBg.y;
    labelContainer.addChild(hpBar);

    viewport.addChild(labelContainer);

    return {
        graphic: { graphic, color },
        label: { container: labelContainer, text, hpBar, hpBg, color },
        state: { x: 0, y: 0, heading: 0, alive: true },
    };
}

export function clearRobotVisuals(
    viewport: Viewport | null,
    robotGraphics: RobotGraphic[],
    robotLabels: RobotLabel[],
): void {
    if (viewport) {
        for (const robot of robotGraphics) {
            viewport.removeChild(robot.graphic);
            robot.graphic.destroy();
        }
        for (const label of robotLabels) {
            viewport.removeChild(label.container);
            label.container.destroy({ children: true });
        }
    }
}

export function updateHealthBar(label: RobotLabel, energy: number, theme: ArenaTheme): void {
    const pct = Math.max(0, Math.min(1, energy / 100));
    const barW = HP_BAR_WIDTH * pct;

    let barColor: number;
    if (pct > 0.5) barColor = label.color;
    else if (pct > 0.25) barColor = theme.hpWarningColor;
    else barColor = theme.hpDangerColor;

    label.hpBar.clear();
    if (barW > 0) {
        label.hpBar.roundRect(-HP_BAR_WIDTH / 2, 0, barW, HP_BAR_HEIGHT, 2);
        label.hpBar.fill(barColor);
    }
}

export function pickRobotAtPoint(
    worldX: number,
    worldY: number,
    robotInfos: RobotInfo[],
    robotRenderStates: RobotRenderState[],
    robotSize: number,
): string | null {
    let closestIndex = -1;
    let closestDistanceSq = Number.POSITIVE_INFINITY;
    const hitRadiusSq = (robotSize + HIT_RADIUS_PADDING) * (robotSize + HIT_RADIUS_PADDING);

    for (let i = 0; i < robotInfos.length && i < robotRenderStates.length; i++) {
        const state = robotRenderStates[i];
        const dx = state.x - worldX;
        const dy = state.y - worldY;
        const distSq = dx * dx + dy * dy;
        if (distSq > hitRadiusSq || distSq >= closestDistanceSq) {
            continue;
        }
        closestIndex = i;
        closestDistanceSq = distSq;
    }

    return closestIndex >= 0 ? robotInfos[closestIndex].name : null;
}

export function numberToHexColor(color: number): string {
    return `#${Math.max(0, Math.min(0xffffff, color)).toString(16).padStart(6, '0')}`;
}
```

- [ ] **Step 2: Update `renderer.ts`**

Import from `visuals.ts`:
```typescript
import {
    clearRobotVisuals as clearVisuals,
    colorForRobot,
    createRobotVisual,
    numberToHexColor,
    pickRobotAtPoint,
    updateHealthBar,
    type ArenaTheme,
    type RobotGraphic,
    type RobotLabel,
    type RobotRenderState,
} from './visuals';
```

Remove from `renderer.ts`:
- The `RobotGraphic`, `RobotLabel`, `RobotRenderState`, `ArenaTheme` interfaces (lines 36-66)
- The `colorForRobot` function (lines 186-194)
- The `numberToHexColor` function (lines 170-172)
- The `createRobotVisual` function (lines 224-277)
- The `updateHealthBar` function (lines 618-632)
- The `HP_BAR_WIDTH`, `HP_BAR_HEIGHT` constants (lines 104-105)

Update `clearRobotVisuals` (lines 200-222) to call the imported version:
```typescript
function clearRobotVisualsLocal(): void {
    clearVisuals(viewport, robotGraphics, robotLabels);
    robotGraphics = [];
    robotLabels = [];
    robotRenderStates = [];
    robotVisualSignature = '';
}
```
Update all calls of `clearRobotVisuals()` within `renderer.ts` to `clearRobotVisualsLocal()`.

Update `ensureRobotVisuals` to use the imported `createRobotVisual`:
```typescript
function ensureRobotVisuals(robotInfos: RobotInfo[]): void {
    const nextSignature = buildRobotVisualSignature(robotInfos);
    if (nextSignature === robotVisualSignature) {
        return;
    }

    clearRobotVisualsLocal();
    for (let i = 0; i < robotInfos.length; i++) {
        const result = createRobotVisual(
            viewport!, arenaTheme, i, robotInfos, ROBOT_SIZE, RENDER_SCALE, MAX_TEAMS,
        );
        robotGraphics.push(result.graphic);
        robotLabels.push(result.label);
        robotRenderStates.push(result.state);
    }
    robotVisualSignature = nextSignature;
}
```

Update `renderPreview` and `renderTick` to call `updateHealthBar(label, energy, arenaTheme)` instead of `updateHealthBar(label, energy)`.

Update `pickRobotNameAtClient` to use imported `pickRobotAtPoint`:
```typescript
export function pickRobotNameAtClient(
    clientX: number,
    clientY: number,
    robotInfos: RobotInfo[],
): string | null {
    const worldPos = worldPositionFromClient(clientX, clientY);
    if (!worldPos) {
        return null;
    }
    return pickRobotAtPoint(worldPos.x, worldPos.y, robotInfos, robotRenderStates, ROBOT_SIZE);
}
```

Promote `gridSpacing` (line 394) to module-level constant:
```typescript
const GRID_SPACING = 50;
```

Update `initArena` to use `GRID_SPACING` instead of the local `gridSpacing`.

Update `getRobotSceneInfo` to use imported `numberToHexColor`.

- [ ] **Step 3: Build check**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run typecheck`
Expected: no type errors.

- [ ] **Step 4: Build frontend**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run build`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add crates/web/assets/ts/visuals.ts crates/web/assets/ts/renderer.ts
git commit -m "refactor(frontend): extract visuals.ts from renderer.ts"
```

---

## Chunk 5: Final Verification

### Task 10: Full build and test

**Files:** None (verification only)

- [ ] **Step 1: Run all Rust tests**

Run: `cargo test`
Expected: all tests pass across all three crates.

- [ ] **Step 2: Run clippy**

Run: `cargo clippy`
Expected: no warnings.

- [ ] **Step 3: Run rustfmt**

Run: `cargo fmt`
Then: `cargo fmt -- --check`
Expected: no formatting changes needed.

- [ ] **Step 4: TypeScript typecheck**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run typecheck`
Expected: no type errors.

- [ ] **Step 5: Frontend build**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run build`
Expected: builds successfully, outputs `static/dist/main.js` and `static/dist/style.css`.

- [ ] **Step 6: Commit any formatting fixes**

If `cargo fmt` made changes:
```bash
git add -A
git commit -m "style: apply formatting fixes"
```
