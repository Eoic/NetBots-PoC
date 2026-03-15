export interface RobotEntrypoint {
    name: string;
    file: string;    // path into files map
    team: number;
    spawn?: {
        x: number;
        y: number;
        heading?: number;
    };
}

export interface RunRequest {
    files: Record<string, string>;  // all files in the virtual FS
    robots: RobotEntrypoint[];
    max_ticks: number;
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
    request: RunRequest,
): Promise<SimulationResponse> {
    const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
    });

    return response.json() as Promise<SimulationResponse>;
}
