import { Application, Graphics, Text, TextStyle } from 'pixi.js';

let app = null;
let robotGraphics = [];
let bulletGraphics = [];
let labelTexts = [];

const TEAM_COLORS = [0x00ff88]; // team 0
const ENEMY_PALETTE = [0xff4444, 0xff8800, 0xaa44ff, 0x44ccff, 0xffff44, 0xff44aa];
const ROBOT_SIZE = 18;

function colorForRobot(robotIndex, robotInfos) {
    const info = robotInfos[robotIndex];
    if (!info) return 0xffffff;
    if (info.team === 0) return TEAM_COLORS[0];
    // Assign from enemy palette based on index among team-1 robots
    const enemyIndex = robotInfos
        .slice(0, robotIndex)
        .filter(r => r.team !== 0).length;
    return ENEMY_PALETTE[enemyIndex % ENEMY_PALETTE.length];
}

export async function initArena(container, width, height, robotInfos) {
    destroy();
    app = new Application();
    await app.init({
        width,
        height,
        background: '#1a1a2e',
        antialias: true,
    });
    container.appendChild(app.canvas);

    // Border
    const border = new Graphics();
    border.rect(0, 0, width, height);
    border.stroke({ color: 0x333355, width: 2 });
    app.stage.addChild(border);

    // Create robot graphics
    robotGraphics = [];
    labelTexts = [];
    for (let i = 0; i < robotInfos.length; i++) {
        const color = colorForRobot(i, robotInfos);

        const g = new Graphics();
        // Body circle
        g.circle(0, 0, ROBOT_SIZE);
        g.fill({ color, alpha: 0.3 });
        g.circle(0, 0, ROBOT_SIZE);
        g.stroke({ color, width: 2 });
        // Heading line
        g.moveTo(0, 0);
        g.lineTo(ROBOT_SIZE + 8, 0);
        g.stroke({ color, width: 3 });
        app.stage.addChild(g);
        robotGraphics.push({ graphic: g, color });

        // Label: name + energy
        const style = new TextStyle({
            fontSize: 10,
            fill: color,
            fontFamily: 'monospace',
        });
        const text = new Text({ text: robotInfos[i].name, style });
        text.anchor.set(0.5, 0);
        app.stage.addChild(text);
        labelTexts.push(text);
    }

    return app;
}

export function renderTick(tickData, robotInfos) {
    if (!app) return;

    // Update robots
    tickData.robots.forEach((r, i) => {
        if (i >= robotGraphics.length) return;
        const { graphic } = robotGraphics[i];
        graphic.x = r.x;
        graphic.y = r.y;
        graphic.rotation = -(r.heading * Math.PI) / 180;
        graphic.visible = r.alive;
        graphic.alpha = r.alive ? 1.0 : 0.2;

        // Label
        const label = labelTexts[i];
        label.text = `${robotInfos[i].name} ${Math.round(r.energy)}`;
        label.x = r.x;
        label.y = r.y + ROBOT_SIZE + 4;
        label.visible = r.alive;
    });

    // Clear old bullets
    bulletGraphics.forEach(b => {
        app.stage.removeChild(b);
        b.destroy();
    });
    bulletGraphics = [];

    // Draw bullets colored by owner
    if (tickData.bullets) {
        tickData.bullets.forEach(b => {
            const g = new Graphics();
            const ownerIdx = b.owner_id;
            const color = (ownerIdx < robotGraphics.length)
                ? robotGraphics[ownerIdx].color
                : 0xffff00;
            g.circle(0, 0, 3);
            g.fill(color);
            g.x = b.x;
            g.y = b.y;
            app.stage.addChild(g);
            bulletGraphics.push(g);
        });
    }
}

export function destroy() {
    if (app) {
        app.destroy(true);
        app = null;
        robotGraphics = [];
        bulletGraphics = [];
        labelTexts = [];
    }
}
