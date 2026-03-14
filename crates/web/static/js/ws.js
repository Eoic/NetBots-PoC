export function connectToMatch(matchId, callbacks) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws/match/${matchId}`);

    ws.onopen = () => {
        if (callbacks.onOpen) callbacks.onOpen();
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            switch (msg.type) {
                case 'game_start':
                    if (callbacks.onGameStart) callbacks.onGameStart(msg);
                    break;
                case 'replay':
                    if (callbacks.onReplay) callbacks.onReplay(msg.ticks);
                    break;
                case 'game_over':
                    if (callbacks.onGameOver) callbacks.onGameOver(msg);
                    break;
                case 'error':
                    if (callbacks.onError) callbacks.onError(msg.message);
                    break;
            }
        } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
        }
    };

    ws.onerror = (err) => {
        if (callbacks.onError) callbacks.onError('WebSocket error');
    };

    ws.onclose = () => {
        if (callbacks.onClose) callbacks.onClose();
    };

    return ws;
}
