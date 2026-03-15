import { runSimulation } from './api';
import { dom } from './dom';
import { CodeEditor } from './editor';
import { FileStore } from './file-store';
import { LogPanel } from './logs';
import { ReplayController } from './replay';
import {
    destroy,
    getRobotSceneInfo,
    getArenaViewState,
    initArena,
    pickRobotNameAtClient,
    refreshSelectedRobotMarker,
    renderPreview,
    renderTick,
    setSelectedRobot,
    worldPositionFromClient,
} from './renderer';
import { TemplateLoader } from './templates';
import { ThemeController } from './theme';
import type { ReplayData } from './types';
import { setupEditorResize, setupTabs } from './ui';

const PAGE_LOADING_MIN_MS = 550;
const SCENE_LOADING_MIN_MS = 700;
const DEFAULT_SIMULATION_TICKS = 1000;
const MAX_SIMULATION_TICKS = 100_000;
const ENEMY_HEADING = 180;

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function ensureMinDuration(startedAt: number, minDurationMs: number): Promise<void> {
    const elapsed = performance.now() - startedAt;
    const remaining = minDurationMs - elapsed;
    if (remaining > 0) {
        await wait(remaining);
    }
}

export async function bootstrap(): Promise<void> {
    const pageLoadingStartedAt = performance.now();
    const editor = new CodeEditor(dom.cmContainer);
    const templates = new TemplateLoader();
    let replayData: ReplayData | null = null;
    let replay: ReplayController;
    const logs = new LogPanel(dom.logsContainer, {
        onTickSelected: (tickIndex) => {
            replay.showFrame(tickIndex);
        },
    });

    replay = new ReplayController({
        playPauseBtn: dom.playPauseBtn,
        restartBtn: dom.restartBtn,
        stepBackBtn: dom.stepBackBtn,
        stepForwardBtn: dom.stepForwardBtn,
        scrubber: dom.scrubber,
        tickDisplay: dom.tickDisplay,
        speedBtns: dom.speedBtns,
        onRenderTick: (tick, robotInfos) => {
            renderTick(tick, robotInfos, files.getColorOverrides());
            updateSelectedRobotPanel();
        },
        onLogTickEvents: (tick, tickIndex, events, robotInfos) =>
            logs.logTickEvents(tick, tickIndex, events, robotInfos),
        onLogMatchResult: (data) => logs.logMatchResult(data),
    });

    const files = new FileStore({
        fileTreeEl: dom.fileTreeEl,
        editor,
        onFilesChanged: async () => {
            stopPlacementMode?.();
            stopPlacementMode = null;
            replayData = null;
            replay.clearReplay();
            renderPreview(
                files.getRobotInfos(),
                files.getPreviewPlacements(),
                files.getColorOverrides(),
            );
            updateSimulationUiState();
        },
        canDeleteEnemyBots: () => replayData === null,
    });
    let stopPlacementMode: (() => void) | null = null;
    let selectedRobotFileName: string | null = null;
    let selectedRobotName: string | null = null;

    const themes = new ThemeController(dom.themeSelect, async () => {
        await onThemeChanged();
    });

    setupTabs({
        tabBtns: dom.tabBtns,
        cmContainer: dom.cmContainer,
        fileTreeEl: dom.fileTreeEl,
        logsContainer: dom.logsContainer,
    });
    setupEditorResize({
        resizeHandle: dom.resizeHandle,
        arenaPanel: dom.arenaPanel,
        editorOverlay: dom.editorOverlay,
    });

    dom.addBotBtn.addEventListener('click', async () => {
        stopPlacementMode?.();
        stopPlacementMode = null;

        if (replayData) {
            replayData = null;
            replay.clearReplay();
            await refreshArenaPreview();
        }

        const templateName = dom.templateSelect.value;
        const name = files.nextBotName(templateName);
        const source = await templates.loadTemplate(templateName);
        stopPlacementMode = startBotPlacementMode(name, source);
    });

    dom.runBtn.addEventListener('click', async () => {
        await runGame();
    });
    dom.clearSimulationBtn.addEventListener('click', () => {
        clearActiveSimulation();
    });
    dom.arenaContainer.addEventListener('click', (event) => {
        handleArenaClick(event);
    });
    document.addEventListener('mousedown', (event) => {
        handleGlobalPointerDown(event);
    });
    document.addEventListener('keydown', (event) => {
        handleGlobalKeyDown(event);
    });
    dom.robotNameInput.addEventListener('change', () => {
        if (replayData || !selectedRobotFileName) {
            return;
        }
        const updated = files.updateRobotMeta(selectedRobotFileName, {
            name: dom.robotNameInput.value,
        });
        if (!updated) {
            return;
        }
        selectedRobotName = updated.name;
        renderPreview(files.getRobotInfos(), files.getPreviewPlacements(), files.getColorOverrides());
        updateSelectedRobotPanel();
    });
    dom.robotTeamSelect.addEventListener('change', () => {
        if (replayData || !selectedRobotFileName) {
            return;
        }
        const beforeTeamChange = selectedRobotName
            ? getRobotSceneInfo(selectedRobotName, currentRobotInfos())
            : null;
        const team = Number.parseInt(dom.robotTeamSelect.value, 10);
        const updated = files.updateRobotMeta(selectedRobotFileName, { team });
        if (!updated) {
            return;
        }
        selectedRobotName = updated.name;
        if (beforeTeamChange) {
            files.setPlacement(selectedRobotFileName, {
                x: beforeTeamChange.x,
                y: beforeTeamChange.y,
                heading: beforeTeamChange.heading,
            });
        }
        renderPreview(files.getRobotInfos(), files.getPreviewPlacements(), files.getColorOverrides());
        updateSelectedRobotPanel();
    });
    dom.robotColorInput.addEventListener('input', () => {
        if (replayData || !selectedRobotFileName) {
            return;
        }
        const updated = files.updateRobotMeta(selectedRobotFileName, {
            color: dom.robotColorInput.value,
        });
        if (!updated) {
            return;
        }
        selectedRobotName = updated.name;
        renderPreview(files.getRobotInfos(), files.getPreviewPlacements(), files.getColorOverrides());
        updateSelectedRobotPanel();
    });

    function updateSimulationUiState(): void {
        dom.clearSimulationBtn.disabled = replayData === null;
        files.renderFileTree();
        updateSelectedRobotPanel();
    }

    function currentRobotInfos() {
        return replayData ? replayData.robotInfos : files.getRobotInfos();
    }

    function clearSelectedRobot(): void {
        selectedRobotFileName = null;
        selectedRobotName = null;
        dom.robotInspector.classList.add('hidden');
        setSelectedRobot(null);
        refreshSelectedRobotMarker(currentRobotInfos());
    }

    function updateSelectedRobotPanel(): void {
        if (!selectedRobotName) {
            dom.robotInspector.classList.add('hidden');
            setSelectedRobot(null);
            refreshSelectedRobotMarker(currentRobotInfos());
            return;
        }

        const robotInfos = currentRobotInfos();
        const robotInfo = getRobotSceneInfo(selectedRobotName, robotInfos);
        const fileName = files.findFileByRobotName(selectedRobotName);
        if (!robotInfo || !fileName) {
            clearSelectedRobot();
            return;
        }

        const meta = files.getRobotMeta(fileName);
        if (!meta) {
            clearSelectedRobot();
            return;
        }

        selectedRobotFileName = fileName;
        selectedRobotName = meta.name;
        setSelectedRobot(selectedRobotName);
        refreshSelectedRobotMarker(robotInfos);

        const editable = replayData === null;
        dom.robotNameInput.disabled = !editable;
        dom.robotTeamSelect.disabled = !editable;
        dom.robotColorInput.disabled = !editable;
        dom.robotNameInput.value = meta.name;
        dom.robotTeamSelect.value = String(meta.team);
        dom.robotColorInput.value = meta.color ?? robotInfo.colorHex;
        dom.robotPositionValue.textContent = `${robotInfo.x.toFixed(1)}, ${robotInfo.y.toFixed(1)}`;
        dom.robotStatusValue.textContent = robotInfo.alive
            ? `Alive - ${robotInfo.heading.toFixed(0)}deg`
            : `Destroyed - ${robotInfo.heading.toFixed(0)}deg`;
        dom.robotInspector.classList.remove('hidden');
    }

    function handleArenaClick(event: MouseEvent): void {
        if (stopPlacementMode) {
            return;
        }

        const pickedRobotName = pickRobotNameAtClient(
            event.clientX,
            event.clientY,
            currentRobotInfos(),
        );
        if (!pickedRobotName) {
            clearSelectedRobot();
            return;
        }

        if (selectedRobotName === pickedRobotName) {
            clearSelectedRobot();
            return;
        }

        selectedRobotName = pickedRobotName;
        selectedRobotFileName = files.findFileByRobotName(pickedRobotName);
        updateSelectedRobotPanel();
    }

    function handleGlobalPointerDown(event: MouseEvent): void {
        if (stopPlacementMode || !selectedRobotName) {
            return;
        }

        const target = event.target;
        if (target instanceof Element && dom.robotInspector.contains(target)) {
            return;
        }

        const pickedRobotName = pickRobotNameAtClient(
            event.clientX,
            event.clientY,
            currentRobotInfos(),
        );
        if (pickedRobotName) {
            return;
        }

        clearSelectedRobot();
    }

    function handleGlobalKeyDown(event: KeyboardEvent): void {
        if (event.key !== 'Escape' || stopPlacementMode || !selectedRobotName) {
            return;
        }
        clearSelectedRobot();
    }

    async function onThemeChanged(): Promise<void> {
        stopPlacementMode?.();
        stopPlacementMode = null;
        replay.stop();

        if (!replayData) {
            await refreshArenaPreview();
            return;
        }

        const currentFrameIndex = replay.getCurrentFrameIndex();
        const viewState = getArenaViewState();
        destroy();
        dom.arenaContainer.innerHTML = '';
        dom.arenaOverlay.classList.add('hidden');
        await initArena(
            dom.arenaContainer,
            replayData.arenaWidth,
            replayData.arenaHeight,
            replayData.robotInfos,
            viewState,
            files.getColorOverrides(),
        );
        replay.showFrame(currentFrameIndex);
    }

    async function refreshArenaPreview(): Promise<void> {
        if (replayData) {
            return;
        }

        const robotInfos = files.getRobotInfos();
        const viewState = getArenaViewState();
        destroy();
        dom.arenaContainer.innerHTML = '';
        dom.arenaOverlay.classList.add('hidden');
        await initArena(dom.arenaContainer, 1200, 800, robotInfos, viewState, files.getColorOverrides());
        renderPreview(robotInfos, files.getPreviewPlacements(), files.getColorOverrides());
        updateSimulationUiState();
    }

    function clearActiveSimulation(): void {
        stopPlacementMode?.();
        stopPlacementMode = null;
        replay.stop();
        replay.clearReplay();
        replayData = null;
        logs.clear();
        renderPreview(
            files.getRobotInfos(),
            files.getPreviewPlacements(),
            files.getColorOverrides(),
        );
        dom.arenaOverlay.classList.add('hidden');
        updateSimulationUiState();
    }

    async function runGame(): Promise<void> {
        stopPlacementMode?.();
        stopPlacementMode = null;
        files.saveCurrentFile();
        replay.stop();
        const simulationTicks = getSimulationTicks();
        const sceneLoadingStartedAt = performance.now();
        dom.sceneLoadingCover.classList.remove('hidden');

        dom.runBtn.disabled = true;
        dom.runBtn.textContent = 'Running...';
        dom.runBtn.classList.add('loading');
        logs.clear();
        logs.showLogsTab({
            tabBtns: dom.tabBtns,
            logTabBtn: dom.logTabBtn,
            cmContainer: dom.cmContainer,
            fileTreeEl: dom.fileTreeEl,
        });

        try {
            const result = await runSimulation(files.toRobotPayloads(), simulationTicks);

            logs.logErrors(result.errors);
            logs.logRobotMessages(result.logs);

            if (!result.ok) {
                return;
            }

            const replayPayload = result.replay;
            if (!replayPayload) {
                logs.append('Error: Missing replay data from server', 'log-error');
                return;
            }

            replayData = {
                ticks: replayPayload.ticks,
                robotInfos: replayPayload.robots,
                arenaWidth: replayPayload.arena.width,
                arenaHeight: replayPayload.arena.height,
                winnerTeam: result.winner_team ?? null,
                totalTicks: result.total_ticks ?? replayPayload.ticks.length,
            };
            logs.setReplayData(replayData);
            updateSimulationUiState();

            const viewState = getArenaViewState();
            destroy();
            dom.arenaContainer.innerHTML = '';
            dom.arenaOverlay.classList.add('hidden');
            await initArena(
                dom.arenaContainer,
                replayPayload.arena.width,
                replayPayload.arena.height,
                replayPayload.robots,
                viewState,
                files.getColorOverrides(),
            );

            logs.append(
                `Game started (${replayPayload.robots.map((robot) => robot.name).join(' vs ')})`,
                'log-robot-header',
            );

            replay.setReplay(replayData);
        } catch (e: unknown) {
            logs.append(`Error: ${e instanceof Error ? e.message : String(e)}`, 'log-error');
        } finally {
            await ensureMinDuration(sceneLoadingStartedAt, SCENE_LOADING_MIN_MS);
            dom.sceneLoadingCover.classList.add('hidden');
            dom.runBtn.disabled = false;
            dom.runBtn.textContent = 'Run';
            dom.runBtn.classList.remove('loading');
        }
    }

    function getSimulationTicks(): number {
        const raw = dom.simulationTicksInput.value.trim();
        const parsed = Number.parseInt(raw, 10);
        if (Number.isNaN(parsed)) {
            dom.simulationTicksInput.value = String(DEFAULT_SIMULATION_TICKS);
            return DEFAULT_SIMULATION_TICKS;
        }

        const clamped = Math.max(1, Math.min(parsed, MAX_SIMULATION_TICKS));
        dom.simulationTicksInput.value = String(clamped);
        return clamped;
    }

    function startBotPlacementMode(filename: string, source: string): () => void {
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
                renderPreview([...baseRobotInfos, pendingRobotInfo], placements, files.getColorOverrides());
                return;
            }
            renderPreview(baseRobotInfos, placements, files.getColorOverrides());
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
                        files.getColorOverrides(),
                    );
                }
            };

        const commitPlacement = (spawnX: number, spawnY: number): void => {
            files.setFile(filename, source);
            files.setPlacement(filename, {
                x: spawnX,
                y: spawnY,
                heading: ENEMY_HEADING,
            });
            replayData = null;
            replay.clearReplay();
            files.switchToFile(filename);
            cleanup(false);
            renderPreview(
                files.getRobotInfos(),
                files.getPreviewPlacements(),
                files.getColorOverrides(),
            );
            updateSimulationUiState();
            stopPlacementMode = null;
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
                heading: ENEMY_HEADING,
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
            stopPlacementMode = null;
        };

        renderPendingPreview();
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('keydown', onKeyDown, true);
        return cleanup;
    }

    try {
        themes.init();
        editor.create();
        const playerSource = await templates.loadPlayerTemplate();
        files.setFile('my-bot.ts', playerSource);
        files.switchToFile('my-bot.ts');
        await refreshArenaPreview();
    } finally {
        await ensureMinDuration(pageLoadingStartedAt, PAGE_LOADING_MIN_MS);
        dom.pageLoadingCover.classList.add('hidden');
    }
}
