# Sandbox Testing Rework

Replace the matchmaking-based flow with an instant testing sandbox where users edit robot scripts and run simulations immediately against configurable enemy bots.

## Requirements

- Remove all matchmaking (create/join/submit/status lifecycle)
- Game arena always visible
- User can run their script instantly against enemy bots
- Support N robots (not just 2) with team-based combat
- Built-in enemy bot templates, fully editable
- CodeMirror 6 code editor with integrated file tree

## Engine Changes

### Robot struct
Add `team: u8` and `name: String` fields. Team 0 = player, Team 1 = enemies.

### GameWorld constructor
Replace `GameWorld::new()` with `GameWorld::new(configs: &[RobotConfig])` where:

```rust
struct RobotConfig {
    name: String,
    team: u8,
}
```

Spawn positions are auto-calculated:
- Player bot (team 0): position (100, 300), heading 0 degrees (facing right)
- Enemies (team 1): x = 550, y = arena_height * (i+1) / (enemy_count+1) for i in 0..enemy_count, heading 180 degrees (facing left toward player)

### Robot and Bullet snapshots
- `RobotSnapshot`: add `team: u8` and `name: String` fields (needed for frontend coloring and labels)
- `BulletSnapshot`: add `owner_id: usize` field (needed for bullet coloring by owner)

### Scanner
Update `compute_scan` to skip robots where `other.team == robot.team` instead of `other.id == robot_id`. Returns distance to nearest robot on a different team. Same +/-10 degree arc logic.

### Collision detection
- Bullet-robot: add `owner_team: u8` field to `Bullet` struct. Skip collision if `bullet.owner_team == robot.team` (friendly fire off).
- Robot-robot collisions: unchanged (physics applies regardless of team).

### Win condition
Change `GameStatus::Finished { winner: Option<usize> }` to `GameStatus::Finished { winner_team: Option<u8> }`.
- Last team alive wins.
- At tick 1000: team with highest total energy (summed across all alive robots on that team) wins.
- Draw if tied.

Update `check_win()` to aggregate alive status and energy by team.

### WASM runtime errors
If a robot's WASM traps (panic/unreachable, not out-of-fuel), that robot is killed (energy set to 0, alive = false). The simulation continues. This matches the existing out-of-fuel behavior where the robot forfeits its turn.

### TickSnapshot
Already serializes `Vec<RobotState>` + bullets. Works with N robots without structural changes, just more entries.

## API Changes

### Remove
- `POST /api/match/create`
- `POST /api/match/{id}/join`
- `POST /api/match/{id}/submit`
- `GET /api/match/{id}/status`
- `GET /ws/match/{id}` (WebSocket)
- `state.rs` (DashMap, GameMatch, Player, MatchStatus)
- `ws.rs`

### New endpoint

`POST /api/run`

AssemblyScript is the only supported language. No `language` field in the request — the compiler always uses `asc`.

All N compilations run concurrently (each uses a separate temp dir). Overall request timeout: 30 seconds.

Request:
```json
{
  "robots": [
    { "name": "my-bot", "source": "...", "team": 0 },
    { "name": "chaser-1", "source": "...", "team": 1 },
    { "name": "chaser-2", "source": "...", "team": 1 }
  ]
}
```

Success response:
```json
{
  "ok": true,
  "replay": {
    "arena": { "width": 800, "height": 600 },
    "robots": [{ "name": "my-bot", "team": 0 }, ...],
    "ticks": [ ... ]
  },
  "winner_team": 0,
  "total_ticks": 347,
  "errors": [],
  "logs": [
    { "robot": "my-bot", "messages": ["scan: 150.5", "firing!"] }
  ]
}
```

Compile error response:
```json
{
  "ok": false,
  "errors": [{ "robot": "chaser-1", "error": "compile error at line 5..." }]
}
```

Each request is fully self-contained. No server-side state.

### Log capture
Change `log_i32` and `log_f64` host functions in `linker.rs` to append to a `Vec<String>` on `RobotState` instead of printing to stdout. The match runner collects logs from each robot after simulation and includes them in the response.

### Frontend loading state
While the request is in flight, the Run button shows a spinner/loading state and is disabled. The arena stays on its current state (idle or last replay frame).

## Frontend Layout

```
+-----------------------------+--------------+
|                             |              |
|     Arena Canvas            |  [Run]       |
|     (big, always visible)   |  + Add bot   |
|                             |  Replay ctrl |
|                             |              |
+-----------------------------+              |
|  [file tree] | Editor       |              |
|  my-bot.ts   | (CodeMirror) |              |
|  chaser-1.ts | [Logs tab]   |              |
|              |              |              |
+-----------------------------+--------------+
```

- **Left column** (flex, takes remaining space): Arena canvas (top) + editor panel (bottom), separated by a draggable resize handle.
- **Right sidebar** (fixed width ~250px): Run button, add-bot controls (template dropdown + "Add" button), replay controls.
- **Editor panel**: Integrated file tree on the left, CodeMirror 6 editor on the right, tab bar with Code and Logs tabs.

### Keyboard shortcut
Ctrl+Enter (Cmd+Enter on Mac) triggers Run from anywhere on the page.

## Editor — CodeMirror 6

Load via CDN (ESM imports), pinned to specific versions in an import map:
- `@codemirror/state`, `@codemirror/view` — core
- `@codemirror/lang-javascript` — TypeScript/AssemblyScript highlighting
- `@codemirror/theme-one-dark` — dark theme
- `codemirror` — base setup bundle

Behavior:
- Single editor instance, content swapped on file selection via `EditorView.setState()`
- Switching files: save current content to in-memory files Map, load new file content
- No server persistence — everything in-memory until "Run"

Logs tab: read-only `<pre>` container (not CodeMirror). Cleared on each run, populated with compilation errors and per-robot log output from the API response.

## Bot Templates

Built-in templates shipped as static `.ts` files or embedded in JS:

- **Sitter** — does nothing, stays still. Punching bag for testing.
- **Spinner** — rotates continuously and shoots when gun ready. Tests dodging.
- **Chaser** — scans for enemies, turns toward them, fires when in arc. Tests combat.
- **Wall Hugger** — drives along arena walls. Tests tracking a moving target.

The existing `robot-template.ts` becomes the default content for `my-bot.ts` (the player's bot).

### Adding a bot
User clicks "Add Bot" in right sidebar, picks template from dropdown. New file appears in file tree (e.g., `chaser-1.ts`). Additional instances auto-increment (`chaser-2.ts`). Pre-populated with template source, fully editable.

### Player bot
`my-bot.ts` is always present, cannot be deleted. Pre-populated with the existing robot template.

### Removing a bot
Click (x) on any enemy file in the file tree. Removes from files Map.

### Running
Click "Run" (or Ctrl+Enter). Frontend collects all files, sends to `POST /api/run` with team 0 for `my-bot.ts` and team 1 for all others.

## Replay & Arena

### Rendering (N robots)
- Player bot (team 0): green (#00ff88)
- Enemy bots: colors from palette (red, orange, purple, cyan, etc.)
- Robot labels: name + energy above each robot circle
- Bullets colored to match owner robot (using `owner_id` from `BulletSnapshot`)

### Replay controls (right sidebar)
- Play/Pause toggle
- Speed: 0.5x, 1x, 2x, 4x
- Tick scrubber: slider to jump to any tick
- Restart button
- Current tick / total ticks display

### States
- **Idle**: Before first run — arena border visible, "Click Run to start" message, no robots
- **Playing**: Replay auto-plays after run completes
- **Finished**: Stays on last frame. User can scrub, restart, or edit and re-run.

### Payload size
The full replay JSON is returned in one synchronous response. For a 1000-tick game with 5+ robots this may be several MB. This is acceptable for a local testing sandbox. Compression (gzip) can be added later if needed.
