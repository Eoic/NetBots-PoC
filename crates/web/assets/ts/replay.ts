import type { TickData, TickEvent, RobotInfo } from './renderer';
import type { ReplayData } from './types';

interface ReplayControllerDeps {
    playPauseBtn: HTMLButtonElement;
    restartBtn: HTMLButtonElement;
    stepBackBtn: HTMLButtonElement;
    stepForwardBtn: HTMLButtonElement;
    scrubber: HTMLInputElement;
    tickDisplay: HTMLDivElement;
    speedBtns: HTMLButtonElement[];
    onRenderTick: (tick: TickData, robotInfos: RobotInfo[]) => void;
    onLogTickEvents: (
        tick: number,
        tickIndex: number,
        events: TickEvent[] | undefined,
        robotInfos: RobotInfo[],
    ) => void;
    onLogMatchResult: (replayData: ReplayData) => void;
}

const PLAY_ICON_HTML = '<i class="fa-solid fa-play" aria-hidden="true"></i>';
const PAUSE_ICON_HTML = '<i class="fa-solid fa-pause" aria-hidden="true"></i>';

export class ReplayController {
    private replayData: ReplayData | null = null;
    private playing = false;
    private index = 0;
    private currentFrameIndex = 0;
    private speed = 1;
    private rafId: number | null = null;
    private lastFrameTime = 0;

    constructor(private readonly deps: ReplayControllerDeps) {
        this.bindControls();
        this.disableControls();
    }

    stop(): void {
        this.playing = false;
        this.deps.playPauseBtn.innerHTML = PLAY_ICON_HTML;
        this.deps.playPauseBtn.setAttribute('aria-label', 'Play replay');
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    clearReplay(): void {
        this.stop();
        this.replayData = null;
        this.index = 0;
        this.currentFrameIndex = 0;
        this.disableControls();
    }

    setReplay(replayData: ReplayData): void {
        this.stop();
        this.replayData = replayData;
        this.index = 0;
        this.currentFrameIndex = 0;

        this.deps.scrubber.max = String(replayData.ticks.length - 1);
        this.deps.scrubber.value = '0';
        this.deps.scrubber.disabled = false;
        this.deps.playPauseBtn.disabled = false;
        this.deps.restartBtn.disabled = false;
        this.deps.stepBackBtn.disabled = false;
        this.deps.stepForwardBtn.disabled = false;
        this.deps.tickDisplay.textContent = `0 / ${replayData.ticks.length}`;

        this.start();
    }

    getCurrentFrameIndex(): number {
        return this.currentFrameIndex;
    }

    showFrame(index: number): void {
        if (!this.replayData || this.replayData.ticks.length === 0) {
            return;
        }

        const clamped = Math.max(0, Math.min(index, this.replayData.ticks.length - 1));
        this.stop();
        this.index = clamped;
        this.renderTickAt(clamped);
        this.deps.scrubber.value = String(clamped);
        this.deps.tickDisplay.textContent = `${clamped + 1} / ${this.replayData.ticks.length}`;
    }

    private bindControls(): void {
        this.deps.playPauseBtn.addEventListener('click', () => {
            if (this.playing) {
                this.stop();
                return;
            }

            if (!this.replayData) {
                return;
            }
            if (this.index >= this.replayData.ticks.length) {
                this.index = 0;
            }
            this.start();
        });

        this.deps.restartBtn.addEventListener('click', () => {
            this.stop();
            this.index = 0;
            if (!this.replayData || this.replayData.ticks.length === 0) {
                return;
            }
            this.renderTickAt(0);
            this.deps.scrubber.value = '0';
            this.deps.tickDisplay.textContent = `1 / ${this.replayData.ticks.length}`;
        });

        this.deps.stepBackBtn.addEventListener('click', () => {
            this.stepBy(-1);
        });

        this.deps.stepForwardBtn.addEventListener('click', () => {
            this.stepBy(1);
        });

        this.deps.scrubber.addEventListener('input', () => {
            if (!this.replayData) return;
            this.stop();
            const idx = parseInt(this.deps.scrubber.value, 10);
            this.index = idx;
            this.renderTickAt(idx);
            this.deps.tickDisplay.textContent = `${idx + 1} / ${this.replayData.ticks.length}`;
        });

        this.deps.speedBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                this.deps.speedBtns.forEach((speedBtn) => speedBtn.classList.remove('active'));
                btn.classList.add('active');
                this.speed = parseFloat(btn.dataset.speed || '1');
            });
        });
    }

    private disableControls(): void {
        this.deps.scrubber.max = '0';
        this.deps.scrubber.value = '0';
        this.deps.scrubber.disabled = true;
        this.deps.playPauseBtn.disabled = true;
        this.deps.restartBtn.disabled = true;
        this.deps.stepBackBtn.disabled = true;
        this.deps.stepForwardBtn.disabled = true;
        this.deps.tickDisplay.textContent = '0 / 0';
    }

    private start(): void {
        if (!this.replayData) return;
        this.playing = true;
        this.deps.playPauseBtn.innerHTML = PAUSE_ICON_HTML;
        this.deps.playPauseBtn.setAttribute('aria-label', 'Pause replay');
        this.playbackStep();
    }

    private stepBy(delta: number): void {
        if (!this.replayData || this.replayData.ticks.length === 0) {
            return;
        }

        this.stop();
        const nextIndex = Math.max(
            0,
            Math.min(this.currentFrameIndex + delta, this.replayData.ticks.length - 1),
        );
        this.index = nextIndex;
        this.renderTickAt(nextIndex);
        this.deps.scrubber.value = String(nextIndex);
        this.deps.tickDisplay.textContent = `${nextIndex + 1} / ${this.replayData.ticks.length}`;
    }

    private renderTickAt(index: number): void {
        if (!this.replayData) {
            return;
        }
        const tick = this.replayData.ticks[index];
        if (!tick) {
            return;
        }
        this.currentFrameIndex = index;
        this.deps.onRenderTick(tick, this.replayData.robotInfos);
        this.deps.onLogTickEvents(tick.tick, index, tick.events, this.replayData.robotInfos);
    }

    private playbackStep = (timestamp?: number): void => {
        if (!this.playing || !this.replayData) return;

        if (!timestamp) {
            this.lastFrameTime = 0;
            this.rafId = requestAnimationFrame(this.playbackStep);
            return;
        }

        if (!this.lastFrameTime) this.lastFrameTime = timestamp;
        const elapsed = timestamp - this.lastFrameTime;
        const interval = 1000 / (30 * this.speed);

        if (elapsed >= interval) {
            this.lastFrameTime = timestamp;

            if (this.index < this.replayData.ticks.length) {
                const tick = this.replayData.ticks[this.index];
                this.currentFrameIndex = this.index;
                this.deps.onRenderTick(tick, this.replayData.robotInfos);
                this.deps.onLogTickEvents(
                    tick.tick,
                    this.index,
                    tick.events,
                    this.replayData.robotInfos,
                );
                this.deps.scrubber.value = String(this.index);
                this.deps.tickDisplay.textContent = `${this.index + 1} / ${this.replayData.ticks.length}`;
                this.index++;
            } else {
                this.deps.onLogMatchResult(this.replayData);
                this.stop();
                return;
            }
        }

        this.rafId = requestAnimationFrame(this.playbackStep);
    };
}
