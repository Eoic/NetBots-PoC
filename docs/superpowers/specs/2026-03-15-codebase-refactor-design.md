# Codebase Refactor: Reduce Complexity and Improve Maintainability

## Goal

Split long implementations into multiple files, extract magic numbers into named constants, remove inline comments (`//`), and deduplicate repeated code patterns. Both Rust backend and TypeScript frontend are in scope.

## Constraints

- Comments: only `///` doc comments on methods/attributes, only when non-obvious. Remove all `//` inline comments.
- Constants: module-local (top of file that uses them). Game physics constants go in `engine/src/world.rs`.
- No new traits or class hierarchies. Lightweight parameter structs are allowed where needed for file extraction.

---

## Section 1: Engine Crate

### New file: `crates/engine/src/scan.rs` (~50 lines)

Extracted from `tick.rs`:
- `pub fn compute_scan(world: &GameWorld, robot_id: usize) -> f64` — moved from `tick.rs`
- `pub fn normalize_angle(angle: f64) -> f64` — new helper extracted from the inline `while` loop in `compute_scan` (tick.rs lines 318-323). Normalizes to [-180, 180] range. Note: `run_resolution_phase` uses [0, 360) normalization which is a different operation — leave that as-is.

Update `lib.rs`: add `pub mod scan;` and `pub use scan::*;` (maintains re-export pattern so downstream crates like `web` don't break).

### Changes to `tick.rs` (628 → ~560 lines)

- Split `run_events_phase()` into three private functions. Each takes `&mut GameWorld` plus `&mut TickEvents` and `&mut Vec<GameEvent>` to accumulate results:
  - `process_bullet_hits(world: &mut GameWorld, tick_events: &mut TickEvents, game_events: &mut Vec<GameEvent>)`
  - `process_wall_collisions(world: &mut GameWorld, tick_events: &mut TickEvents, game_events: &mut Vec<GameEvent>)`
  - `process_robot_collisions(world: &mut GameWorld, tick_events: &mut TickEvents, game_events: &mut Vec<GameEvent>)`
- `run_events_phase()` creates `tick_events` and `game_events`, calls the three in sequence, returns the tuple.
- Replace magic numbers with constants from `world.rs`:
  - `hit.power * 2.0` → `hit.power * HIT_REWARD_MULTIPLIER`
  - `robot.energy -= 1.0` → `robot.energy -= ROBOT_COLLISION_DAMAGE`
  - `+ 0.5` (separation) → `+ COLLISION_SEPARATION_BUFFER`
  - `power.clamp(1.0, 3.0)` → `power.clamp(MIN_BULLET_POWER, MAX_BULLET_POWER)`
  - `1.0 + power / 5.0` → `GUN_HEAT_BASE + power / GUN_HEAT_POWER_DIVISOR`
- Remove all `//` comments.

### Changes to `world.rs`

Add constants (alongside existing ones):
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

Remove `//` comments.

### Changes to `collision.rs`

- Replace `bullet.power * 4.0` with `BULLET_DAMAGE_MULTIPLIER`.
- Remove `//` comments.

---

## Section 2: WASM Runner Crate

### Changes to `runner.rs` (168 → ~140 lines)

- Extract private method:
  ```rust
  fn handle_call_result(&mut self, context: &str, result: anyhow::Result<()>)
  ```
  Deduplicates identical trap-handling in `call_on_tick`, `call_on_hit`, `call_on_collision`.
- Remove `//` comments.

### `linker.rs`, `sandbox.rs` — comment cleanup only.

---

## Section 3: Web Crate (Rust)

### New file: `crates/web/src/validation.rs` (~120 lines)

Extracted from `routes.rs`:
- Constants: `MAX_ROBOTS: usize = 16`, `MAX_SOURCE_BYTES: usize = 64 * 1024`, `MAX_ALLOWED_TICKS: u32 = 100_000`
- `ValidatedRequest` struct:
  ```rust
  pub struct ValidatedRobot {
      pub name: String,
      pub source: String,
      pub team: u8,
      pub spawn: Option<SpawnPoint>,
  }
  pub struct ValidatedRequest {
      pub robots: Vec<ValidatedRobot>,
      pub max_ticks: u32, // resolved from Option with default
  }
  ```
- `pub fn validate_run_request(req: &RunRequest) -> Result<ValidatedRequest, ErrorResponse>` — all input validation including team IDs, source length, spawn bounds, robot count
- Private helper `validate_spawn_point(spawn: &SpawnPoint) -> Result<(), String>`

### Changes to `routes.rs` (331 → ~200 lines)

- `run()` handler becomes: validate → compile → simulate → respond.
- Import validation from `validation.rs`.
- Remove `//` comments.

### Changes to `compiler.rs`

- Add constant: `const COMPILATION_TIMEOUT: Duration = Duration::from_secs(10);`
- Remove `//` comments.

### Changes to `match_runner.rs`

- Extract private helper: `fn kill_robot(robot: &mut Robot)` — sets `alive = false`, `energy = 0.0`.
- Remove `//` comments.

---

## Section 4: Frontend TypeScript

### New file: `crates/web/assets/ts/placement.ts` (~130 lines)

Extracted from `app.ts`. The placement state machine needs access to several pieces of app state. Use a params object to pass dependencies:

```typescript
interface PlacementDeps {
  dom: DomElements;
  files: FileStore;
  renderer: { worldToArena, arenaToWorld, addPlacementGhost, ... };
  onComplete: () => void;
}

export function startPlacementMode(deps: PlacementDeps): () => void;
// Returns a stopPlacementMode function
```

This keeps the extraction clean without a full class hierarchy.

### Changes to `app.ts` (519 → ~350 lines)

- Remove placement logic (moved to `placement.ts`).
- Rename existing `ENEMY_HEADING` constant to `DEFAULT_ENEMY_HEADING` for clarity.
- Add arena dimension constants: `const ARENA_WIDTH = 1200; const ARENA_HEIGHT = 800;`
- Remove `//` comments.

### New file: `crates/web/assets/ts/visuals.ts` (~200 lines)

Extracted from `renderer.ts`. Functions receive the state they need as parameters rather than closing over module-level variables:

- `createRobotVisual(viewport, theme, teamIndex, name)` — builds robot graphics, label, health bar
- `updateRobotVisual(visual, robotState, tick)` — updates position, rotation, health bar
- `clearRobotVisuals()`, `ensureRobotVisuals()` — lifecycle management
- `colorForRobot()` — team color helper
- Selection marker functions (`ensureSelectionMarker`, `updateSelectionMarker`) stay in `renderer.ts` — tightly coupled to module-level `selectedRobotName` state
- `robotAtPoint(robotGraphics, x, y, robotSize, hitPadding)` — hit-testing
- `RobotGraphic`, `RobotLabel`, `RobotRenderState` type interfaces move here
- Constants: `HP_BAR_WIDTH = 40`, `HP_BAR_HEIGHT = 4`, `HIT_RADIUS_PADDING = 2`

### Changes to `renderer.ts` (659 → ~450 lines)

- Import visual functions from `visuals.ts`.
- Keeps: Pixi/viewport init, theme reading, `renderTick()` orchestration, grid drawing.
- Promote existing `gridSpacing` local (line 394) to module-level constant: `const GRID_SPACING = 50;`
- `RENDER_SCALE` already exists at module level (line 106) — no change needed.
- Remove `//` comments.

### Other TS files — no changes needed (already clean of `//` comments).

---

## Out of Scope

- No new traits or class hierarchies
- No test changes beyond updating imports for moved functions
- No behavioral changes — pure refactor
