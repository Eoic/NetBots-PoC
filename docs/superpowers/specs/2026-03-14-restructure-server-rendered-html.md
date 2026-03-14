# Restructure: Unified Project with Server-Rendered HTML

## Goal

Eliminate the `client/` and `server/` directory separation. Move to a single Cargo workspace at the project root with Askama-based server-rendered HTML. Keep browser JS only for things that require it (Pixi.js canvas, WebSocket, editor interactions).

## New Directory Structure

```
NetBots/
├── Cargo.toml              # workspace root (moved from server/)
├── Cargo.lock
├── crates/
│   ├── engine/             # unchanged
│   ├── wasm_runner/        # unchanged
│   └── web/
│       ├── Cargo.toml      # add askama dependency
│       ├── src/
│       │   ├── main.rs     # updated: index route, static file serving path
│       │   ├── routes.rs   # updated: add IndexTemplate + index handler
│       │   ├── state.rs
│       │   ├── match_runner.rs
│       │   ├── compiler.rs
│       │   └── ws.rs
│       ├── templates/
│       │   └── index.html  # Askama template (from client/index.html)
│       └── static/
│           ├── style.css
│           ├── robot-template.ts
│           └── js/
│               ├── main.js
│               ├── api.js
│               ├── ws.js
│               └── renderer.js
├── docs/
├── CLAUDE.md
└── PROPOSAL.md
```

## Changes

### Askama Template & Route

Add a new index route that renders an Askama template:

```rust
use askama::Template;

#[derive(Template)]
#[template(path = "index.html")]
pub struct IndexTemplate;

pub async fn index() -> IndexTemplate {
    IndexTemplate
}
```

The template is the current `client/index.html` with asset paths updated to `/static/...`.

### Router Changes (main.rs)

Replace the fallback static file serving:

```rust
// Before
.fallback_service(ServeDir::new("../client"))

// After
.route("/", get(routes::index))
.nest_service("/static", ServeDir::new("crates/web/static"))
```

### Dependency Addition (web/Cargo.toml)

Add `askama` with Axum integration:

```toml
askama = "0.13"
askama_axum = "0.5"
```

Update internal crate paths from `../engine` to `../../engine` (crates moved up one directory level).

### Asset Path Updates

In `templates/index.html`:
- `style.css` → `/static/style.css`
- `js/main.js` → `/static/js/main.js`

In `static/js/main.js`:
- `/robot-template.ts` → `/static/robot-template.ts`

### File Moves

| From | To |
|------|-----|
| `client/index.html` | `crates/web/templates/index.html` (paths updated) |
| `client/style.css` | `crates/web/static/style.css` |
| `client/robot-template.ts` | `crates/web/static/robot-template.ts` |
| `client/js/*.js` | `crates/web/static/js/*.js` |
| `server/Cargo.toml` | `Cargo.toml` |
| `server/Cargo.lock` | `Cargo.lock` |
| `server/crates/` | `crates/` |

### Directories Deleted

- `server/` (contents moved to root)
- `client/` (contents moved into `crates/web/`)

### Unchanged

- `engine` crate — no code changes
- `wasm_runner` crate — no code changes
- All API routes, match runner, compiler, WebSocket handler — no logic changes
- All client JS logic — unchanged except the one template fetch path

## Verification

After restructuring:
1. `cargo build` succeeds from project root
2. `cargo test` passes (all existing tests)
3. Server starts with `cargo run -p netbots-web` (or updated package name)
4. Navigating to `http://localhost:3000` renders the page
5. Static assets load correctly (`/static/style.css`, `/static/js/main.js`, etc.)
6. Match create/join/submit/replay flow works end-to-end
