import type { RobotInfo, TickData } from './renderer';

export interface ReplayData {
    ticks: TickData[];
    robotInfos: RobotInfo[];
    arenaWidth: number;
    arenaHeight: number;
    playerTeam: number | null;
    winnerTeam: number | null;
    totalTicks: number;
}
