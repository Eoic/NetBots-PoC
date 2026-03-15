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

    function onMouseUp(): void {
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
