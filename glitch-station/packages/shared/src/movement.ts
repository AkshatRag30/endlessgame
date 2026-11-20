import { CONFIG } from "./config";
import { isWall, NO_BLOCK, type Blocked, type Point } from "./map";

/** Seconds of movement one input represents. Client and server apply the same step. */
export const INPUT_DT = 1 / CONFIG.net.tickRate;

function collides(x: number, y: number, blocked: Blocked): boolean {
  const r = CONFIG.map.playerRadius;
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isWall(tx, ty, blocked)) return true;
  return false;
}

/** Clamps a joystick vector to length 1 and rounds it so client and server agree bit for bit. */
export function normalizeDir(dx: number, dy: number): { dx: number; dy: number } {
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }
  return { dx: Math.trunc(dx * 100) / 100, dy: Math.trunc(dy * 100) / 100 };
}

/**
 * Deterministic movement step used for client prediction and server truth.
 * Moves on each axis separately so players slide along walls.
 */
export function stepMovement(pos: Point, dx: number, dy: number, blocked: Blocked = NO_BLOCK): Point {
  const dist = CONFIG.movement.walkTilesPerSecond * INPUT_DT;
  let { x, y } = pos;
  const nx = x + dx * dist;
  if (!collides(nx, y, blocked)) x = nx;
  const ny = y + dy * dist;
  if (!collides(x, ny, blocked)) y = ny;
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}
