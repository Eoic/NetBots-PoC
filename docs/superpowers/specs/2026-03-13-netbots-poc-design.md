# NetBots PoC Technical Design

## Context

NetBots is a browser-based multiplayer robot programming game inspired by Robocode. Players write robot scripts that are compiled to WebAssembly and executed in a server-side simulation engine. This design covers the bare-bones proof-of-concept: the core loop from script writing to game simulation and replay visualization.

The PoC validates the hardest technical challenge: compiling user-written code to WASM, executing it safely in a sandboxed game engine, and streaming the result to a browser for rendering.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Server runtime | Rust (axum + Wasmtime) | Performance, native WASM support, safety |
| Script language (PoC) | AssemblyScript | TypeScript-like syntax, compiles to WASM, low friction |
| Compilation | Server-side (`npx asc`) | Consistent pipeline for all future languages |
| Frontend | Vanilla HTML/JS + Pixi.js v8 | Minimal for PoC, no framework overhead |
| Simulation model | Pre-computed, replay-streamed | Deterministic robots, no real-time player input needed |
| WASM interface | Scalar-only parameters | Avoids shared memory/pointer complexity |

## Architecture Overview

```
Browser                          Server (Rust)
  |                                |
  |-- POST /submit (source+lang) ->|-- compiler.rs (npx asc) --|
  |                                |<-- .wasm binary ----------|
  |                                |
  |  (both players submitted)      |-- wasm_runner (Wasmtime)
  |                                |-- engine (tick loop)
  |                                |-- Vec<TickSnapshot>
  |                                |
  |<-- WebSocket: game_start ------|
  |<-- WebSocket: tick[] (batch)  --|
  |<-- WebSocket: game_over -------|
  |                                |
  |-- Pixi.js renders each tick   |
```

## WASM Robot Contract

### Exports (robot provides, engine calls)

```
on_tick(tick: u32, energy: f64, x: f64, y: f64, heading: f64, speed: f64, gun_heat: f64) -> void
on_hit(damage: i32) -> void
on_collision(kind: i32, x: f64, y: f64) -> void
  // kind: 0=wall, 1=robot
```

Event ordering per tick: `on_hit` and `on_collision` are called before `on_tick` so the robot can react to events in the same tick.

### Imports (engine provides, robot calls)

All under module `"env"`:

```
set_speed(speed: f64) -> void       // sets speed for this tick: positive=forward, negative=backward
                                    // clamped to [-2.0, 8.0] by engine
rotate(angle_deg: f64) -> void
shoot(power: f64) -> void           // power 1.0-3.0, damage = power * 4
scan() -> f64                       // distance to nearest enemy within ±10° of heading, -1.0 if none
log_i32(val: i32) -> void           // debug logging
log_f64(val: f64) -> void           // debug logging (positions, headings, etc.)
```

**Note on `scan()`:** This is a read-only query, NOT a buffered action. It reads pre-resolution positions from the current game state and returns immediately. Heading, gun direction, and scan direction are unified for the PoC — the robot cannot scan independently of its facing.

### Action buffering

Actions are buffered per tick. Only the first of each type is applied:
- First `set_speed`
- First `rotate`
- First `shoot` (if gun_heat == 0)

### Sandboxing

Wasmtime fuel: 100,000 units per `on_tick` call (provisional — needs tuning with representative robots). Exceeding fuel traps the call; robot forfeits its turn.

## Game Simulation Engine

### Data Model

```rust
struct GameWorld {
    tick: u32,
    arena_width: f64,   // 800.0
    arena_height: f64,   // 600.0
    robots: Vec<Robot>,
    bullets: Vec<Bullet>,
    status: GameStatus,
}

struct Robot {
    id: usize,
    x: f64, y: f64,
    heading: f64,        // degrees, 0=right, CW (screen coords: Y-down)
    speed: f64,
    energy: f64,         // starts at 100.0
    gun_heat: f64,       // decreases 0.1/tick, shoot when 0
    alive: bool,
}

struct Bullet {
    owner_id: usize,
    x: f64, y: f64,
    heading: f64,
    speed: f64,          // constant 8.0
    power: f64,          // 1.0-3.0
}

enum GameStatus { WaitingForPlayers, Running, Finished { winner: Option<usize> } }
```

### Tick Loop

```
Each tick:
1. EVENTS — bullet→robot collisions → on_hit(damage)
             robot→wall/robot collisions → on_collision(kind, x, y)
2. DECISIONS — for each alive robot: clear actions, call on_tick(...)
               WASM calls move/rotate/shoot → buffered
3. RESOLUTION — apply first rotate (clamped ±10°/tick)
                apply first set_speed (clamped -2.0 to 8.0)
                apply first shoot (if gun_heat==0): spawn bullet, gun_heat = 1.0 + power/5.0
4. PHYSICS — move robots (x += cos(heading)*speed, y -= sin(heading)*speed)
             (Y-down screen coords with CW heading convention)
             move bullets (constant speed 8.0)
             remove out-of-bounds bullets
             cool guns (gun_heat -= 0.1, min 0)
             clamp robots to arena
5. CAPTURE — serialize TickSnapshot
6. WIN CHECK — ≤1 alive → Finished. Tick 1000 → highest energy wins.
```

### Collision Detection

Simple circle model (robot radius = 18px):
- **Bullet→robot:** distance(bullet, robot) < 18. Damage = power * 4. Shooter gains energy = power * 2.0.
- **Robot→robot:** distance < 36. Push apart, both take 1 damage.
- **Robot→wall:** clamp to bounds.

Brute-force O(n^2) is fine for 2 robots + handful of bullets.

### Game Config

- Arena: 800x600
- Robot radius: 18px
- Starting energy: 100
- Starting gun_heat: 1.0
- Max ticks: 1000
- Bullet speed: 8.0
- Max rotation: 10°/tick
- Max speed: 8.0 forward, 2.0 backward
- Gun cooldown: 0.1/tick
- Coordinate system: Y-down (screen coords), heading CW from right
- Spawn positions: Robot 0 at (100, 300) heading 0°, Robot 1 at (700, 300) heading 180°

## Server Architecture

### Endpoints (axum)

```
POST /api/match/create              → { match_id: String }
POST /api/match/{id}/join           → { player_id: String, token: String }
POST /api/match/{id}/submit         → multipart: source code + language
                                      header: Authorization: Bearer <token>
                                      → { ok: true } or compile errors
GET  /api/match/{id}/status         → { status, players }
GET  /ws/match/{id}                 → WebSocket upgrade
```

CORS middleware (`tower-http`) enabled for development (client may be served from different origin).
Static file serving for the `client/` directory via `tower-http::services::ServeDir`.

### Server State

```rust
struct AppState {
    matches: DashMap<String, GameMatch>,
}

struct GameMatch {
    id: String,
    players: Vec<Player>,
    status: GameStatus,
    wasm_modules: Vec<Option<Vec<u8>>>,  // compiled .wasm per player
    replay: Option<Vec<TickSnapshot>>,
}

struct Player {
    id: String,
    token: String,
    connected: bool,
}
```

### Match Lifecycle

1. Player A: create match → join → submit code
2. Player B: join (with match_id) → submit code
3. Server: compile both → validate WASM exports → run simulation → store replay
4. Server: send complete replay as a batch over WebSocket; client paces playback at 30fps via `requestAnimationFrame`

**Note on DashMap concurrency:** Use `Arc<Mutex<GameMatch>>` as the DashMap value to avoid holding DashMap locks across `.await` points (e.g., during compilation).

### WebSocket Protocol (JSON)

**Server → Client:**
```json
{ "type": "game_start", "arena": { "width": 800, "height": 600 },
  "players": [{ "id": "p1", "name": "Bot A" }, { "id": "p2", "name": "Bot B" }] }

{ "type": "tick", "tick": 42,
  "robots": [{ "id": 0, "x": 150.5, "y": 300.2, "heading": 45.0, "energy": 85, "alive": true }],
  "bullets": [{ "x": 200.0, "y": 305.0, "heading": 45.0 }],
  "events": [{ "type": "shot_fired", "robot_id": 0 }] }

{ "type": "game_over", "winner": 0, "ticks": 450 }
```

**Client → Server:**
```json
{ "type": "ready" }
```

### Compilation Service (compiler.rs)

```rust
async fn compile(source: &str, language: &str) -> Result<Vec<u8>, CompileError> {
    match language {
        "assemblyscript" => compile_assemblyscript(source).await,
        _ => Err(CompileError::UnsupportedLanguage),
    }
}

async fn compile_assemblyscript(source: &str) -> Result<Vec<u8>, CompileError> {
    // 1. Write source to temp file
    // 2. Run: npx asc temp.ts --outFile temp.wasm --optimize (10s timeout)
    // 3. Read temp.wasm bytes
    // 4. Cleanup temp files
}
```

Future languages: add a new match arm and compiler function. The interface is always `source code → .wasm bytes`.

## Client Architecture

### Page Layout

Single HTML page with 3 areas:
- **Left:** `<textarea>` code editor with default robot template
- **Center:** Pixi.js canvas (800x600)
- **Right:** Match controls (create/join, status log)

### JS Modules

- `main.js` — UI wiring, event handlers
- `api.js` — HTTP calls (create match, join, submit source code)
- `ws.js` — WebSocket connection, message dispatch
- `renderer.js` — Pixi.js arena rendering

### Renderer (Pixi.js v8)

- Robots: colored triangles (green/red), rotated to heading
- Bullets: small yellow circles
- Arena: dark background with border
- Events: brief text flash for hits

### Client Dependencies (CDN)

```html
<script type="importmap">
{
  "imports": {
    "pixi.js": "https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.mjs"
  }
}
</script>
```

## Project Structure

```
NetBots/
  PROPOSAL.md
  server/
    Cargo.toml                    # workspace manifest
    crates/
      engine/                     # Pure game logic, no IO
        Cargo.toml
        src/
          lib.rs
          world.rs                # GameWorld, Robot, Bullet, GameStatus
          tick.rs                 # tick loop, action resolution, physics
          collision.rs            # collision detection
      wasm_runner/                # Wasmtime integration
        Cargo.toml
        src/
          lib.rs
          runner.rs               # RobotRunner: load wasm, call exports
          linker.rs               # host functions (move, rotate, shoot, scan)
          sandbox.rs              # fuel config, export validation
      web/                        # HTTP + WebSocket server
        Cargo.toml
        src/
          main.rs                 # server startup, router
          routes.rs               # match CRUD endpoints
          ws.rs                   # WebSocket handler, replay streaming
          state.rs                # AppState, GameMatch, Player
          match_runner.rs         # orchestrate: compile → validate → simulate → replay
          compiler.rs             # language-specific compilation (npx asc, etc.)
  client/
    index.html
    style.css
    js/
      main.js
      api.js
      ws.js
      renderer.js
    robot-template.ts             # default AssemblyScript shown in editor
```

## Verification

1. **Engine unit tests:** Create two hardcoded WASM robots, run 100 ticks, verify movement, shooting, and collision.
2. **WASM runner tests:** Load a test `.wasm`, verify host functions are called, verify fuel exhaustion traps.
3. **Integration test:** Start server, create match via HTTP, join two players, submit AssemblyScript source, verify compilation succeeds and replay is produced.
4. **End-to-end:** Open browser, write robot code, create/join match, watch Pixi.js replay.
