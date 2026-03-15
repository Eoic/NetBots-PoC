import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { RobotInfo } from './renderer';

export const HP_BAR_WIDTH = 40;
export const HP_BAR_HEIGHT = 4;
export const HIT_RADIUS_PADDING = 2;

export interface RobotGraphic {
    graphic: Graphics;
    color: number;
}

export interface RobotLabel {
    container: Container;
    text: Text;
    hpBar: Graphics;
    hpBg: Graphics;
    color: number;
}

export interface RobotRenderState {
    x: number;
    y: number;
    heading: number;
    alive: boolean;
}

export interface ArenaTheme {
    sceneBackgroundCss: string;
    textColorCss: string;
    borderColor: number;
    gridColor: number;
    hpBackgroundColor: number;
    hpWarningColor: number;
    hpDangerColor: number;
    teamColors: number[];
    bulletFallbackColor: number;
}

export function numberToHexColor(color: number): string {
    return `#${Math.max(0, Math.min(0xffffff, color)).toString(16).padStart(6, '0')}`;
}

export function colorForRobot(
    robotIndex: number,
    robotInfos: RobotInfo[],
    theme: ArenaTheme,
    maxTeams: number,
): number {
    const info = robotInfos[robotIndex];

    if (!info)
        return 0xffffff;

    const team = Math.max(0, Math.min(maxTeams - 1, info.team));
    return theme.teamColors[team];
}

export function createRobotVisual(
    viewport: Viewport,
    theme: ArenaTheme,
    index: number,
    robotInfos: RobotInfo[],
    robotSize: number,
    renderScale: number,
    maxTeams: number,
): { graphic: RobotGraphic; label: RobotLabel; state: RobotRenderState } {
    const info = robotInfos[index];
    const color = colorForRobot(index, robotInfos, theme, maxTeams);

    const graphic = new Graphics();
    graphic.circle(0, 0, robotSize);
    graphic.fill({ color, alpha: 0.3 });
    graphic.circle(0, 0, robotSize);
    graphic.stroke({ color, width: 2 });
    graphic.moveTo(0, 0);
    graphic.lineTo(robotSize + 8, 0);
    graphic.stroke({ color, width: 3 });
    viewport.addChild(graphic);

    const labelContainer = new Container();
    const textStyle = new TextStyle({
        fontSize: 11,
        fill: theme.textColorCss,
        fontFamily: 'JetBrains Mono, Roboto Mono, monospace',
        fontWeight: 'bold',
    });
    const text = new Text({ text: info.name, style: textStyle });
    text.anchor.set(0.5, 0);
    text.resolution = renderScale * 2;
    labelContainer.addChild(text);

    const hpBg = new Graphics();
    hpBg.roundRect(-HP_BAR_WIDTH / 2, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT, 2);
    hpBg.fill({ color: theme.hpBackgroundColor, alpha: 0.65 });
    hpBg.y = text.height + 2;
    labelContainer.addChild(hpBg);

    const hpBar = new Graphics();
    hpBar.y = hpBg.y;
    labelContainer.addChild(hpBar);

    viewport.addChild(labelContainer);

    const label: RobotLabel = { container: labelContainer, text, hpBar, hpBg, color };
    const state: RobotRenderState = { x: 0, y: 0, heading: 0, alive: true };

    return { graphic: { graphic, color }, label, state };
}

export function clearRobotVisuals(
    viewport: Viewport,
    robotGraphics: RobotGraphic[],
    robotLabels: RobotLabel[],
): void {
    for (const robot of robotGraphics) {
        viewport.removeChild(robot.graphic);
        robot.graphic.destroy();
    }
    for (const label of robotLabels) {
        viewport.removeChild(label.container);
        label.container.destroy({ children: true });
    }
}

export function updateHealthBar(label: RobotLabel, energy: number, theme: ArenaTheme): void {
    const pct = Math.max(0, Math.min(1, energy / 100));
    const barW = HP_BAR_WIDTH * pct;

    let barColor: number;
    if (pct > 0.5) barColor = label.color;
    else if (pct > 0.25) barColor = theme.hpWarningColor;
    else barColor = theme.hpDangerColor;

    label.hpBar.clear();
    if (barW > 0) {
        label.hpBar.roundRect(-HP_BAR_WIDTH / 2, 0, barW, HP_BAR_HEIGHT, 2);
        label.hpBar.fill(barColor);
    }
}

export function pickRobotAtPoint(
    worldX: number,
    worldY: number,
    robotInfos: RobotInfo[],
    robotRenderStates: RobotRenderState[],
    robotSize: number,
): number {
    let closestIndex = -1;
    let closestDistanceSq = Number.POSITIVE_INFINITY;
    const hitRadiusSq = (robotSize + HIT_RADIUS_PADDING) * (robotSize + HIT_RADIUS_PADDING);

    for (let i = 0; i < robotInfos.length && i < robotRenderStates.length; i++) {
        const state = robotRenderStates[i];
        const dx = state.x - worldX;
        const dy = state.y - worldY;
        const distSq = dx * dx + dy * dy;
        if (distSq > hitRadiusSq || distSq >= closestDistanceSq) {
            continue;
        }
        closestIndex = i;
        closestDistanceSq = distSq;
    }

    return closestIndex;
}
