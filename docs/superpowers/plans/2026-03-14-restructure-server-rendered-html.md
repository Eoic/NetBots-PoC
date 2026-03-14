# Restructure to Server-Rendered HTML — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the separate `client/` and `server/` directories into a single Cargo workspace at the project root, with Askama server-rendered HTML and static JS for browser-only concerns.

**Architecture:** Move `server/` contents to root, move `client/` assets into `crates/web/static/` and `crates/web/templates/`. Add Askama to render the index page. Keep existing JS for Pixi.js, WebSocket, and editor interactions.

**Tech Stack:** Rust, Axum 0.8, Askama 0.13, askama_axum 0.5, Pixi.js 8 (unchanged)

**Spec:** `docs/superpowers/specs/2026-03-14-restructure-server-rendered-html.md`

---

## Task 1: Move Cargo workspace to project root

**Files:**
- Move: `server/Cargo.toml` → `Cargo.toml`
- Move: `server/Cargo.lock` → `Cargo.lock`
- Move: `server/crates/` → `crates/`
- Delete: `server/` (empty after moves)

- [ ] **Step 1: Move workspace files and crates directory**

```bash
mv server/Cargo.toml Cargo.toml
mv server/Cargo.lock Cargo.lock
mv server/crates crates
```

- [ ] **Step 2: Remove server directory**

```bash
rm -rf server/
```

Note: This also removes `server/target/` (build cache). A fresh `target/` will appear at the project root on next build (gitignored by unanchored `target/` in `.gitignore`).

- [ ] **Step 3: Verify build**

Run: `cargo build` from project root
Expected: Successful compilation

- [ ] **Step 4: Verify tests**

Run: `cargo test` from project root
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Move Cargo workspace from server/ to project root"
```

---

**Note:** Tasks 2–4 are functionally atomic. The server cannot serve the frontend between Task 2 (client deleted) and Task 4 (new routes wired). Intermediate commits are for clean git history only.

## Task 2: Move client assets into web crate

**Files:**
- Create: `crates/web/static/` directory
- Create: `crates/web/static/js/` directory
- Create: `crates/web/templates/` directory
- Move: `client/style.css` → `crates/web/static/style.css`
- Move: `client/robot-template.ts` → `crates/web/static/robot-template.ts`
- Move: `client/js/api.js` → `crates/web/static/js/api.js`
- Move: `client/js/ws.js` → `crates/web/static/js/ws.js`
- Move: `client/js/renderer.js` → `crates/web/static/js/renderer.js`
- Move: `client/js/main.js` → `crates/web/static/js/main.js`
- Move: `client/index.html` → `crates/web/templates/index.html`
- Delete: `client/` (empty after moves)

- [ ] **Step 1: Create target directories**

```bash
mkdir -p crates/web/static/js
mkdir -p crates/web/templates
```

- [ ] **Step 2: Move static assets**

```bash
mv client/style.css crates/web/static/style.css
mv client/robot-template.ts crates/web/static/robot-template.ts
mv client/js/api.js crates/web/static/js/api.js
mv client/js/ws.js crates/web/static/js/ws.js
mv client/js/renderer.js crates/web/static/js/renderer.js
mv client/js/main.js crates/web/static/js/main.js
```

- [ ] **Step 3: Move index.html to templates**

```bash
mv client/index.html crates/web/templates/index.html
```

- [ ] **Step 4: Remove empty client directory**

```bash
rm -rf client/
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Move client assets into crates/web/static and templates"
```

---

## Task 3: Update asset paths in template and JS

**Files:**
- Modify: `crates/web/templates/index.html` — update `style.css` and `js/main.js` references to `/static/...`
- Modify: `crates/web/static/js/main.js` — update `/robot-template.ts` to `/static/robot-template.ts`

- [ ] **Step 1: Update stylesheet path in template**

In `crates/web/templates/index.html`, change:
```html
<link rel="stylesheet" href="style.css">
```
to:
```html
<link rel="stylesheet" href="/static/style.css">
```

- [ ] **Step 2: Update JS module path in template**

In `crates/web/templates/index.html`, change:
```html
<script type="module" src="js/main.js"></script>
```
to:
```html
<script type="module" src="/static/js/main.js"></script>
```

- [ ] **Step 3: Update robot template fetch path in main.js**

In `crates/web/static/js/main.js`, change:
```javascript
const resp = await fetch('/robot-template.ts');
```
to:
```javascript
const resp = await fetch('/static/robot-template.ts');
```

- [ ] **Step 4: Commit**

```bash
git add crates/web/templates/index.html crates/web/static/js/main.js
git commit -m "Update asset paths to /static/ prefix"
```

---

## Task 4: Add Askama and wire up the index route

**Files:**
- Modify: `crates/web/Cargo.toml` — add `askama` and `askama_axum` dependencies
- Modify: `crates/web/src/routes.rs` — add `IndexTemplate` struct and `index` handler
- Modify: `crates/web/src/main.rs` — replace fallback with index route + static file serving

- [ ] **Step 1: Add Askama dependencies to web/Cargo.toml**

Add to `[dependencies]` in `crates/web/Cargo.toml`:
```toml
askama = "0.13"
askama_axum = "0.5"
```

- [ ] **Step 2: Add IndexTemplate and index handler to routes.rs**

Add at the top of `crates/web/src/routes.rs`:
```rust
use askama::Template;
```

Add the template struct and handler (before or after existing handlers):
```rust
#[derive(Template)]
#[template(path = "index.html")]
pub struct IndexTemplate;

pub async fn index() -> IndexTemplate {
    IndexTemplate
}
```

- [ ] **Step 3: Update main.rs router**

In `crates/web/src/main.rs`, replace:
```rust
.fallback_service(ServeDir::new("../client"))
```
with:
```rust
.route("/", get(routes::index))
.nest_service("/static", ServeDir::new("crates/web/static"))
```

- [ ] **Step 4: Verify build**

Run: `cargo build` from project root
Expected: Successful compilation (Askama validates template at compile time)

- [ ] **Step 5: Verify tests**

Run: `cargo test` from project root
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add crates/web/Cargo.toml crates/web/src/routes.rs crates/web/src/main.rs
git commit -m "Add Askama templating, serve index via route instead of static fallback"
```

---

## Task 5: Update CLAUDE.md and verify end-to-end

**Files:**
- Modify: `CLAUDE.md` — update structure description and run commands

- [ ] **Step 1: Update CLAUDE.md**

Key changes:
- Remove all `cd server` references — workspace is at project root
- Server starts with `cargo run -p web` (must run from project root)
- Remove `client/` references — templates in `crates/web/templates/`, static assets in `crates/web/static/`
- Note Askama in the architecture section

- [ ] **Step 2: Manual verification**

Run: `cargo run -p web` from project root
Verify:
1. `http://localhost:3000` renders the full page
2. CSS loads (`/static/style.css`)
3. JS loads (`/static/js/main.js`)
4. Robot template loads in editor (`/static/robot-template.ts`)
5. Create match → join → submit code → watch replay flow works

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Update CLAUDE.md for restructured project layout"
```
