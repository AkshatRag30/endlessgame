import { CONFIG } from "./config";

/**
 * The Neon Relay (PRD section 5), defined in code so the client and the
 * server share one exact collision grid. Units are tiles; a player at
 * (10.5, 4.5) stands in the middle of tile (10, 4).
 */

export const MAP_SIZE = 54;
const CELL = 18;

export type RoomId =
  | "signal" | "vault" | "cooling"
  | "power" | "hub" | "lab"
  | "dock" | "core" | "lounge";

export interface Room {
  id: RoomId;
  name: string;
  /** Inclusive tile bounds. */
  x0: number; y0: number; x1: number; y1: number;
  cx: number; cy: number;
}

const ROOM_DEFS: { id: RoomId; name: string; col: number; row: number; w: number; h: number }[] = [
  { id: "signal", name: "Signal Tower", col: 0, row: 0, w: 13, h: 11 },
  { id: "vault", name: "Server Vault", col: 1, row: 0, w: 13, h: 11 },
  { id: "cooling", name: "Cooling Bay", col: 2, row: 0, w: 13, h: 11 },
  { id: "power", name: "Power Grid", col: 0, row: 1, w: 11, h: 11 },
  { id: "hub", name: "Hub", col: 1, row: 1, w: 15, h: 13 },
  { id: "lab", name: "Lab", col: 2, row: 1, w: 11, h: 11 },
  { id: "dock", name: "Dock", col: 0, row: 2, w: 13, h: 9 },
  { id: "core", name: "Core Reactor", col: 1, row: 2, w: 13, h: 11 },
  { id: "lounge", name: "Lounge", col: 2, row: 2, w: 11, h: 9 },
];

export const ROOMS: Room[] = ROOM_DEFS.map((d) => {
  const cx = 9 + CELL * d.col;
  const cy = 9 + CELL * d.row;
  const hw = (d.w - 1) / 2;
  const hh = (d.h - 1) / 2;
  return { id: d.id, name: d.name, cx, cy, x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
});

export const ROOM_IDS = ROOMS.map((r) => r.id);

export function roomById(id: RoomId): Room {
  const room = ROOMS.find((r) => r.id === id);
  if (!room) throw new Error(`unknown room ${id}`);
  return room;
}

/** Corridors join room pairs. The Dock only links to the Core Reactor: a long dead end. */
export const CORRIDORS: [RoomId, RoomId][] = [
  ["signal", "vault"], ["vault", "cooling"],
  ["power", "hub"], ["hub", "lab"],
  ["dock", "core"], ["core", "lounge"],
  ["signal", "power"], ["vault", "hub"], ["cooling", "lab"],
  ["hub", "core"], ["lab", "lounge"],
];

/** Tiles that become walls when a room's doors are locked, keyed by room. */
export const DOORS: Record<RoomId, number[]> = Object.fromEntries(ROOM_IDS.map((id) => [id, [] as number[]])) as unknown as Record<RoomId, number[]>;

export const tileIndex = (tx: number, ty: number) => ty * MAP_SIZE + tx;

/** 1 = floor, 0 = wall. */
export const FLOOR: Uint8Array = (() => {
  const grid = new Uint8Array(MAP_SIZE * MAP_SIZE);
  const carve = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[tileIndex(x, y)] = 1;
  };
  for (const r of ROOMS) carve(r.x0, r.y0, r.x1, r.y1);
  for (const [a, b] of CORRIDORS) {
    const A = roomById(a);
    const B = roomById(b);
    if (A.cy === B.cy) {
      const [L, R] = A.cx < B.cx ? [A, B] : [B, A];
      carve(L.x1 + 1, A.cy - 1, R.x0 - 1, A.cy + 1);
      for (let dy = -1; dy <= 1; dy++) {
        DOORS[L.id].push(tileIndex(L.x1 + 1, A.cy + dy));
        DOORS[R.id].push(tileIndex(R.x0 - 1, A.cy + dy));
      }
    } else {
      const [T, Bm] = A.cy < B.cy ? [A, B] : [B, A];
      carve(A.cx - 1, T.y1 + 1, A.cx + 1, Bm.y0 - 1);
      for (let dx = -1; dx <= 1; dx++) {
        DOORS[T.id].push(tileIndex(A.cx + dx, T.y1 + 1));
        DOORS[Bm.id].push(tileIndex(A.cx + dx, Bm.y0 - 1));
      }
    }
  }
  return grid;
})();

/** Set of tile indexes currently blocked by locked doors. */
export type Blocked = ReadonlySet<number>;
export const NO_BLOCK: Blocked = new Set();

export function blockedFor(lockedRooms: Iterable<RoomId>): Set<number> {
  const set = new Set<number>();
  for (const id of lockedRooms) for (const t of DOORS[id]) set.add(t);
  return set;
}

export function isWall(tx: number, ty: number, blocked: Blocked = NO_BLOCK): boolean {
  if (tx < 0 || ty < 0 || tx >= MAP_SIZE || ty >= MAP_SIZE) return true;
  const i = tileIndex(tx, ty);
  return FLOOR[i] === 0 || blocked.has(i);
}

export function roomAt(x: number, y: number): Room | null {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return ROOMS.find((r) => tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1) ?? null;
}

/** Walls (and locked doors) block sight. Samples the segment every quarter tile. */
export function lineOfSight(ax: number, ay: number, bx: number, by: number, blocked: Blocked = NO_BLOCK): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const steps = Math.ceil(Math.hypot(dx, dy) / 0.25);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWall(Math.floor(ax + dx * t), Math.floor(ay + dy * t), blocked)) return false;
  }
  return true;
}

export function canSee(ax: number, ay: number, bx: number, by: number, radius: number, blocked: Blocked = NO_BLOCK): boolean {
  if (Math.hypot(bx - ax, by - ay) > radius) return false;
  return lineOfSight(ax, ay, bx, by, blocked);
}

// ---- Points of interest -------------------------------------------------

type Anchor = "tl" | "tr" | "bl" | "br" | "c" | "l" | "r" | "t" | "b";
function at(id: RoomId, a: Anchor): { x: number; y: number } {
  const r = roomById(id);
  const inset = 2;
  const xs = { l: r.x0 + inset, c: r.cx, r: r.x1 - inset };
  const ys = { t: r.y0 + inset, c: r.cy, b: r.y1 - inset };
  const map: Record<Anchor, [number, number]> = {
    tl: [xs.l, ys.t], tr: [xs.r, ys.t], bl: [xs.l, ys.b], br: [xs.r, ys.b],
    c: [xs.c, ys.c], l: [xs.l, ys.c], r: [xs.r, ys.c], t: [xs.c, ys.t], b: [xs.c, ys.b],
  };
  const [x, y] = map[a];
  return { x: x + 0.5, y: y + 0.5 };
}

export interface Point { x: number; y: number }

export const EMERGENCY_BUTTON: Point = at("hub", "c");

export const FIX_POINTS = {
  blackout: at("power", "br"),
  comms: at("signal", "br"),
  meltdown: [at("core", "tl"), at("core", "tr")] as [Point, Point],
};

export interface Conduit extends Point { id: number; pair: number; room: RoomId }
export const CONDUITS: Conduit[] = (() => {
  const pairs: [RoomId, Anchor, RoomId, Anchor][] = [
    ["power", "bl", "cooling", "bl"],
    ["dock", "tr", "vault", "b"],
    ["lounge", "br", "signal", "bl"],
  ];
  const list: Conduit[] = [];
  pairs.forEach(([ra, aa, rb, ab], i) => {
    list.push({ id: i * 2, pair: i * 2 + 1, room: ra, ...at(ra, aa) });
    list.push({ id: i * 2 + 1, pair: i * 2, room: rb, ...at(rb, ab) });
  });
  return list;
})();

/** Positions around the Hub where everyone starts and returns after meetings. */
export function spawnPoint(index: number, count: number): Point {
  const hub = roomById("hub");
  const angle = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
  return {
    x: hub.cx + 0.5 + Math.cos(angle) * CONFIG.map.spawnRadius,
    y: hub.cy + 0.5 + Math.sin(angle) * CONFIG.map.spawnRadius,
  };
}

export function anchorPoint(id: RoomId, a: Anchor): Point {
  return at(id, a);
}

// ---- Pathfinding (bots) -------------------------------------------------

/** Breadth first search over floor tiles; returns tile centres from start to goal, or null. */
export function findPath(from: Point, to: Point, blocked: Blocked = NO_BLOCK): Point[] | null {
  const sx = Math.floor(from.x), sy = Math.floor(from.y);
  const gx = Math.floor(to.x), gy = Math.floor(to.y);
  if (isWall(gx, gy, blocked)) return null;
  const start = tileIndex(sx, sy);
  const goal = tileIndex(gx, gy);
  const prev = new Int32Array(MAP_SIZE * MAP_SIZE).fill(-1);
  prev[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    if (cur === goal) break;
    const cx = cur % MAP_SIZE, cy = (cur / MAP_SIZE) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (isWall(nx, ny, blocked)) continue;
      const ni = tileIndex(nx, ny);
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return null;
  const path: Point[] = [];
  for (let c = goal; c !== start; c = prev[c]!) path.push({ x: (c % MAP_SIZE) + 0.5, y: ((c / MAP_SIZE) | 0) + 0.5 });
  path.reverse();
  return path;
}
