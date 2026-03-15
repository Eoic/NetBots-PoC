import type { TickEvent, RobotInfo } from './renderer';
import type { ReplayData } from './types';

interface LogTabControls {
    tabBtns: HTMLButtonElement[];
    logTabBtn: HTMLButtonElement;
    cmContainer: HTMLDivElement;
    fileTreeEl: HTMLDivElement;
}

interface LogPanelOptions {
    onTickSelected: (tickIndex: number) => void;
}

interface LogEntry {
    text: string;
    className?: string;
    tickIndex?: number;
}

export class LogPanel {
    private readonly staticEntries: LogEntry[] = [];
    private readonly tickEntries = new Map<number, LogEntry[]>();
    private tickIndices: number[] = [];
    private currentTickIndex = -1;
    private matchResultEntry: LogEntry | null = null;
    private matchResultTickIndex = Number.MAX_SAFE_INTEGER;

    constructor(
        private readonly logsContainer: HTMLPreElement,
        private readonly options: LogPanelOptions,
    ) {
        this.logsContainer.addEventListener('click', (event) => {
            const target = event.target;

            if (!(target instanceof Element)) {
                return;
            }

            const line = target.closest<HTMLElement>('.log-line[data-tick-index]');

            if (!line) {
                return;
            }

            const rawIndex = line.dataset.tickIndex;

            if (!rawIndex) {
                return;
            }

            const tickIndex = Number.parseInt(rawIndex, 10);

            if (!Number.isNaN(tickIndex)) {
                this.options.onTickSelected(tickIndex);
            }
        });
    }

    clear(): void {
        this.staticEntries.length = 0;
        this.tickEntries.clear();
        this.tickIndices = [];
        this.currentTickIndex = -1;
        this.matchResultEntry = null;
        this.matchResultTickIndex = Number.MAX_SAFE_INTEGER;
        this.render();
    }

    append(text: string, className?: string): void {
        this.staticEntries.push({ text, className });
        this.render();
    }

    showLogsTab(controls: LogTabControls): void {
        controls.tabBtns.forEach((btn) => btn.classList.remove('active'));
        controls.logTabBtn.classList.add('active');
        controls.cmContainer.classList.add('hidden');
        controls.fileTreeEl.classList.add('hidden');
        this.logsContainer.classList.remove('hidden');
    }

    logErrors(errors?: Array<{ robot: string; error: string }>): void {
        if (!errors || errors.length === 0) {
            return;
        }

        errors.forEach((err) => {
            this.append(`[${err.robot || 'error'}] ${err.error}`, 'log-error');
        });
    }

    logRobotMessages(logs?: Array<{ robot: string; messages: string[] }>): void {
        if (!logs) {
            return;
        }

        logs.forEach((log) => {
            if (log.messages.length === 0) {
                return;
            }

            this.append(`[${log.robot}]`, 'log-robot-header');
            log.messages.forEach((msg) => this.append(`  ${msg}`));
        });
    }

    setReplayData(replayData: ReplayData): void {
        this.tickEntries.clear();
        this.tickIndices = [];
        this.currentTickIndex = -1;
        this.matchResultEntry = null;
        this.matchResultTickIndex = Number.MAX_SAFE_INTEGER;

        replayData.ticks.forEach((tickData, tickIndex) => {
            const entries = this.buildTickEntries(
                tickData.tick,
                tickIndex,
                tickData.events,
                replayData.robotInfos,
            );

            if (entries.length === 0) {
                return;
            }

            this.tickEntries.set(tickIndex, entries);
            this.tickIndices.push(tickIndex);
        });

        this.render();
    }

    logTickEvents(
        tick: number,
        tickIndex: number,
        events: TickEvent[] | undefined,
        robotInfos: RobotInfo[],
    ): void {
        if (!this.tickEntries.has(tickIndex)) {
            const entries = this.buildTickEntries(tick, tickIndex, events, robotInfos);

            if (entries.length > 0) {
                this.tickEntries.set(tickIndex, entries);
                this.tickIndices.push(tickIndex);
                this.tickIndices.sort((a, b) => a - b);
            }
        }

        this.currentTickIndex = tickIndex;
        this.render();
    }

    logMatchResult(replayData: ReplayData): void {
        const { winnerTeam, totalTicks, playerTeam } = replayData;

        if (winnerTeam != null && playerTeam != null && winnerTeam === playerTeam) {
            this.matchResultEntry = { text: `--- You win! (${totalTicks} ticks) ---`, className: 'log-result-win' };
        } else if (winnerTeam != null) {
            this.matchResultEntry = { text: `--- You lose. (${totalTicks} ticks) ---`, className: 'log-result-lose' };
        } else {
            this.matchResultEntry = { text: `--- Draw. (${totalTicks} ticks) ---`, className: 'log-result-draw' };
        }

        this.matchResultTickIndex = Math.max(0, replayData.ticks.length - 1);
        this.render();
    }

    private buildTickEntries(
        tick: number,
        tickIndex: number,
        events: TickEvent[] | undefined,
        robotInfos: RobotInfo[],
    ): LogEntry[] {
        if (!events || events.length === 0) {
            return [];
        }

        const entries: LogEntry[] = [];

        for (const evt of events) {
            if (evt.Hit) {
                const name = robotInfos[evt.Hit.robot_id]?.name || `robot-${evt.Hit.robot_id}`;
                entries.push({
                    text: `[tick ${tick}] ${name} hit for ${evt.Hit.damage.toFixed(1)} damage`,
                    className: 'log-hit',
                    tickIndex,
                });
            } else if (evt.RobotDied) {
                const name = robotInfos[evt.RobotDied.robot_id]?.name || `robot-${evt.RobotDied.robot_id}`;
                entries.push({
                    text: `[tick ${tick}] ${name} destroyed`,
                    className: 'log-death',
                    tickIndex,
                });
            } else if (evt.Collision) {
                const name = robotInfos[evt.Collision.robot_id]?.name || `robot-${evt.Collision.robot_id}`;
                entries.push({
                    text: `[tick ${tick}] ${name} collision (${evt.Collision.kind})`,
                    className: 'log-collision',
                    tickIndex,
                });
            }
        }

        return entries;
    }

    private createLine(entry: LogEntry, isActiveTick: boolean): HTMLDivElement {
        const div = document.createElement('div');
        div.classList.add('log-line');

        if (entry.className) {
            div.classList.add(entry.className);
        }

        if (typeof entry.tickIndex === 'number' && entry.tickIndex >= 0) {
            div.dataset.tickIndex = String(entry.tickIndex);
            div.classList.add('log-line-tick');
        }

        if (isActiveTick) {
            div.classList.add('log-line-active-tick');
        }

        div.textContent = entry.text;
        return div;
    }

    private render(): void {
        this.logsContainer.textContent = '';

        for (const entry of this.staticEntries) {
            this.logsContainer.appendChild(this.createLine(entry, false));
        }

        for (const tickIndex of this.tickIndices) {
            if (tickIndex > this.currentTickIndex) {
                break;
            }

            const entries = this.tickEntries.get(tickIndex);

            if (!entries) {
                continue;
            }

            for (const entry of entries) {
                const isActiveTick = tickIndex === this.currentTickIndex;
                this.logsContainer.appendChild(this.createLine(entry, isActiveTick));
            }
        }

        if (this.matchResultEntry && this.currentTickIndex >= this.matchResultTickIndex) {
            this.logsContainer.appendChild(this.createLine(this.matchResultEntry, false));
        }

        this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
    }
}
