# Codebase Refactor: Reduce Complexity and Improve Maintainability

## Goal

Split long implementations into multiple files, extract magic numbers into named constants, remove inline comments (`//`), and deduplicate repeated code patterns. Both Rust backend and TypeScript frontend are in scope.

## Constraints

- Comments: only `///` doc comments on methods/attributes, only when non-obvious. Remove all `//` inline comments.
- Constants: module-local (top of file that uses them). Game physics constants go in `engine/src/world.rs`.
- No new abstractions, traits, or class hierarchies. Just file splits, constant extraction, and deduplication.

---

## Section 1: Engine Crate

### New file: `crates/engine/src/scan.rs` (~80 lines)

Extracted from `tick.rs`:
- `pub fn compute_scan(world: &GameWorld, robot_id: usize) -> f64`
- `pub fn normalize_angle(angle: f64) -> f64` — helper for angle wrapping to [-180, 180]

Update `lib.rs` to add `pub mod scan;`.

### Changes to `tick.rs` (628 → ~480 lines)

- Split `run_events_phase()` into three private functions:
  - `process_bullet_hits(world: &mut GameWorld) -> Vec<HitEvent>`
  - `process_wall_collisions(world: &mut GameWorld)`
  - `process_robot_collisions(world: &mut GameWorld)`
- `run_events_phase()` calls the three in sequence.
- Replace all magic numbers with constants from `world.rs`.
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
- `pub fn validate_run_request(req: &RunRequest) -> Result<ValidatedRequest, ErrorResponse>`
- Private helper `validate_spawn_point(spawn: &SpawnPoint) -> Result<(), String>`
- Constants: `MAX_ROBOTS`, `MAX_SOURCE_BYTES`, `MAX_ALLOWED_TICKS`
- `ValidatedRequest` struct holding validated data passed to compilation/simulation.

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

### New file: `crates/web/assets/ts/placement.ts` (~170 lines)

Extracted from `app.ts`:
- Bot placement state machine: `startPlacementMode()`, `stopPlacementMode()`
- Pointer/click handlers for arena bot placement
- Exports functions that `app.ts` calls to enter/exit placement and handle pointer events.

### Changes to `app.ts` (519 → ~350 lines)

- Remove placement logic (moved to `placement.ts`).
- Add constant: `const DEFAULT_ENEMY_HEADING = 180;`
- Replace hardcoded `1200, 800` arena dimensions with constants.
- Remove `//` comments.

### New file: `crates/web/assets/ts/visuals.ts` (~200 lines)

Extracted from `renderer.ts`:
- `createRobotVisual()` — builds robot graphics, label, health bar
- `updateRobotVisual()` — updates position, rotation, health for a tick
- Selection marker creation and update
- `robotAtPoint()` — hit-testing for picking
- Constants: `HP_BAR_WIDTH`, `HP_BAR_HEIGHT`, `HIT_RADIUS_TOLERANCE`

### Changes to `renderer.ts` (659 → ~450 lines)

- Import visual functions from `visuals.ts`.
- Keeps: Pixi/viewport init, theme reading, `renderTick()` orchestration, grid drawing.
- Add constants at top: `RENDER_SCALE`, `GRID_SPACING`.
- Remove `//` comments.

### Other TS files — comment cleanup only where needed.

---

## Out of Scope

- No new abstractions, traits, or class hierarchies
- No test changes beyond updating imports for moved functions
- No behavioral changes — pure refactor
