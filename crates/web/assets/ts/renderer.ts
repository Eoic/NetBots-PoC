import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
import { Viewport } from 'pixi-viewport';

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

interface RobotGraphic {
    graphic: Graphics;
    color: number;
}

interface RobotLabel {
    container: Container;
    text: Text;
    hpBar: Graphics;
    hpBg: Graphics;
    color: number;
}

interface RobotRenderState {
    x: number;
    y: number;
    heading: number;
    alive: boolean;
}

interface ArenaTheme {
    sceneBackgroundCss: string;
    textColorCss: string;
    borderColor: number;
    gridColor: number;
    hpBackgroundColor: number;
    hpWarningColor: number;
    hpDangerColor: number;
    teamColors: number[];
    enemyPalette: number[];
    bulletFallbackColor: number;
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
let arenaTheme: ArenaTheme = buildArenaTheme();
const ROBOT_SIZE = 18;
const HP_BAR_WIDTH = 40;
const HP_BAR_HEIGHT = 4;
const RENDER_SCALE = 2;

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
    const enemyVarNames = [
        '--nb-pixi-enemy-1',
        '--nb-pixi-enemy-2',
        '--nb-pixi-enemy-3',
        '--nb-pixi-enemy-4',
        '--nb-pixi-enemy-5',
        '--nb-pixi-enemy-6',
    ];
    const enemyFallbacks = [0xecc06c, 0xffb4ab, 0xd9c4a0, 0xb2cfa7, 0x9a8f80, 0xf6e0bb];

    return {
        sceneBackgroundCss: readCssVar('--nb-pixi-bg', '#201b13'),
        textColorCss: readCssVar('--nb-pixi-text', '#ece1d4'),
        borderColor: cssColorToNumber(readCssVar('--nb-pixi-border', '#9a8f80'), 0x9a8f80),
        gridColor: cssColorToNumber(readCssVar('--nb-pixi-grid', '#4e4639'), 0x4e4639),
        hpBackgroundColor: cssColorToNumber(readCssVar('--nb-pixi-hp-bg', '#4e4639'), 0x4e4639),
        hpWarningColor: cssColorToNumber(readCssVar('--nb-pixi-hp-warning', '#ecc06c'), 0xecc06c),
        hpDangerColor: cssColorToNumber(readCssVar('--nb-pixi-hp-danger', '#ffb4ab'), 0xffb4ab),
        teamColors: [cssColorToNumber(readCssVar('--nb-pixi-team-0', '#b2cfa7'), 0xb2cfa7)],
        enemyPalette: enemyVarNames.map((varName, index) =>
            cssColorToNumber(readCssVar(varName, '#ecc06c'), enemyFallbacks[index]),
        ),
        bulletFallbackColor: cssColorToNumber(readCssVar('--nb-pixi-enemy-1', '#ecc06c'), 0xecc06c),
    };
}

function numberToHexColor(color: number): string {
    return `#${Math.max(0, Math.min(0xffffff, color)).toString(16).padStart(6, '0')}`;
}

function colorForRobot(
    robotIndex: number,
    robotInfos: RobotInfo[],
    colorOverrides: Record<string, string>,
): number {
    const info = robotInfos[robotIndex];
    if (!info) return 0xffffff;
    const override = colorOverrides[info.name];
    if (override) {
        const parsed = cssColorToNumber(override, Number.NaN);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    if (info.team === 0) return arenaTheme.teamColors[0];
    const enemyIndex = robotInfos
        .slice(0, robotIndex)
        .filter((r) => r.team !== 0).length;
    return arenaTheme.enemyPalette[enemyIndex % arenaTheme.enemyPalette.length];
}

function buildRobotVisualSignature(
    robotInfos: RobotInfo[],
    colorOverrides: Record<string, string>,
): string {
    const robotsSignature = robotInfos.map((info) => `${info.name}|${info.team}`).join(';');
    const colorSignature = Object.keys(colorOverrides)
        .sort()
        .map((name) => `${name}:${colorOverrides[name]}`)
        .join(';');
    return `${robotsSignature}||${colorSignature}`;
}

function clearRobotVisuals(): void {
    if (!viewport) {
        robotGraphics = [];
        robotLabels = [];
        robotRenderStates = [];
        robotVisualSignature = '';
        return;
    }

    for (const robot of robotGraphics) {
        viewport.removeChild(robot.graphic);
        robot.graphic.destroy();
    }
    for (const label of robotLabels) {
        viewport.removeChild(label.container);
        label.container.destroy({ children: true });
    }

    robotGraphics = [];
    robotLabels = [];
    robotRenderStates = [];
    robotVisualSignature = '';
}

function createRobotVisual(
    index: number,
    robotInfos: RobotInfo[],
    colorOverrides: Record<string, string>,
): void {
    if (!viewport) {
        return;
    }
    const info = robotInfos[index];
    const color = colorForRobot(index, robotInfos, colorOverrides);

    const graphic = new Graphics();
    graphic.circle(0, 0, ROBOT_SIZE);
    graphic.fill({ color, alpha: 0.3 });
    graphic.circle(0, 0, ROBOT_SIZE);
    graphic.stroke({ color, width: 2 });
    graphic.moveTo(0, 0);
    graphic.lineTo(ROBOT_SIZE + 8, 0);
    graphic.stroke({ color, width: 3 });
    viewport.addChild(graphic);
    robotGraphics.push({ graphic, color });

    const labelContainer = new Container();
    const textStyle = new TextStyle({
        fontSize: 11,
        fill: arenaTheme.textColorCss,
        fontFamily: 'JetBrains Mono, Roboto Mono, monospace',
        fontWeight: 'bold',
    });
    const text = new Text({ text: info.name, style: textStyle });
    text.anchor.set(0.5, 0);
    text.resolution = RENDER_SCALE * 2;
    labelContainer.addChild(text);

    const hpBg = new Graphics();
    hpBg.roundRect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT, 2);
    hpBg.fill({ color: arenaTheme.hpBackgroundColor, alpha: 0.65 });
    hpBg.y = text.height + 2;
    labelContainer.addChild(hpBg);

    const hpBar = new Graphics();
    hpBar.y = hpBg.y;
    labelContainer.addChild(hpBar);

    viewport.addChild(labelContainer);
    robotLabels.push({
        container: labelContainer,
        text,
        hpBar,
        hpBg,
        color,
    });
    robotRenderStates.push({
        x: 0,
        y: 0,
        heading: 0,
        alive: true,
    });
}

function ensureRobotVisuals(robotInfos: RobotInfo[], colorOverrides: Record<string, string>): void {
    const nextSignature = buildRobotVisualSignature(robotInfos, colorOverrides);
    if (nextSignature === robotVisualSignature) {
        return;
    }

    clearRobotVisuals();
    for (let i = 0; i < robotInfos.length; i++) {
        createRobotVisual(i, robotInfos, colorOverrides);
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
    colorOverrides: Record<string, string> = {},
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
    const gridSpacing = 50;
    for (let x = gridSpacing; x < width; x += gridSpacing) {
        grid.moveTo(x, 0);
        grid.lineTo(x, height);
    }
    for (let y = gridSpacing; y < height; y += gridSpacing) {
        grid.moveTo(0, y);
        grid.lineTo(width, y);
    }
    grid.stroke({ color: arenaTheme.gridColor, width: 1 });
    viewport.addChild(grid);

    ensureSelectionMarker();
    ensureRobotVisuals(robotInfos, colorOverrides);
    updateSelectionMarker(robotInfos);

    return app;
}

export function renderPreview(
    robotInfos: RobotInfo[],
    placements: PreviewPlacementMap = {},
    colorOverrides: Record<string, string> = {},
): void {
    if (!app || !viewport) return;
    ensureRobotVisuals(robotInfos, colorOverrides);
    ensureSelectionMarker();
    const view = viewport;
    const arenaHeight = view.worldHeight;

    const team0 = robotInfos
        .map((r, i) => ({ ...r, idx: i }))
        .filter((r) => r.team === 0);
    const team1 = robotInfos
        .map((r, i) => ({ ...r, idx: i }))
        .filter((r) => r.team !== 0);

    robotInfos.forEach((info, i) => {
        if (i >= robotGraphics.length) return;
        const { graphic } = robotGraphics[i];

        let x: number;
        let y: number;
        let heading: number;
        const placement = placements[info.name];
        if (placement) {
            x = placement.x;
            y = placement.y;
            heading = placement.heading ?? (info.team === 0 ? 0 : 180);
        } else if (info.team === 0) {
            const posIdx = team0.findIndex((r) => r.idx === i);
            x = 100;
            y = (arenaHeight * (posIdx + 1)) / (team0.length + 1);
            heading = 0;
        } else {
            const posIdx = team1.findIndex((r) => r.idx === i);
            x = 550;
            y = (arenaHeight * (posIdx + 1)) / (team1.length + 1);
            heading = 180;
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
        updateHealthBar(label, 100);
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

    let closestIndex = -1;
    let closestDistanceSq = Number.POSITIVE_INFINITY;
    const hitRadiusSq = (ROBOT_SIZE + 2) * (ROBOT_SIZE + 2);

    for (let i = 0; i < robotInfos.length && i < robotRenderStates.length; i++) {
        const state = robotRenderStates[i];
        const dx = state.x - worldPos.x;
        const dy = state.y - worldPos.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > hitRadiusSq || distSq >= closestDistanceSq) {
            continue;
        }
        closestIndex = i;
        closestDistanceSq = distSq;
    }

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
    colorOverrides: Record<string, string> = {},
): void {
    if (!app || !viewport) return;
    ensureRobotVisuals(robotInfos, colorOverrides);
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
        updateHealthBar(label, robot.energy);
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

function updateHealthBar(label: RobotLabel, energy: number): void {
    const pct = Math.max(0, Math.min(1, energy / 100));
    const barW = HP_BAR_WIDTH * pct;

    let barColor: number;
    if (pct > 0.5) barColor = label.color;
    else if (pct > 0.25) barColor = arenaTheme.hpWarningColor;
    else barColor = arenaTheme.hpDangerColor;

    label.hpBar.clear();
    if (barW > 0) {
        label.hpBar.roundRect(-HP_BAR_WIDTH / 2, 0, barW, HP_BAR_HEIGHT, 2);
        label.hpBar.fill(barColor);
    }
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
