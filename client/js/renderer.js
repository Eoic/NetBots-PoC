import { Application, Graphics, Text, TextStyle } from 'pixi.js';

let app = null;
let robotGraphics = [];
let bulletGraphics = [];
let energyTexts = [];

const COLORS = [0x00ff88, 0xff4444];
const ROBOT_SIZE = 18;

export async function initArena(container, width, height) {
    app = new Application();
    await app.init({
        width,
        height,
        background: '#1a1a2e',
        antialias: true,
    });
    container.appendChild(app.canvas);

    // Draw arena border
    const border = new Graphics();
    border.rect(0, 0, width, height);
    border.stroke({ color: 0x333355, width: 2 });
    app.stage.addChild(border);

    // Create robot graphics (triangles)
    for (let i = 0; i < 2; i++) {
        const g = new Graphics();
        drawRobot(g, COLORS[i]);
        app.stage.addChild(g);
        robotGraphics.push(g);

        // Energy text
        const style = new TextStyle({
            fontSize: 11,
            fill: COLORS[i],
            fontFamily: 'monospace',
        });
        const text = new Text({ text: '100', style });
        text.anchor.set(0.5, 0);
        app.stage.addChild(text);
        energyTexts.push(text);
    }

    return app;
}

function drawRobot(g, color) {
    // Body circle
    g.circle(0, 0, ROBOT_SIZE);
    g.fill({ color, alpha: 0.3 });
    g.circle(0, 0, ROBOT_SIZE);
    g.stroke({ color, width: 2 });
    // Aiming direction line
    g.moveTo(0, 0);
    g.lineTo(ROBOT_SIZE + 8, 0);
    g.stroke({ color, width: 3 });
}

export function renderTick(tickData) {
    if (!app) return;

    // Update robots
    tickData.robots.forEach((r, i) => {
        if (i >= robotGraphics.length) return;
        const g = robotGraphics[i];
        g.x = r.x;
        g.y = r.y;
        g.rotation = -(r.heading * Math.PI) / 180; // CW heading to canvas rotation
        g.visible = r.alive;
        g.alpha = r.alive ? 1.0 : 0.3;

        // Update energy text
        const text = energyTexts[i];
        text.text = Math.round(r.energy).toString();
        text.x = r.x;
        text.y = r.y + ROBOT_SIZE + 4;
        text.visible = r.alive;
    });

    // Clear old bullets
    bulletGraphics.forEach(b => {
        app.stage.removeChild(b);
        b.destroy();
    });
    bulletGraphics = [];

    // Draw new bullets
    if (tickData.bullets) {
        tickData.bullets.forEach(b => {
            const g = new Graphics();
            g.circle(0, 0, 3);
            g.fill(0xffff00);
            g.x = b.x;
            g.y = b.y;
            app.stage.addChild(g);
            bulletGraphics.push(g);
        });
    }
}

export function playReplay(ticks, onTick, onComplete) {
    let index = 0;

    function step() {
        if (index >= ticks.length) {
            if (onComplete) onComplete();
            return;
        }

        renderTick(ticks[index]);
        if (onTick) onTick(ticks[index], index, ticks.length);
        index++;

        requestAnimationFrame(step);
    }

    // Start at ~30fps using requestAnimationFrame
    // (actual frame rate depends on monitor, but this is fine for PoC)
    step();
}

export function destroy() {
    if (app) {
        app.destroy(true);
        app = null;
        robotGraphics = [];
        bulletGraphics = [];
        energyTexts = [];
    }
}
