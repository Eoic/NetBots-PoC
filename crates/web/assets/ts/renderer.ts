import { Application, Graphics } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import {
    type ArenaTheme,
    type RobotGraphic,
    type RobotLabel,
    type RobotRenderState,
    clearRobotVisuals as clearRobotVisualsVisuals,
    createRobotVisual,
    numberToHexColor,
    pickRobotAtPoint,
    updateHealthBar,
} from './visuals';

export interface RobotInfo {
    name: string;
    team: number;
}

export interface TickRobotState {
    x: number;
    y: number;
    heading: number;
    alive: boolean;
    energy: number;
}

export interface TickBulletState {
    x: number;
    y: number;
    owner_id: number;
}

export interface TickEvent {
    Hit?: { robot_id: number; damage: number };
    RobotDied?: { robot_id: number };
    Collision?: { robot_id: number; kind: string };
}

export interface TickData {
    tick: number;
    robots: TickRobotState[];
    bullets?: TickBulletState[];
    events?: TickEvent[];
}

export interface ArenaViewState {
    centerX: number;
    centerY: number;
    scale: number;
    worldWidth: number;
    worldHeight: number;
}

export interface PreviewPlacement {
    x: number;
    y: number;
    heading?: number;
}

export type PreviewPlacementMap = Record<string, PreviewPlacement>;

export interface RobotSceneInfo {
    name: string;
    team: number;
    x: number;
    y: number;
    heading: number;
    alive: boolean;
    colorHex: string;
}

let app: Application | null = null;
let viewport: Viewport | null = null;
let robotGraphics: RobotGraphic[] = [];
let bulletGraphics: Graphics[] = [];
let robotLabels: RobotLabel[] = [];
let robotRenderStates: RobotRenderState[] = [];
let robotVisualSignature = '';
let selectedRobotName: string | null = null;
let selectionMarker: Graphics | null = null;
const ROBOT_SIZE = 18;
const RENDER_SCALE = 2;
const MAX_TEAMS = 16;
const GRID_SPACING = 50;
const TEAM_COLOR_FALLBACKS = [
    0x61afef, 0xc678dd, 0x98c379, 0xe06c75,
    0x56b6c2, 0xe5c07b, 0xd19a66, 0xbe5046,
    0x7f848e, 0x2bbac5, 0x8dc891, 0xff9e64,
    0x73daca, 0xb4befe, 0xf38ba8, 0xa6e3a1,
];
let arenaTheme: ArenaTheme = buildArenaTheme();

function readCssVar(name: string, fallback: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
}

function cssColorToNumber(color: string, fallback: number): number {
    const value = color.trim();
    if (value.startsWith('#')) {
        let hex = value.slice(1);
        if (hex.length === 3) {
            hex = hex.split('').map((char) => char + char).join('');
        }
        if (hex.length >= 6) {
            const parsed = Number.parseInt(hex.slice(0, 6), 16);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }
    }

    const rgbMatch = value.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);

    if (rgbMatch) {
        const [r, g, b] = rgbMatch.slice(1, 4).map((channel) =>
            Math.max(0, Math.min(255, Number.parseInt(channel, 10))),
        );

        return (r << 16) + (g << 8) + b;
    }

    return fallback;
}

function buildArenaTheme(): ArenaTheme {
    const teamColors = Array.from({ length: MAX_TEAMS }, (_, team) =>
        cssColorToNumber(
            readCssVar(`--nb-pixi-team-${team}`, `#${TEAM_COLOR_FALLBACKS[team].toString(16).padStart(6, '0')}`),
            TEAM_COLOR_FALLBACKS[team],
        ),
    );

    return {
        sceneBackgroundCss: readCssVar('--nb-pixi-bg', '#201b13'),
        textColorCss: readCssVar('--nb-pixi-text', '#ece1d4'),
        borderColor: cssColorToNumber(readCssVar('--nb-pixi-border', '#9a8f80'), 0x9a8f80),
        gridColor: cssColorToNumber(readCssVar('--nb-pixi-grid', '#4e4639'), 0x4e4639),
        hpBackgroundColor: cssColorToNumber(readCssVar('--nb-pixi-hp-bg', '#4e4639'), 0x4e4639),
        hpWarningColor: cssColorToNumber(readCssVar('--nb-pixi-hp-warning', '#ecc06c'), 0xecc06c),
        hpDangerColor: cssColorToNumber(readCssVar('--nb-pixi-hp-danger', '#ffb4ab'), 0xffb4ab),
        teamColors,
        bulletFallbackColor: teamColors[0],
    };
}

function defaultUnplacedPosition(index: number, worldWidth: number, worldHeight: number): { x: number; y: number } {
    const cols = 4;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = ROBOT_SIZE + 40 + (col * 120);
    const y = ROBOT_SIZE + 40 + (row * 100);
    return {
        x: Math.max(ROBOT_SIZE, Math.min(worldWidth - ROBOT_SIZE, x)),
        y: Math.max(ROBOT_SIZE, Math.min(worldHeight - ROBOT_SIZE, y)),
    };
}

function buildRobotVisualSignature(robotInfos: RobotInfo[]): string {
    return robotInfos.map((info) => `${info.name}|${info.team}`).join(';');
}

function clearRobotVisualsLocal(): void {
    if (!viewport) {
        robotGraphics = [];
        robotLabels = [];
        robotRenderStates = [];
        robotVisualSignature = '';
        return;
    }

    clearRobotVisualsVisuals(viewport, robotGraphics, robotLabels);

    robotGraphics = [];
    robotLabels = [];
    robotRenderStates = [];
    robotVisualSignature = '';
}

function ensureRobotVisuals(robotInfos: RobotInfo[]): void {
    const nextSignature = buildRobotVisualSignature(robotInfos);
    if (nextSignature === robotVisualSignature) {
        return;
    }

    clearRobotVisualsLocal();
    if (!viewport) return;
    for (let i = 0; i < robotInfos.length; i++) {
        const result = createRobotVisual(viewport, arenaTheme, i, robotInfos, ROBOT_SIZE, RENDER_SCALE, MAX_TEAMS);
        robotGraphics.push(result.graphic);
        robotLabels.push(result.label);
        robotRenderStates.push(result.state);
    }
    robotVisualSignature = nextSignature;
}

function ensureSelectionMarker(): void {
    if (!viewport) {
        return;
    }
    if (!selectionMarker) {
        selectionMarker = new Graphics();
        selectionMarker.visible = false;
        viewport.addChild(selectionMarker);
    }
}

function updateSelectionMarker(robotInfos: RobotInfo[]): void {
    if (!viewport || !selectionMarker) {
        return;
    }
    if (!selectedRobotName) {
        selectionMarker.visible = false;
        return;
    }

    const selectedIndex = robotInfos.findIndex((robot) => robot.name === selectedRobotName);
    if (selectedIndex < 0 || selectedIndex >= robotRenderStates.length) {
        selectionMarker.visible = false;
        return;
    }

    const state = robotRenderStates[selectedIndex];
    const markerColor = cssColorToNumber(readCssVar('--nb-color-primary', '#61afef'), 0x61afef);
    selectionMarker.clear();
    selectionMarker.circle(state.x, state.y, ROBOT_SIZE + 7);
    selectionMarker.stroke({ color: markerColor, width: 2 });
    selectionMarker.visible = true;
    viewport.addChild(selectionMarker);
}

export async function initArena(
    container: HTMLElement,
    width: number,
    height: number,
    robotInfos: RobotInfo[],
    viewState: ArenaViewState | null = null,
): Promise<Application> {
    destroy();
    arenaTheme = buildArenaTheme();

    const screenWidth = container.clientWidth || width;
    const screenHeight = container.clientHeight || height;

    app = new Application();
    await app.init({
        width: screenWidth,
        height: screenHeight,
        background: arenaTheme.sceneBackgroundCss,
        antialias: true,
        resolution: RENDER_SCALE,
        autoDensity: true,
    });

    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    app.canvas.style.display = 'block';
    container.appendChild(app.canvas);

    viewport = new Viewport({
        screenWidth,
        screenHeight,
        worldWidth: width,
        worldHeight: height,
        events: app.renderer.events,
    });
    app.stage.addChild(viewport);

    viewport
        .drag()
        .pinch()
        .wheel({ smooth: 3 })
        .decelerate({ friction: 0.93 })
        .clampZoom({ minScale: 0.5, maxScale: 5 });

    if (viewState) {
        const clampedScale = Math.max(0.5, Math.min(viewState.scale, 5));

        let centerX = viewState.centerX;
        let centerY = viewState.centerY;
        if (viewState.worldWidth > 0 && viewState.worldHeight > 0) {
            centerX = (viewState.centerX / viewState.worldWidth) * width;
            centerY = (viewState.centerY / viewState.worldHeight) * height;
        }

        viewport.setZoom(clampedScale, true);
        viewport.moveCenter(centerX, centerY);
    } else {
        viewport.fit(true, width, height);
        viewport.moveCenter(width / 2, height / 2);
    }

    const border = new Graphics();
    border.rect(0, 0, width, height);
    border.stroke({ color: arenaTheme.borderColor, width: 2 });
    viewport.addChild(border);

    const grid = new Graphics();
    for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
        grid.moveTo(x, 0);
        grid.lineTo(x, height);
    }
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
        grid.moveTo(0, y);
        grid.lineTo(width, y);
    }
    grid.stroke({ color: arenaTheme.gridColor, width: 1 });
    viewport.addChild(grid);

    ensureSelectionMarker();
    ensureRobotVisuals(robotInfos);
    updateSelectionMarker(robotInfos);

    return app;
}

export function renderPreview(
    robotInfos: RobotInfo[],
    placements: PreviewPlacementMap = {},
): void {
    if (!app || !viewport) return;
    ensureRobotVisuals(robotInfos);
    ensureSelectionMarker();
    const view = viewport;
    robotInfos.forEach((info, i) => {
        if (i >= robotGraphics.length) return;
        const { graphic } = robotGraphics[i];

        let x: number;
        let y: number;
        let heading: number;
        const previousState = robotRenderStates[i];
        const placement = placements[info.name];
        if (placement) {
            x = placement.x;
            y = placement.y;
            heading = placement.heading ?? previousState?.heading ?? 0;
        } else if (previousState) {
            x = previousState.x;
            y = previousState.y;
            heading = previousState.heading;
        } else {
            const fallback = defaultUnplacedPosition(i, view.worldWidth, view.worldHeight);
            x = fallback.x;
            y = fallback.y;
            heading = 0;
        }

        graphic.x = x;
        graphic.y = y;
        graphic.rotation = -(heading * Math.PI) / 180;
        graphic.visible = true;
        graphic.alpha = 1.0;
        robotRenderStates[i] = {
            x,
            y,
            heading,
            alive: true,
        };

        const label = robotLabels[i];
        label.container.x = x;
        label.container.y = y + ROBOT_SIZE + 4;
        label.container.visible = true;
        updateHealthBar(label, 100, arenaTheme);
    });

    bulletGraphics.forEach((bullet) => {
        view.removeChild(bullet);
        bullet.destroy();
    });
    bulletGraphics = [];
    updateSelectionMarker(robotInfos);
}

export function worldPositionFromClient(clientX: number, clientY: number): { x: number; y: number } | null {
    if (!app || !viewport) {
        return null;
    }

    const bounds = app.canvas.getBoundingClientRect();
    if (
        clientX < bounds.left ||
        clientX > bounds.right ||
        clientY < bounds.top ||
        clientY > bounds.bottom
    ) {
        return null;
    }

    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const point = viewport.toWorld(localX, localY);
    const minX = ROBOT_SIZE;
    const maxX = viewport.worldWidth - ROBOT_SIZE;
    const minY = ROBOT_SIZE;
    const maxY = viewport.worldHeight - ROBOT_SIZE;
    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) {
        return null;
    }
    return { x: point.x, y: point.y };
}

export function pickRobotNameAtClient(
    clientX: number,
    clientY: number,
    robotInfos: RobotInfo[],
): string | null {
    const worldPos = worldPositionFromClient(clientX, clientY);
    if (!worldPos) {
        return null;
    }

    const closestIndex = pickRobotAtPoint(worldPos.x, worldPos.y, robotInfos, robotRenderStates, ROBOT_SIZE);
    return closestIndex >= 0 ? robotInfos[closestIndex].name : null;
}

export function setSelectedRobot(name: string | null): void {
    selectedRobotName = name;
    if (!selectedRobotName && selectionMarker) {
        selectionMarker.visible = false;
    }
}

export function refreshSelectedRobotMarker(robotInfos: RobotInfo[]): void {
    updateSelectionMarker(robotInfos);
}

export function getRobotSceneInfo(name: string, robotInfos: RobotInfo[]): RobotSceneInfo | null {
    const index = robotInfos.findIndex((robot) => robot.name === name);

    if (index < 0 || index >= robotRenderStates.length || index >= robotGraphics.length) {
        return null;
    }

    const state = robotRenderStates[index];
    return {
        name,
        team: robotInfos[index].team,
        x: state.x,
        y: state.y,
        heading: state.heading,
        alive: state.alive,
        colorHex: numberToHexColor(robotGraphics[index].color),
    };
}

export function renderTick(
    tickData: TickData,
    robotInfos: RobotInfo[],
): void {
    if (!app || !viewport) return;
    ensureRobotVisuals(robotInfos);
    ensureSelectionMarker();
    const view = viewport;

    tickData.robots.forEach((robot, i) => {
        if (i >= robotGraphics.length) return;
        const { graphic } = robotGraphics[i];
        graphic.x = robot.x;
        graphic.y = robot.y;
        graphic.rotation = -(robot.heading * Math.PI) / 180;
        graphic.visible = robot.alive;
        graphic.alpha = robot.alive ? 1.0 : 0.2;
        robotRenderStates[i] = {
            x: robot.x,
            y: robot.y,
            heading: robot.heading,
            alive: robot.alive,
        };

        const label = robotLabels[i];
        label.container.x = robot.x;
        label.container.y = robot.y + ROBOT_SIZE + 4;
        label.container.visible = robot.alive;
        updateHealthBar(label, robot.energy, arenaTheme);
    });

    bulletGraphics.forEach((bullet) => {
        view.removeChild(bullet);
        bullet.destroy();
    });
    bulletGraphics = [];

    if (!tickData.bullets) {
        updateSelectionMarker(robotInfos);
        return;
    }

    tickData.bullets.forEach((bullet) => {
        const graphic = new Graphics();
        const ownerIdx = bullet.owner_id;
        const color =
            ownerIdx < robotGraphics.length
                ? robotGraphics[ownerIdx].color
                : arenaTheme.bulletFallbackColor;
        graphic.circle(0, 0, 3);
        graphic.fill(color);
        graphic.x = bullet.x;
        graphic.y = bullet.y;
        view.addChild(graphic);
        bulletGraphics.push(graphic);
    });
    updateSelectionMarker(robotInfos);
}

export function destroy(): void {
    if (!app) return;
    app.destroy(true);
    app = null;
    viewport = null;
    robotGraphics = [];
    bulletGraphics = [];
    robotLabels = [];
    robotRenderStates = [];
    selectionMarker = null;
    robotVisualSignature = '';
}

export function getArenaViewState(): ArenaViewState | null {
    if (!viewport) {
        return null;
    }

    return {
        centerX: viewport.center.x,
        centerY: viewport.center.y,
        scale: viewport.scale.x,
        worldWidth: viewport.worldWidth,
        worldHeight: viewport.worldHeight,
    };
}
