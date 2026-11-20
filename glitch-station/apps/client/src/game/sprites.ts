import Phaser from "phaser";
import { SUIT_COLORS, type Accessory, type Pattern } from "@glitch/shared";

/**
 * Phaser version of the suit in ui/suit.ts. Drawn around the feet so the
 * player's position is where they stand. Same shapes, same patterns.
 */

const K = 0.6; // svg units to pixels
const X = (x: number) => (x - 28) * K;
const Y = (y: number) => (y - 59) * K;

function drawPattern(g: Phaser.GameObjects.Graphics, p: Pattern): void {
  g.lineStyle(2.5 * K, 0x0b0d1a, 0.45);
  g.fillStyle(0x0b0d1a, 0.45);
  const line = (x1: number, y1: number, x2: number, y2: number) => g.lineBetween(X(x1), Y(y1), X(x2), Y(y2));
  switch (p) {
    case "plain": break;
    case "stripes": [30, 36, 42].forEach((y) => line(14, y, 42, y)); break;
    case "dots": [[21, 34], [35, 34], [28, 42]].forEach(([x, y]) => g.fillCircle(X(x!), Y(y!), 2.6 * K)); break;
    case "chevron": line(17, 32, 28, 39); line(28, 39, 39, 32); line(17, 40, 28, 47); line(28, 47, 39, 40); break;
    case "cross": line(28, 29, 28, 45); line(20, 37, 36, 37); break;
    case "ring": g.strokeCircle(X(28), Y(37), 6 * K); break;
    case "split": line(28, 26, 28, 52); break;
    case "diamond": g.fillPoints([{ x: X(28), y: Y(30) }, { x: X(34), y: Y(37) }, { x: X(28), y: Y(44) }, { x: X(22), y: Y(37) }], true); break;
    case "bars": [20, 28, 36].forEach((x) => line(x, 29, x, 45)); break;
    case "star": g.fillCircle(X(28), Y(37), 4 * K); line(28, 30, 28, 44); line(21, 37, 35, 37); break;
    case "wave": line(15, 36, 21, 32); line(21, 32, 27, 36); line(27, 36, 33, 32); line(33, 32, 41, 36); break;
    case "grid": line(21, 29, 21, 45); line(35, 29, 35, 45); line(15, 34, 41, 34); line(15, 41, 41, 41); break;
  }
}

function drawAccessory(g: Phaser.GameObjects.Graphics, a: Accessory): void {
  switch (a) {
    case "none": break;
    case "antenna": g.lineStyle(2.5 * K, 0xf2f4ff).lineBetween(X(28), Y(7), X(28), Y(0)); g.fillStyle(0xff5e7a).fillCircle(X(28), Y(0), 3 * K); break;
    case "cap": g.fillStyle(0xffb23d).fillEllipse(X(28), Y(10), 30 * K, 12 * K).fillRoundedRect(X(36), Y(9), 12 * K, 4 * K, 2 * K); break;
    case "halo": g.lineStyle(2.5 * K, 0xffe27a).strokeEllipse(X(28), Y(2), 24 * K, 7 * K); break;
    case "headset": g.lineStyle(3.5 * K, 0x0b0d1a).beginPath().arc(X(28), Y(22), 16 * K, Math.PI, 0).strokePath(); g.fillStyle(0x3de0ff).fillRoundedRect(X(8), Y(18), 7 * K, 10 * K, 3 * K); break;
    case "sprout": g.lineStyle(2.5 * K, 0x4dffb0).lineBetween(X(28), Y(8), X(28), Y(2)); g.fillStyle(0x4dffb0).fillEllipse(X(22), Y(2), 10 * K, 5 * K).fillEllipse(X(34), Y(2), 10 * K, 5 * K); break;
  }
}

export function drawSuit(g: Phaser.GameObjects.Graphics, color: number, accessory: Accessory): void {
  const c = SUIT_COLORS[color] ?? SUIT_COLORS[0]!;
  g.clear();
  g.fillStyle(0x000000, 0.35).fillEllipse(0, 0, 30 * K, 9 * K);
  g.fillStyle(c.hex, 0.85).fillRoundedRect(X(6), Y(26), 8 * K, 18 * K, 4 * K);
  g.fillStyle(c.hex).fillRoundedRect(X(14), Y(50), 11 * K, 9 * K, 4 * K).fillRoundedRect(X(31), Y(50), 11 * K, 9 * K, 4 * K);
  g.fillStyle(c.hex).fillRoundedRect(X(10), Y(8), 36 * K, 46 * K, 16 * K);
  drawPattern(g, c.pattern);
  g.fillStyle(0x0b0d1a).fillRoundedRect(X(25), Y(14), 22 * K, 13 * K, 6.5 * K);
  g.fillStyle(0x3de0ff).fillRoundedRect(X(28), Y(16.5), 16 * K, 8 * K, 4 * K);
  g.fillStyle(0xf2f4ff, 0.8).fillRoundedRect(X(30), Y(17.5), 5 * K, 2.5 * K, 1.2 * K);
  drawAccessory(g, accessory);
}

/** A fallen suit: lying on its side, with a broken visor. */
export function drawBody(g: Phaser.GameObjects.Graphics, color: number): void {
  const c = SUIT_COLORS[color] ?? SUIT_COLORS[0]!;
  g.clear();
  g.fillStyle(0x000000, 0.35).fillEllipse(0, 2, 40 * K, 12 * K);
  g.fillStyle(c.hex).fillRoundedRect(-22 * K, -14 * K, 40 * K, 22 * K, 10 * K);
  g.fillStyle(0x0b0d1a).fillRoundedRect(8 * K, -11 * K, 12 * K, 14 * K, 5 * K);
  g.lineStyle(2, 0xff5e7a).lineBetween(9 * K, -10 * K, 19 * K, 2 * K).lineBetween(19 * K, -10 * K, 9 * K, 2 * K);
  g.fillStyle(0xff5e7a, 0.8).fillCircle(-24 * K, -2 * K, 5 * K).fillCircle(-28 * K, 4 * K, 3 * K);
}

export class PlayerSprite {
  readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private facing = 1;
  private walkT = 0;

  constructor(scene: Phaser.Scene, name: string, color: number, accessory: Accessory, nameColor = "#EEF0FF") {
    this.body = scene.add.graphics();
    drawSuit(this.body, color, accessory);
    this.label = scene.add.text(0, -44, name, {
      fontFamily: "Inter, system-ui, sans-serif", fontSize: "12px", fontStyle: "bold", color: nameColor,
      stroke: "#0B0D1A", strokeThickness: 4,
    }).setOrigin(0.5, 1);
    this.container = scene.add.container(0, 0, [this.body, this.label]);
  }

  place(px: number, py: number, moving: boolean, ghost: boolean, dt: number, dirX = 0): void {
    if (dirX > 0.05) this.facing = 1;
    else if (dirX < -0.05) this.facing = -1;
    this.walkT = moving ? this.walkT + dt * 0.018 : 0;
    const bob = moving ? Math.abs(Math.sin(this.walkT)) * -2.5 : 0;
    this.body.setScale(this.facing, 1);
    this.body.y = bob + (ghost ? Math.sin(performance.now() / 300) * 2 - 6 : 0);
    this.container.setPosition(px, py);
    this.container.setAlpha(ghost ? 0.45 : 1);
    this.container.setDepth(py);
  }

  destroy(): void {
    this.container.destroy();
  }
}
