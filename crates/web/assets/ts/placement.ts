import type { DomElements } from './dom';
import type { FileStore } from './file-store';
import type { ReplayController } from './replay';
import type { RobotInfo, PreviewPlacementMap } from './renderer';

export const DEFAULT_ENEMY_HEADING = 180;

export interface PlacementDeps {
    dom: DomElements;
    files: FileStore;
    replay: ReplayController;
    worldPositionFromClient: (clientX: number, clientY: number) => { x: number; y: number } | null;
    renderPreview: (robotInfos: RobotInfo[], placements: PreviewPlacementMap) => void;
    updateSimulationUiState: () => void;
    clearReplayData: () => void;
    onPlacementEnd: () => void;
}

export function startBotPlacementMode(
    deps: PlacementDeps,
    filename: string,
    source: string,
): () => void {
    const { dom, files, replay, worldPositionFromClient, renderPreview, updateSimulationUiState, clearReplayData, onPlacementEnd } = deps;
    const pendingName = filename.replace('.ts', '');
    const baseRobotInfos = files.getRobotInfos();
    const pendingRobotInfo = { name: pendingName, team: 1 };
    let pendingPlacement: { x: number; y: number; heading: number } | null = null;

    dom.addBotBtn.disabled = true;
    dom.templateSelect.disabled = true;
    dom.arenaContainer.style.cursor = 'crosshair';
    dom.arenaOverlay.textContent = `Click in arena to place ${filename} (Esc to cancel)`;
    dom.arenaOverlay.classList.remove('hidden');

    const renderPendingPreview = (): void => {
        const placements = files.getPreviewPlacements();

        if (pendingPlacement) {
            placements[pendingName] = pendingPlacement;
            renderPreview([...baseRobotInfos, pendingRobotInfo], placements);
            return;
        }

        renderPreview(baseRobotInfos, placements);
    };

    const cleanup = (restorePreview = true): void => {
        document.removeEventListener('mousedown', onMouseDown, true);
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('keydown', onKeyDown, true);
        dom.arenaContainer.style.cursor = '';
        dom.addBotBtn.disabled = false;
        dom.templateSelect.disabled = false;
        dom.arenaOverlay.classList.add('hidden');

        if (restorePreview) {
            renderPreview(
                files.getRobotInfos(),
                files.getPreviewPlacements(),
            );
        }
    };

    const commitPlacement = (spawnX: number, spawnY: number): void => {
        files.setFile(filename, source);

        files.setPlacement(filename, {
            x: spawnX,
            y: spawnY,
            heading: DEFAULT_ENEMY_HEADING,
        });

        clearReplayData();
        replay.clearReplay();
        files.switchToFile(filename);
        cleanup(false);

        renderPreview(
            files.getRobotInfos(),
            files.getPreviewPlacements(),
        );

        updateSimulationUiState();
        onPlacementEnd();
    };

    const onMouseMove = (event: MouseEvent): void => {
        const spawn = worldPositionFromClient(event.clientX, event.clientY);

        if (!spawn) {
            if (pendingPlacement) {
                pendingPlacement = null;
                renderPendingPreview();
            }

            return;
        }

        pendingPlacement = {
            x: spawn.x,
            y: spawn.y,
            heading: DEFAULT_ENEMY_HEADING,
        };

        renderPendingPreview();
    };

    const onMouseDown = (event: MouseEvent): void => {
        if (event.button !== 0) {
            return;
        }

        const spawn = worldPositionFromClient(event.clientX, event.clientY);

        if (!spawn) {
            if (pendingPlacement) {
                pendingPlacement = null;
                renderPendingPreview();
            }

            return;
        }

        event.preventDefault();
        event.stopPropagation();
        commitPlacement(spawn.x, spawn.y);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') {
            return;
        }

        cleanup();
        onPlacementEnd();
    };

    renderPendingPreview();
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('keydown', onKeyDown, true);
    return cleanup;
}
