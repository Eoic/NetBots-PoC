# Robot Manipulation in Preview Mode

## Goal

Allow users to move and rotate robots by dragging them in the arena during pre-simulation preview. Moving grabs the robot body; rotating grabs a handle at the tip of the heading line.

## Constraints

- Only active in preview mode (before Run). Disabled during replay playback.
- No new classes or trait hierarchies. Follows the existing `PlacementDeps` interface pattern from `placement.ts`.
- Positions clamped to arena bounds (robot radius inset, same as `worldPositionFromClient` already enforces).
- Single click still selects/deselects — manipulation only triggers on drag (mousedown → mousemove).

---

## Interaction Model

### Move

- User drags a selected robot's body to reposition it.
- On each mousemove, the placement is updated and `renderPreview()` is called for live feedback.
- Position is clamped to arena bounds minus robot radius.
- On mouseup, the final position is persisted via `files.setPlacement()`.

### Rotate

- When a robot is selected in preview mode, a rotation handle (small filled circle, ~6px radius) appears at the tip of the heading line.
- User drags the handle to rotate the robot.
- Heading is computed as `atan2(dy, dx)` from the robot center to the cursor, converted to the game's degree system.
- On mouseup, the final heading is persisted via `files.setPlacement()`.

### Priority

- Mousedown hit-tests the rotation handle first (it overlaps the body), then falls back to the robot body.
- Move and rotate are mutually exclusive per drag gesture.

---

## Module Design

### New file: `assets/ts/manipulation.ts`

Exports a single setup function:

```typescript
interface ManipulationDeps {
    dom: DomElements;
    files: FileStore;
    worldPositionFromClient: (cx: number, cy: number) => { x: number; y: number } | null;
    renderPreview: (robotInfos: RobotInfo[], placements: PreviewPlacementMap) => void;
    hitTestRotationHandle: (cx: number, cy: number) => boolean;
    getSelectedRobotFileName: () => string | null;
    updateSelectedRobotPanel: () => void;
}

export function setupManipulation(deps: ManipulationDeps): {
    teardown: () => void;
};
```

- Called once during `bootstrap()`.
- Registers `mousedown`, `mousemove`, `mouseup` on `dom.arenaContainer`.
- Internal state: `dragMode: 'move' | 'rotate' | null`.
- On mousedown: if a robot is selected and we're in preview mode, hit-test rotation handle first, then robot body. Set `dragMode` accordingly.
- On mousemove: if `dragMode` is set, update position or heading, call `renderPreview()` and `updateSelectedRobotPanel()`.
- On mouseup: persist to `files.setPlacement()`, reset `dragMode`.
- Returns `{ teardown }` to remove listeners if needed.

### Changes to `renderer.ts`

- Add a `rotationHandle` graphic (filled circle, ~6px radius) attached to the selection marker group. Positioned at the tip of the selected robot's heading line. Only visible when a robot is selected in preview mode.
- Export `hitTestRotationHandle(clientX: number, clientY: number): boolean` — converts client coords to world coords, returns true if within ~10px of the handle center.
- Export `isPreviewMode(): boolean` — returns true when the renderer is showing preview (no replay tick data active). Manipulation module uses this to know when to activate.

### Changes to `app.ts`

- Import `setupManipulation` and call it in `bootstrap()` with deps wired up.
- Existing `handleArenaClick` selection logic unchanged — single clicks still select/deselect. Manipulation only activates when a drag gesture is detected (mousedown followed by mousemove).

---

## Out of Scope

- Keyboard shortcuts for rotation (arrow keys, etc.)
- Multi-robot selection or group manipulation
- Snap-to-grid or alignment guides
- Manipulation during replay playback
