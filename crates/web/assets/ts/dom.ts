function requiredEl<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing required element: #${id}`);
    }
    return element as T;
}

const logTabBtn = document.querySelector<HTMLButtonElement>('[data-tab="logs"]');
if (!logTabBtn) {
    throw new Error('Missing required element: [data-tab="logs"]');
}

export const dom = {
    arenaContainer: requiredEl<HTMLDivElement>('arena'),
    arenaOverlay: requiredEl<HTMLDivElement>('arena-overlay'),
    robotInspector: requiredEl<HTMLDivElement>('robot-inspector'),
    robotNameInput: requiredEl<HTMLInputElement>('robot-name-input'),
    robotTeamSelect: requiredEl<HTMLSelectElement>('robot-team-select'),
    robotPositionValue: requiredEl<HTMLSpanElement>('robot-position-value'),
    robotStatusValue: requiredEl<HTMLSpanElement>('robot-status-value'),
    pageLoadingCover: requiredEl<HTMLDivElement>('page-loading-cover'),
    sceneLoadingCover: requiredEl<HTMLDivElement>('scene-loading-cover'),
    cmContainer: requiredEl<HTMLDivElement>('codemirror-container'),
    logsContainer: requiredEl<HTMLPreElement>('logs-container'),
    fileTreeEl: requiredEl<HTMLDivElement>('file-tree'),
    runBtn: requiredEl<HTMLButtonElement>('btn-run'),
    clearSimulationBtn: requiredEl<HTMLButtonElement>('btn-clear-sim'),
    simulationTicksInput: requiredEl<HTMLInputElement>('simulation-ticks'),
    addBotBtn: requiredEl<HTMLButtonElement>('btn-add-bot'),
    templateSelect: requiredEl<HTMLSelectElement>('template-select'),
    tabBtns: Array.from(document.querySelectorAll<HTMLButtonElement>('.tab')),
    playPauseBtn: requiredEl<HTMLButtonElement>('btn-play-pause'),
    restartBtn: requiredEl<HTMLButtonElement>('btn-restart'),
    stepBackBtn: requiredEl<HTMLButtonElement>('btn-step-back'),
    stepForwardBtn: requiredEl<HTMLButtonElement>('btn-step-forward'),
    scrubber: requiredEl<HTMLInputElement>('tick-scrubber'),
    tickDisplay: requiredEl<HTMLDivElement>('tick-display'),
    speedBtns: Array.from(document.querySelectorAll<HTMLButtonElement>('.speed-btn')),
    logTabBtn,
    resizeHandle: requiredEl<HTMLDivElement>('resize-handle'),
    arenaPanel: requiredEl<HTMLDivElement>('arena-panel'),
    editorOverlay: requiredEl<HTMLDivElement>('editor-overlay'),
};

export type DomElements = typeof dom;
