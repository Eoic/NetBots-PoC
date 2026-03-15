export interface RobotPayload {
    name: string;
    source: string;
    team: number;
    spawn?: {
        x: number;
        y: number;
        heading?: number;
    };
}

export interface SimulationResponse {
    ok: boolean;
    replay?: {
        arena: { width: number; height: number };
        robots: Array<{ name: string; team: number }>;
        ticks: Array<{
            tick: number;
            robots: Array<{
                x: number;
                y: number;
                heading: number;
                alive: boolean;
                energy: number;
            }>;
            bullets?: Array<{ x: number; y: number; owner_id: number }>;
            events?: Array<{
                Hit?: { robot_id: number; damage: number };
                RobotDied?: { robot_id: number };
                Collision?: { robot_id: number; kind: string };
            }>;
        }>;
    };
    winner_team?: number | null;
    total_ticks?: number;
    errors?: Array<{ robot: string; error: string }>;
    logs?: Array<{ robot: string; messages: string[] }>;
}

export async function runSimulation(
    robots: RobotPayload[],
    maxTicks: number,
): Promise<SimulationResponse> {
    const resp = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ robots, max_ticks: maxTicks }),
    });

    return resp.json() as Promise<SimulationResponse>;
}
