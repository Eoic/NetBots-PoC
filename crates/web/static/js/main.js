import { createMatch, joinMatch, submitCode } from './api.js';
import { connectToMatch } from './ws.js';
import { initArena, playReplay, destroy } from './renderer.js';

// State
let currentMatchId = null;
let currentToken = null;
let currentPlayerIndex = null;

// DOM elements
const editor = document.getElementById('code-editor');
const createBtn = document.getElementById('btn-create');
const joinBtn = document.getElementById('btn-join');
const submitBtn = document.getElementById('btn-submit');
const watchBtn = document.getElementById('btn-watch');
const matchIdInput = document.getElementById('match-id-input');
const matchIdDisplay = document.getElementById('match-id-display');
const arenaContainer = document.getElementById('arena');
const logContainer = document.getElementById('log');
const tickDisplay = document.getElementById('tick-display');

function log(message, type = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Load robot template
async function loadTemplate() {
    try {
        const resp = await fetch('/static/robot-template.ts');
        editor.value = await resp.text();
    } catch {
        editor.value = '// Failed to load template. Write your robot code here.';
    }
}

// Create match
createBtn.addEventListener('click', async () => {
    try {
        createBtn.disabled = true;
        const { match_id } = await createMatch();
        currentMatchId = match_id;
        matchIdDisplay.textContent = match_id;
        log(`Match created: ${match_id}`, 'success');

        // Auto-join
        const { token, player_index } = await joinMatch(match_id);
        currentToken = token;
        currentPlayerIndex = player_index;
        log(`Joined as Player ${player_index} (${player_index === 0 ? 'Green' : 'Red'})`, 'info');

        submitBtn.disabled = false;
        matchIdInput.value = match_id;
    } catch (e) {
        log(`Error: ${e.message}`, 'error');
        createBtn.disabled = false;
    }
});

// Join existing match
joinBtn.addEventListener('click', async () => {
    const matchId = matchIdInput.value.trim();
    if (!matchId) {
        log('Enter a match ID first', 'error');
        return;
    }

    try {
        joinBtn.disabled = true;
        currentMatchId = matchId;
        matchIdDisplay.textContent = matchId;

        const { token, player_index } = await joinMatch(matchId);
        currentToken = token;
        currentPlayerIndex = player_index;
        log(`Joined match ${matchId} as Player ${player_index} (${player_index === 0 ? 'Green' : 'Red'})`, 'info');

        submitBtn.disabled = false;
    } catch (e) {
        log(`Error: ${e.message}`, 'error');
        joinBtn.disabled = false;
    }
});

// Submit code
submitBtn.addEventListener('click', async () => {
    if (!currentMatchId || !currentToken) {
        log('Join a match first', 'error');
        return;
    }

    const source = editor.value;
    if (!source.trim()) {
        log('Write some robot code first', 'error');
        return;
    }

    try {
        submitBtn.disabled = true;
        log('Compiling and submitting robot code...', 'info');

        const result = await submitCode(currentMatchId, currentToken, source);

        if (!result.ok) {
            log(`Compilation error: ${result.error}`, 'error');
            submitBtn.disabled = false;
            return;
        }

        log('Code submitted successfully!', 'success');

        if (result.game_started) {
            log('Both players ready — game starting!', 'success');
            watchBtn.disabled = false;
            watchBtn.click(); // Auto-watch
        } else {
            log('Waiting for opponent to submit code...', 'info');
            // Poll for game start
            pollForGameStart();
        }
    } catch (e) {
        log(`Error: ${e.message}`, 'error');
        submitBtn.disabled = false;
    }
});

function pollForGameStart() {
    const interval = setInterval(async () => {
        try {
            const resp = await fetch(`/api/match/${currentMatchId}/status`);
            const status = await resp.json();
            if (status.has_replay) {
                clearInterval(interval);
                log('Game complete! Click Watch to see the replay.', 'success');
                watchBtn.disabled = false;
                watchBtn.click(); // Auto-watch
            }
        } catch {
            // Ignore polling errors
        }
    }, 1000);
}

// Watch replay
watchBtn.addEventListener('click', () => {
    if (!currentMatchId) {
        log('No match to watch', 'error');
        return;
    }

    watchBtn.disabled = true;
    log('Connecting to watch replay...', 'info');

    // Clear arena
    destroy();
    arenaContainer.innerHTML = '';

    connectToMatch(currentMatchId, {
        onOpen() {
            log('Connected to match', 'info');
        },
        async onGameStart(msg) {
            log(`Game: ${msg.players.map(p => p.name).join(' vs ')}`, 'info');
            await initArena(arenaContainer, msg.arena.width, msg.arena.height);
        },
        onReplay(ticks) {
            log(`Playing replay: ${ticks.length} ticks`, 'info');
            playReplay(ticks,
                (tick, index, total) => {
                    tickDisplay.textContent = `Tick ${tick.tick} / ${total}`;
                },
                () => {
                    log('Replay complete', 'info');
                }
            );
        },
        onGameOver(msg) {
            const winner = msg.winner !== null ? `Player ${msg.winner} (${msg.winner === 0 ? 'Green' : 'Red'})` : 'Draw';
            log(`Game Over! Winner: ${winner} (${msg.total_ticks} ticks)`, 'success');
            watchBtn.disabled = false;
        },
        onError(msg) {
            log(`Error: ${msg}`, 'error');
            watchBtn.disabled = false;
        },
        onClose() {
            log('Disconnected', 'info');
        }
    });
});

// Initialize
loadTemplate();
log('NetBots PoC ready. Create or join a match to begin.', 'info');
