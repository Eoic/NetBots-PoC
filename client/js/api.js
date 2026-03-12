const API_BASE = '/api';

export async function createMatch() {
    const resp = await fetch(`${API_BASE}/match/create`, { method: 'POST' });
    if (!resp.ok) throw new Error('Failed to create match');
    return resp.json();
}

export async function joinMatch(matchId) {
    const resp = await fetch(`${API_BASE}/match/${matchId}/join`, { method: 'POST' });
    if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Failed to join match');
    }
    return resp.json();
}

export async function submitCode(matchId, token, source, language = 'assemblyscript') {
    const resp = await fetch(`${API_BASE}/match/${matchId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, language, token }),
    });
    if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || 'Failed to submit code');
    }
    return resp.json();
}

export async function matchStatus(matchId) {
    const resp = await fetch(`${API_BASE}/match/${matchId}/status`);
    if (!resp.ok) throw new Error('Failed to get match status');
    return resp.json();
}
