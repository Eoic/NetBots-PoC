# Robot Manipulation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to drag-move and drag-rotate robots in the arena during pre-simulation preview.

**Architecture:** A new `manipulation.ts` module handles drag interactions via a deps interface (same pattern as `placement.ts`). The renderer gains a rotation handle graphic and two new exports (`hitTestRotationHandle`, `isPreviewMode`). The app wires everything together in `bootstrap()`.

**Tech Stack:** TypeScript, Pixi.js 8 (Graphics)

---

## Task 1: Add rotation handle and exports to `renderer.ts`

**Files:**
- Modify: `crates/web/assets/ts/renderer.ts`

- [ ] **Step 1: Add module-level state for the rotation handle and preview mode flag**

After line 81 (`let selectionMarker: Graphics | null = null;`), add:

```typescript
let rotationHandle: Graphics | null = null;
let previewModeActive = false;
```

- [ ] **Step 2: Create `ensureRotationHandle` function**

After `ensureSelectionMarker` (line 207), add:

```typescript
function ensureRotationHandle(): void {
    if (!viewport) return;
    if (!rotationHandle) {
        rotationHandle = new Graphics();
        rotationHandle.visible = false;
        viewport.addChild(rotationHandle);
    }
}
```

- [ ] **Step 3: Update `updateSelectionMarker` to position the rotation handle**

Replace the `updateSelectionMarker` function (lines 209-231) with:

```typescript
function updateSelectionMarker(robotInfos: RobotInfo[]): void {
    if (!viewport || !selectionMarker) {
        return;
    }
    if (!selectedRobotName) {
        selectionMarker.visible = false;
        if (rotationHandle) rotationHandle.visible = false;
        return;
    }

    const selectedIndex = robotInfos.findIndex((robot) => robot.name === selectedRobotName);
    if (selectedIndex < 0 || selectedIndex >= robotRenderStates.length) {
        selectionMarker.visible = false;
        if (rotationHandle) rotationHandle.visible = false;
        return;
    }

    const state = robotRenderStates[selectedIndex];
    const markerColor = cssColorToNumber(readCssVar('--nb-color-primary', '#61afef'), 0x61afef);
    selectionMarker.clear();
    selectionMarker.circle(state.x, state.y, ROBOT_SIZE + 7);
    selectionMarker.stroke({ color: markerColor, width: 2 });
    selectionMarker.visible = true;
    viewport.addChild(selectionMarker);

    if (rotationHandle && previewModeActive) {
        const headingRad = -(state.heading * Math.PI) / 180;
        const handleDist = ROBOT_SIZE + 16;
        const hx = state.x + Math.cos(headingRad) * handleDist;
        const hy = state.y + Math.sin(headingRad) * handleDist;
        rotationHandle.clear();
        rotationHandle.circle(hx, hy, 6);
        rotationHandle.fill({ color: markerColor, alpha: 0.9 });
        rotationHandle.circle(hx, hy, 6);
        rotationHandle.stroke({ color: 0xffffff, width: 1.5 });
        rotationHandle.visible = true;
        viewport.addChild(rotationHandle);
    } else if (rotationHandle) {
        rotationHandle.visible = false;
    }
}
```

- [ ] **Step 4: Call `ensureRotationHandle` alongside `ensureSelectionMarker`**

In `initArena` (line 311), after `ensureSelectionMarker();`, add:
```typescript
ensureRotationHandle();
```

In `renderPreview` (line 324), after `ensureSelectionMarker();`, add:
```typescript
ensureRotationHandle();
```

In `renderTick` (line 455), after `ensureSelectionMarker();`, add:
```typescript
ensureRotationHandle();
```

- [ ] **Step 5: Set `previewModeActive` in `renderPreview` and `renderTick`**

At the top of `renderPreview` (after the early return), add:
```typescript
previewModeActive = true;
```

At the top of `renderTick` (after the early return), add:
```typescript
previewModeActive = false;
```

- [ ] **Step 6: Export `hitTestRotationHandle` and `isPreviewMode`**

At the bottom of the file (before `export function destroy`), add:

```typescript
export function hitTestRotationHandle(clientX: number, clientY: number): boolean {
    if (!rotationHandle || !rotationHandle.visible || !selectedRobotName) {
        return false;
    }

    const worldPos = worldPositionFromClient(clientX, clientY);
    if (!worldPos) return false;

    const robotInfos = robotRenderStates;
    const idx = robotGraphics.findIndex((_, i) => robotRenderStates[i] && robotLabels[i]);
    if (idx < 0) return false;

    const selectedIdx = robotRenderStates.findIndex((_, i) =>
        i < robotLabels.length && robotLabels[i]?.text?.text === selectedRobotName,
    );
    if (selectedIdx < 0) return false;

    const state = robotRenderStates[selectedIdx];
    const headingRad = -(state.heading * Math.PI) / 180;
    const handleDist = ROBOT_SIZE + 16;
    const hx = state.x + Math.cos(headingRad) * handleDist;
    const hy = state.y + Math.sin(headingRad) * handleDist;

    const dx = worldPos.x - hx;
    const dy = worldPos.y - hy;
    return (dx * dx + dy * dy) <= 10 * 10;
}

export function isPreviewMode(): boolean {
    return previewModeActive;
}
```

- [ ] **Step 7: Reset `rotationHandle` in `destroy`**

In the `destroy` function, after `selectionMarker = null;`, add:
```typescript
rotationHandle = null;
```

- [ ] **Step 8: Typecheck**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run typecheck`
Expected: no type errors.

- [ ] **Step 9: Commit**

```bash
git add crates/web/assets/ts/renderer.ts
git commit -m "feat(renderer): add rotation handle and preview mode exports"
```

---

## Task 2: Create `manipulation.ts`

**Files:**
- Create: `crates/web/assets/ts/manipulation.ts`

- [ ] **Step 1: Create the file**

Create `crates/web/assets/ts/manipulation.ts`:

```typescript
import type { DomElements } from './dom';
import type { FileStore } from './file-store';
import type { RobotInfo, PreviewPlacementMap } from './renderer';

export interface ManipulationDeps {
    dom: DomElements;
    files: FileStore;
    worldPositionFromClient: (cx: number, cy: number) => { x: number; y: number } | null;
    renderPreview: (robotInfos: RobotInfo[], placements: PreviewPlacementMap) => void;
    hitTestRotationHandle: (cx: number, cy: number) => boolean;
    isPreviewMode: () => boolean;
    getSelectedRobotFileName: () => string | null;
    getSelectedRobotName: () => string | null;
    updateSelectedRobotPanel: () => void;
    pickRobotNameAtClient: (cx: number, cy: number) => string | null;
}

export function setupManipulation(deps: ManipulationDeps): { teardown: () => void } {
    const { dom, files } = deps;
    let dragMode: 'move' | 'rotate' | null = null;
    let dragRobotFileName: string | null = null;

    function onMouseDown(event: MouseEvent): void {
        if (event.button !== 0 || !deps.isPreviewMode()) return;

        const fileName = deps.getSelectedRobotFileName();
        const robotName = deps.getSelectedRobotName();
        if (!fileName || !robotName) return;

        if (deps.hitTestRotationHandle(event.clientX, event.clientY)) {
            dragMode = 'rotate';
            dragRobotFileName = fileName;
            event.preventDefault();
            return;
        }

        const picked = deps.pickRobotNameAtClient(event.clientX, event.clientY);
        if (picked === robotName) {
            dragMode = 'move';
            dragRobotFileName = fileName;
            event.preventDefault();
        }
    }

    function onMouseMove(event: MouseEvent): void {
        if (!dragMode || !dragRobotFileName) return;

        const worldPos = deps.worldPositionFromClient(event.clientX, event.clientY);
        if (!worldPos) return;

        event.preventDefault();

        if (dragMode === 'move') {
            files.setPlacement(dragRobotFileName, {
                x: worldPos.x,
                y: worldPos.y,
            });
        } else if (dragMode === 'rotate') {
            const robotInfos = files.getRobotInfos();
            const robotName = deps.getSelectedRobotName();
            if (!robotName) return;

            const placements = files.getPreviewPlacements();
            const currentPlacement = placements[robotName];
            if (!currentPlacement) return;

            const dx = worldPos.x - currentPlacement.x;
            const dy = worldPos.y - currentPlacement.y;
            const angleRad = Math.atan2(dy, dx);
            const heading = -(angleRad * 180) / Math.PI;

            files.setPlacement(dragRobotFileName, {
                x: currentPlacement.x,
                y: currentPlacement.y,
                heading,
            });
        }

        deps.renderPreview(files.getRobotInfos(), files.getPreviewPlacements());
        deps.updateSelectedRobotPanel();
    }

    function onMouseUp(_event: MouseEvent): void {
        if (!dragMode) return;
        dragMode = null;
        dragRobotFileName = null;
    }

    dom.arenaContainer.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return {
        teardown(): void {
            dom.arenaContainer.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        },
    };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run typecheck`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add crates/web/assets/ts/manipulation.ts
git commit -m "feat(frontend): add manipulation.ts for robot move/rotate"
```

---

## Task 3: Wire up manipulation in `app.ts`

**Files:**
- Modify: `crates/web/assets/ts/app.ts`

- [ ] **Step 1: Add imports**

After the existing import from `./placement` (line 6), add:

```typescript
import { setupManipulation, type ManipulationDeps } from './manipulation';
```

Add `hitTestRotationHandle` and `isPreviewMode` to the renderer import (line 8):

```typescript
import {
    destroy,
    getRobotSceneInfo,
    getArenaViewState,
    hitTestRotationHandle,
    initArena,
    isPreviewMode,
    pickRobotNameAtClient,
    refreshSelectedRobotMarker,
    renderPreview,
    renderTick,
    setSelectedRobot,
    worldPositionFromClient,
} from './renderer';
```

- [ ] **Step 2: Create manipulation deps and call `setupManipulation`**

After the `placementDeps` block (after line 113), add:

```typescript
const manipulationDeps: ManipulationDeps = {
    dom,
    files,
    worldPositionFromClient,
    renderPreview,
    hitTestRotationHandle,
    isPreviewMode,
    getSelectedRobotFileName: () => selectedRobotFileName,
    getSelectedRobotName: () => selectedRobotName,
    updateSelectedRobotPanel: () => updateSelectedRobotPanel(),
    pickRobotNameAtClient: (cx, cy) => pickRobotNameAtClient(cx, cy, currentRobotInfos()),
};
setupManipulation(manipulationDeps);
```

- [ ] **Step 3: Typecheck**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run typecheck`
Expected: no type errors.

- [ ] **Step 4: Build**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run build`
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add crates/web/assets/ts/app.ts
git commit -m "feat(frontend): wire up robot manipulation in bootstrap"
```

---

## Task 4: Verify everything works

**Files:** None (verification only)

- [ ] **Step 1: TypeScript typecheck**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run typecheck`
Expected: no type errors.

- [ ] **Step 2: Frontend build**

Run: `cd /home/karolis/Documents/Projects/NetBots/crates/web && npm run build`
Expected: builds successfully, outputs `static/dist/main.js` and `static/dist/style.css`.

- [ ] **Step 3: Rust build**

Run: `cargo build -p web`
Expected: compiles with no errors.
