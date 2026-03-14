export async function runSimulation(robots) {
    const resp = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ robots }),
    });
    return resp.json();
}
