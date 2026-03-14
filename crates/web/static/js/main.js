import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { runSimulation } from './api.js';
import { initArena, renderTick, destroy } from './renderer.js';

// --- State ---
const files = new Map(); // filename -> source code
let activeFile = null;
let editor = null; // CodeMirror EditorView
let replayData = null; // { ticks, robotInfos }
let playbackState = { playing: false, index: 0, speed: 1, rafId: null };
const templateCache = new Map();

// --- DOM ---
const arenaContainer = document.getElementById('arena');
const arenaOverlay = document.getElementById('arena-overlay');
const cmContainer = document.getElementById('codemirror-container');
const logsContainer = document.getElementById('logs-container');
const fileTreeEl = document.getElementById('file-tree');
const runBtn = document.getElementById('btn-run');
const addBotBtn = document.getElementById('btn-add-bot');
const templateSelect = document.getElementById('template-select');
const tabBtns = document.querySelectorAll('.tab');
const playPauseBtn = document.getElementById('btn-play-pause');
const restartBtn = document.getElementById('btn-restart');
const scrubber = document.getElementById('tick-scrubber');
const tickDisplay = document.getElementById('tick-display');
const speedBtns = document.querySelectorAll('.speed-btn');
const resultsSection = document.getElementById('results-section');
const resultText = document.getElementById('result-text');
const editorPanel = document.getElementById('editor-panel');

// --- CodeMirror Setup ---
function createEditor() {
    const state = EditorState.create({
        doc: '',
        extensions: [
            basicSetup,
            javascript({ typescript: true }),
            oneDark,
            EditorView.theme({
                '&': { height: '100%' },
                '.cm-scroller': { overflow: 'auto' },
            }),
        ],
    });
    editor = new EditorView({ state, parent: cmContainer });
}

function setEditorContent(text) {
    editor.setState(EditorState.create({
        doc: text,
        extensions: [
            basicSetup,
            javascript({ typescript: true }),
            oneDark,
            EditorView.theme({
                '&': { height: '100%' },
                '.cm-scroller': { overflow: 'auto' },
            }),
        ],
    }));
}

function getEditorContent() {
    return editor.state.doc.toString();
}

// --- File Management ---
function saveCurrentFile() {
    if (activeFile && files.has(activeFile)) {
        files.set(activeFile, getEditorContent());
    }
}

function switchToFile(filename) {
    saveCurrentFile();
    activeFile = filename;
    setEditorContent(files.get(filename) || '');
    renderFileTree();
}

function renderFileTree() {
    fileTreeEl.innerHTML = '';
    for (const [name] of files) {
        const div = document.createElement('div');
        const isPlayer = name === 'my-bot.ts';
        const team = isPlayer ? 0 : 1;
        div.className = `file-item file-team-${team}${name === activeFile ? ' active' : ''}`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'file-name';
        nameSpan.textContent = name;
        div.appendChild(nameSpan);

        if (!isPlayer) {
            const del = document.createElement('span');
            del.className = 'file-delete';
            del.textContent = '\u00d7';
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                files.delete(name);
                if (activeFile === name) {
                    switchToFile('my-bot.ts');
                } else {
                    renderFileTree();
                }
            });
            div.appendChild(del);
        }

        div.addEventListener('click', () => switchToFile(name));
        fileTreeEl.appendChild(div);
    }
}

// --- Templates ---
async function loadTemplate(name) {
    if (templateCache.has(name)) return templateCache.get(name);
    try {
        const resp = await fetch(`/static/templates/${name}.ts`);
        const text = await resp.text();
        templateCache.set(name, text);
        return text;
    } catch {
        return `// Failed to load ${name} template`;
    }
}

async function loadPlayerTemplate() {
    try {
        const resp = await fetch('/static/robot-template.ts');
        return await resp.text();
    } catch {
        return '// Write your robot code here';
    }
}

function nextBotName(templateName) {
    let count = 1;
    while (files.has(`${templateName}-${count}.ts`)) count++;
    return `${templateName}-${count}.ts`;
}

// --- Add Bot ---
addBotBtn.addEventListener('click', async () => {
    const template = templateSelect.value;
    const name = nextBotName(template);
    const source = await loadTemplate(template);
    files.set(name, source);
    switchToFile(name);
});

// --- Tabs ---
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        cmContainer.classList.toggle('hidden', tab !== 'code');
        logsContainer.classList.toggle('hidden', tab !== 'logs');
    });
});

// --- Run ---
async function runGame() {
    saveCurrentFile();
    stopPlayback();

    runBtn.disabled = true;
    runBtn.textContent = 'Running...';
    runBtn.classList.add('loading');
    resultsSection.style.display = 'none';

    const robots = [];
    for (const [name, source] of files) {
        robots.push({
            name: name.replace('.ts', ''),
            source,
            team: name === 'my-bot.ts' ? 0 : 1,
        });
    }

    try {
        const result = await runSimulation(robots);

        // Show logs
        logsContainer.textContent = '';
        if (result.errors && result.errors.length > 0) {
            result.errors.forEach(err => {
                const header = document.createElement('div');
                header.className = 'log-error';
                header.textContent = `[${err.robot || 'error'}] ${err.error}`;
                logsContainer.appendChild(header);
            });
            // Switch to logs tab
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelector('[data-tab="logs"]').classList.add('active');
            cmContainer.classList.add('hidden');
            logsContainer.classList.remove('hidden');
        }

        if (result.logs) {
            result.logs.forEach(log => {
                if (log.messages.length > 0) {
                    const header = document.createElement('div');
                    header.className = 'log-robot-header';
                    header.textContent = `[${log.robot}]`;
                    logsContainer.appendChild(header);
                    log.messages.forEach(msg => {
                        const line = document.createElement('div');
                        line.textContent = `  ${msg}`;
                        logsContainer.appendChild(line);
                    });
                }
            });
        }

        if (!result.ok) {
            runBtn.disabled = false;
            runBtn.textContent = 'Run';
            runBtn.classList.remove('loading');
            return;
        }

        // Setup replay
        const replay = result.replay;
        const robotInfos = replay.robots;
        replayData = { ticks: replay.ticks, robotInfos };

        // Init arena
        destroy();
        arenaContainer.innerHTML = '';
        arenaOverlay.classList.add('hidden');
        await initArena(arenaContainer, replay.arena.width, replay.arena.height, robotInfos);

        // Setup scrubber
        scrubber.max = replay.ticks.length - 1;
        scrubber.value = 0;
        scrubber.disabled = false;
        playPauseBtn.disabled = false;
        restartBtn.disabled = false;

        // Show result
        resultsSection.style.display = '';
        if (result.winner_team === 0) {
            resultText.className = 'result-win';
            resultText.textContent = `You win! (${result.total_ticks} ticks)`;
        } else if (result.winner_team != null) {
            resultText.className = 'result-lose';
            resultText.textContent = `You lose. (${result.total_ticks} ticks)`;
        } else {
            resultText.className = 'result-draw';
            resultText.textContent = `Draw. (${result.total_ticks} ticks)`;
        }

        // Auto-play
        startPlayback();
    } catch (e) {
        logsContainer.textContent = `Error: ${e.message}`;
    } finally {
        runBtn.disabled = false;
        runBtn.textContent = 'Run';
        runBtn.classList.remove('loading');
    }
}

runBtn.addEventListener('click', runGame);

// Ctrl+Enter shortcut
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!runBtn.disabled) runGame();
    }
});

// --- Playback ---
function startPlayback() {
    if (!replayData) return;
    playbackState.playing = true;
    playPauseBtn.innerHTML = '&#10074;&#10074;'; // pause icon
    playbackStep();
}

function stopPlayback() {
    playbackState.playing = false;
    playPauseBtn.innerHTML = '&#9654;'; // play icon
    if (playbackState.rafId) {
        cancelAnimationFrame(playbackState.rafId);
        playbackState.rafId = null;
    }
}

let lastFrameTime = 0;
function playbackStep(timestamp) {
    if (!playbackState.playing || !replayData) return;

    if (!timestamp) {
        lastFrameTime = 0;
        playbackState.rafId = requestAnimationFrame(playbackStep);
        return;
    }

    if (!lastFrameTime) lastFrameTime = timestamp;
    const elapsed = timestamp - lastFrameTime;
    const interval = 1000 / (30 * playbackState.speed);

    if (elapsed >= interval) {
        lastFrameTime = timestamp;
        if (playbackState.index < replayData.ticks.length) {
            renderTick(replayData.ticks[playbackState.index], replayData.robotInfos);
            scrubber.value = playbackState.index;
            tickDisplay.textContent =
                `${playbackState.index + 1} / ${replayData.ticks.length}`;
            playbackState.index++;
        } else {
            stopPlayback();
            return;
        }
    }

    playbackState.rafId = requestAnimationFrame(playbackStep);
}

playPauseBtn.addEventListener('click', () => {
    if (playbackState.playing) {
        stopPlayback();
    } else {
        if (playbackState.index >= replayData.ticks.length) {
            playbackState.index = 0;
        }
        startPlayback();
    }
});

restartBtn.addEventListener('click', () => {
    stopPlayback();
    playbackState.index = 0;
    if (replayData) {
        renderTick(replayData.ticks[0], replayData.robotInfos);
        scrubber.value = 0;
        tickDisplay.textContent = `1 / ${replayData.ticks.length}`;
    }
});

scrubber.addEventListener('input', () => {
    if (!replayData) return;
    stopPlayback();
    const idx = parseInt(scrubber.value);
    playbackState.index = idx;
    renderTick(replayData.ticks[idx], replayData.robotInfos);
    tickDisplay.textContent = `${idx + 1} / ${replayData.ticks.length}`;
});

speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        speedBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        playbackState.speed = parseFloat(btn.dataset.speed);
    });
});

// --- Resize Handle ---
const resizeHandle = document.getElementById('resize-handle');
let isResizing = false;

resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const leftCol = document.querySelector('.left-column');
    const rect = leftCol.getBoundingClientRect();
    const newEditorHeight = rect.bottom - e.clientY;
    const clamped = Math.max(100, Math.min(newEditorHeight, rect.height - 200));
    editorPanel.style.flex = 'none';
    editorPanel.style.height = clamped + 'px';
});

document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }
});

// --- Init ---
async function init() {
    createEditor();
    const playerSource = await loadPlayerTemplate();
    files.set('my-bot.ts', playerSource);
    switchToFile('my-bot.ts');
}

init();
