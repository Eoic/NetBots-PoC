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
Add `team: u8` field. Team 0 = player, Team 1 = enemies.

### GameWorld
Change from 2 fixed robots to `Vec<Robot>`. Auto-calculated spawn positions:
- Player bot: (100, 300)
- Enemies: distributed evenly along the right half of the arena (x=400..700, y spread based on count)

### Scanner
Returns distance to nearest robot on a *different* team (currently hardcoded for 2 robots). Same +/-10 degree arc logic.

### Collision detection
Bullet-robot: skip if bullet owner is on same team (friendly fire off). Robot-robot collisions unchanged (physics applies regardless of team).

### Win condition
Last team alive wins. At tick 1000: team with highest total energy wins.

### TickSnapshot
Already serializes `Vec<RobotState>` + bullets. Works with N robots without structural changes.

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
  "errors": []
}
```

Compile error response:
```json
{
  "ok": false,
  "errors": [{ "robot": "chaser-1", "error": "compile error at line 5..." }]
}
```

Each request is fully self-contained. No server-side state. Compiler (`compiler.rs`) is called N times per request.

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

## Editor — CodeMirror 6

Load via CDN (ESM imports):
- `@codemirror/state`, `@codemirror/view` — core
- `@codemirror/lang-javascript` — TypeScript/AssemblyScript highlighting
- `@codemirror/theme-one-dark` — dark theme
- `codemirror` — base setup bundle

Behavior:
- Single editor instance, content swapped on file selection via `EditorView.setState()`
- Switching files: save current content to in-memory files Map, load new file content
- No server persistence — everything in-memory until "Run"

Logs tab: read-only `<pre>` container (not CodeMirror). Cleared on each run, populated with compilation errors and robot log output.

## Bot Templates

Built-in templates shipped as static `.ts` files or embedded in JS:

- **Sitter** — does nothing, stays still. Punching bag for testing.
- **Spinner** — rotates continuously and shoots when gun ready. Tests dodging.
- **Chaser** — scans for enemies, turns toward them, fires when in arc. Tests combat.
- **Wall Hugger** — drives along arena walls. Tests tracking a moving target.

### Adding a bot
User clicks "Add Bot" in right sidebar, picks template from dropdown. New file appears in file tree (e.g., `chaser-1.ts`). Additional instances auto-increment (`chaser-2.ts`). Pre-populated with template source, fully editable.

### Player bot
`my-bot.ts` is always present, cannot be deleted. Pre-populated with the existing robot template.

### Removing a bot
Click (x) on any enemy file in the file tree. Removes from files Map.

### Running
Click "Run". Frontend collects all files, sends to `POST /api/run` with team 0 for `my-bot.ts` and team 1 for all others.

## Replay & Arena

### Rendering (N robots)
- Player bot (team 0): green (#00ff88)
- Enemy bots: colors from palette (red, orange, purple, cyan, etc.)
- Robot labels: name + energy above each robot circle
- Bullets colored to match owner robot

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
