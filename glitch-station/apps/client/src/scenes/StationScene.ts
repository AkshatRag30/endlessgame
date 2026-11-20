import Phaser from "phaser";
import {
  blockedFor, CONDUITS, CONFIG, DOORS, EMERGENCY_BUTTON, FIX_POINTS, FLOOR, isWall, MAP_SIZE, NO_BLOCK, normalizeDir, ROOMS,
  stepMovement, taskById, tileIndex, type Blocked, type Point,
} from "@glitch/shared";
import { bridge, type Actions, type Interaction, type Snap } from "../game/bridge";
import type { MoveInput } from "../game/input";
import { drawBody, PlayerSprite } from "../game/sprites";

const T = CONFIG.map.tilePx;
const R = CONFIG.map.interactRange;
const STEP_MS = 1000 / CONFIG.net.tickRate;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

interface Frame { t: number; others: Map<string, [number, number, boolean, boolean]> }

/**
 * Draws the Neon Relay and everything in it. Your own suit is predicted
 * locally from your inputs; everyone else is drawn 100 ms in the past and
 * interpolated between server snapshots (PRD section 10).
 */
export class StationScene extends Phaser.Scene {
  private input2!: MoveInput;
  private sprites = new Map<string, PlayerSprite>();
  private me!: PlayerSprite;
  private bodies = new Map<string, Phaser.GameObjects.Graphics>();
  private stations!: Phaser.GameObjects.Graphics;
  private dark: Phaser.GameObjects.RenderTexture | null = null;
  private lightShape!: Phaser.GameObjects.Graphics;
  private frames: Frame[] = [];

  private seq = 0;
  private pending: { seq: number; dx: number; dy: number }[] = [];
  private predicted: Point = { x: 0, y: 0 };
  private prevPredicted: Point = { x: 0, y: 0 };
  private acc = 0;
  private lastDirX = 0;
  private moving = false;
  private lastActions = "";
  private stationKey = "";

  constructor() {
    super("station");
  }

  init(data: { input: MoveInput }): void {
    this.input2 = data.input;
  }

  create(): void {
    const m = bridge.match!;
    this.cameras.main.setBackgroundColor(0x07080f);
    this.drawMap();
    this.stations = this.add.graphics().setDepth(1);

    for (const p of m.players.values()) {
      const partner = m.partners.has(p.id);
      const sprite = new PlayerSprite(this, p.name, p.color, p.accessory, partner ? "#FF5E7A" : "#EEF0FF");
      sprite.container.setVisible(false);
      if (p.id === m.you) this.me = sprite;
      else this.sprites.set(p.id, sprite);
    }
    this.me.container.setVisible(true);

    this.lightShape = this.make.graphics({}, false);

    const cam = this.cameras.main;
    cam.setBounds(-T * 4, -T * 4, (MAP_SIZE + 8) * T, (MAP_SIZE + 8) * T);
    this.fitZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fitZoom());

    bridge.onSnap = (s) => this.onSnap(s);
    bridge.onFx = (kind, x, y) => this.fx(kind, x, y);
    bridge.onTeleport = () => { this.pending = []; this.frames = []; };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bridge.onSnap = () => {};
      bridge.onFx = () => {};
    });
  }

  private fitZoom(): void {
    const cam = this.cameras.main;
    const view = Math.min(cam.width, cam.height);
    cam.setZoom(Phaser.Math.Clamp(view / (2 * 7 * T), 0.55, 2.4));
    // The darkness layer only needs to cover what the camera shows, not the whole map.
    const w = Math.ceil(cam.width / cam.zoom) + T * 2;
    const h = Math.ceil(cam.height / cam.zoom) + T * 2;
    this.dark?.destroy();
    this.dark = this.add.renderTexture(0, 0, w, h).setOrigin(0, 0).setDepth(10_000);
  }

  // ---- Static map --------------------------------------------------------

  private drawMap(): void {
    const g = this.add.graphics().setDepth(0);
    const roomOf = new Map<number, string>();
    for (const r of ROOMS) for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) roomOf.set(tileIndex(x, y), r.id);

    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const i = tileIndex(x, y);
        if (!FLOOR[i]) continue;
        const room = roomOf.get(i);
        const base = room === "hub" ? 0x1a1f3f : room === "core" ? 0x221a33 : room ? 0x171b36 : 0x121530;
        g.fillStyle(base).fillRect(x * T, y * T, T, T);
        g.lineStyle(1, 0x232850, 0.6).strokeRect(x * T, y * T, T, T);
      }
    }
    const edges = (width: number, color: number, alpha: number) => {
      g.lineStyle(width, color, alpha);
      for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
          if (!FLOOR[tileIndex(x, y)]) continue;
          if (isWall(x, y - 1)) g.lineBetween(x * T, y * T, (x + 1) * T, y * T);
          if (isWall(x, y + 1)) g.lineBetween(x * T, (y + 1) * T, (x + 1) * T, (y + 1) * T);
          if (isWall(x - 1, y)) g.lineBetween(x * T, y * T, x * T, (y + 1) * T);
          if (isWall(x + 1, y)) g.lineBetween((x + 1) * T, y * T, (x + 1) * T, (y + 1) * T);
        }
      }
    };
    if (!bridge.lowFx) edges(10, 0x3de0ff, 0.08);
    edges(3, 0x4a5294, 1);

    for (const r of ROOMS) {
      this.add.text(r.x0 * T + 10, r.y0 * T + 8, r.name.toUpperCase(), {
        fontFamily: "Space Grotesk, Inter, sans-serif", fontSize: "15px", fontStyle: "bold", color: "#7F88C2",
      }).setLetterSpacing(2).setDepth(0.5);
    }
  }

  /** Stations change with tasks, sabotage and doors, so they are redrawn only when that state changes. */
  private drawStations(snap: Snap | null): void {
    const m = bridge.match!;
    const key = JSON.stringify([m.tasks, snap?.sab?.kind, snap?.doors, snap?.held, m.ghost, Math.floor(performance.now() / 400) % 2]);
    if (key === this.stationKey) return;
    this.stationKey = key;
    const g = this.stations.clear();
    const pulse = Math.floor(performance.now() / 400) % 2 === 0;

    // Every task console in the station, mine highlighted.
    const mine = new Map(m.tasks.filter((t) => !t.done).map((t) => [`${t.id}:${t.stage}`, t]));
    const done = new Set(m.tasks.filter((t) => t.done).map((t) => t.id));
    const commsDown = snap?.sab?.kind === "comms";
    for (const def of ["reroute", "align", "defrag", "purge", "calibrate", "sort", "firewall", "upload"] as const) {
      taskById(def).stages.forEach((st, i) => {
        const x = st.at.x * T, y = st.at.y * T;
        const active = !commsDown && mine.has(`${def}:${i}`);
        g.fillStyle(0x0b0d1a).fillRoundedRect(x - 12, y - 10, 24, 20, 5);
        g.lineStyle(2, active ? 0xffb23d : done.has(def) ? 0x4dffb0 : 0x4a5294).strokeRoundedRect(x - 12, y - 10, 24, 20, 5);
        g.fillStyle(active ? 0xffb23d : 0x3de0ff, active ? 1 : 0.5).fillRect(x - 7, y - 5, 14, 4);
        if (active && pulse) g.lineStyle(3, 0xffb23d, 0.35).strokeCircle(x, y, 20);
      });
    }

    // Emergency button.
    const eb = EMERGENCY_BUTTON;
    g.fillStyle(0xff5e7a, 0.25).fillCircle(eb.x * T, eb.y * T, 18);
    g.lineStyle(3, 0xff5e7a).strokeCircle(eb.x * T, eb.y * T, 18);
    g.fillStyle(0xff5e7a).fillCircle(eb.x * T, eb.y * T, 9);

    // Conduits: grates everyone can see; Glitches see them lit.
    for (const c of CONDUITS) {
      const x = c.x * T, y = c.y * T;
      g.fillStyle(0x05060d).fillRoundedRect(x - 13, y - 9, 26, 18, 4);
      g.lineStyle(2, m.role === "glitch" ? 0xa77bff : 0x3a4170).strokeRoundedRect(x - 13, y - 9, 26, 18, 4);
      g.lineStyle(1.5, 0x3a4170);
      for (let k = -8; k <= 8; k += 4) g.lineBetween(x + k, y - 7, x + k, y + 7);
    }

    // Sabotage fix points glow while their sabotage is active.
    const sab = snap?.sab?.kind;
    const fixes: [Point, boolean][] = [
      [FIX_POINTS.blackout, sab === "blackout"],
      [FIX_POINTS.comms, sab === "comms"],
      [FIX_POINTS.meltdown[0], sab === "meltdown"],
      [FIX_POINTS.meltdown[1], sab === "meltdown"],
    ];
    fixes.forEach(([p, on], i) => {
      const held = i >= 2 && snap?.held[i - 2];
      g.fillStyle(0x0b0d1a).fillRoundedRect(p.x * T - 13, p.y * T - 13, 26, 26, 6);
      g.lineStyle(3, held ? 0x4dffb0 : on ? 0xff5e7a : 0x4a5294, 1).strokeRoundedRect(p.x * T - 13, p.y * T - 13, 26, 26, 6);
      if (on && pulse) g.lineStyle(4, 0xff5e7a, 0.4).strokeCircle(p.x * T, p.y * T, 26);
    });

    // Locked doors.
    for (const room of snap?.doors ?? []) {
      for (const t of DOORS[room]) {
        const x = (t % MAP_SIZE) * T, y = Math.floor(t / MAP_SIZE) * T;
        g.fillStyle(0xff5e7a, 0.85).fillRect(x + 2, y + 2, T - 4, T - 4);
        g.lineStyle(2, 0x0b0d1a).lineBetween(x + 4, y + 4, x + T - 4, y + T - 4);
      }
    }
  }

  // ---- Networking ----------------------------------------------------------

  private blockedForMe(): Blocked {
    const m = bridge.match!;
    if (m.ghost || !m.snap?.doors.length) return NO_BLOCK;
    return blockedFor(m.snap.doors);
  }

  private onSnap(s: Snap): void {
    const m = bridge.match!;
    m.snap = s;
    m.ghost = s.me.ghost;
    // Reconcile: start from the server's position and replay inputs it has not seen yet.
    this.pending = this.pending.filter((p) => p.seq > s.ack);
    let pos: Point = { x: s.me.x, y: s.me.y };
    const blocked = this.blockedForMe();
    for (const p of this.pending) pos = stepMovement(pos, p.dx, p.dy, blocked);
    if (dist(pos, this.predicted) > 2.5) this.prevPredicted = pos; // teleport (conduit or meeting)
    this.predicted = pos;
    if (this.frames.length === 0) this.prevPredicted = pos;

    const others = new Map<string, [number, number, boolean, boolean]>();
    for (const [id, x, y, ghost, moving] of s.others) others.set(id, [x, y, ghost === 1, moving === 1]);
    this.frames.push({ t: performance.now(), others });
    if (this.frames.length > 30) this.frames.shift();

    // Bodies are few; rebuild the set.
    const seen = new Set<string>();
    for (const b of s.bodies) {
      seen.add(b.id);
      let g = this.bodies.get(b.id);
      if (!g) {
        g = this.add.graphics();
        drawBody(g, m.players.get(b.victim)?.color ?? 0);
        this.bodies.set(b.id, g);
      }
      g.setPosition(b.x * T, b.y * T).setDepth(b.y * T - 1);
    }
    for (const [id, g] of this.bodies) if (!seen.has(id)) { g.destroy(); this.bodies.delete(id); }
  }

  private fx(kind: "conduit" | "task" | "kill", x: number, y: number): void {
    const color = kind === "task" ? 0x4dffb0 : kind === "conduit" ? 0xa77bff : 0xff5e7a;
    const ring = this.add.circle(x * T, y * T, 10, color, 0.35).setStrokeStyle(3, color).setDepth(9000);
    this.tweens.add({ targets: ring, scale: 4, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
  }

  // ---- Frame -----------------------------------------------------------------

  override update(_time: number, delta: number): void {
    const m = bridge.match;
    if (!m) return;
    const canMove = m.phase === "play" && !m.busy;
    this.input2.enabled = canMove;

    // Fixed 20 Hz input steps, the same step the server runs.
    this.acc += Math.min(delta, 250);
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      this.prevPredicted = this.predicted;
      const raw = this.input2.get();
      this.moving = false;
      if (canMove && (raw.dx !== 0 || raw.dy !== 0) && m.snap) {
        const d = normalizeDir(raw.dx, raw.dy);
        const next = stepMovement(this.predicted, d.dx, d.dy, this.blockedForMe());
        this.moving = next.x !== this.predicted.x || next.y !== this.predicted.y;
        this.predicted = next;
        this.lastDirX = d.dx;
        const input = { seq: ++this.seq, dx: d.dx, dy: d.dy };
        this.pending.push(input);
        if (this.pending.length > 60) this.pending.shift();
        bridge.send({ t: "input", ...input });
      }
    }

    // Draw me between the last two steps for smoothness.
    const a = this.acc / STEP_MS;
    const meX = Phaser.Math.Linear(this.prevPredicted.x, this.predicted.x, a);
    const meY = Phaser.Math.Linear(this.prevPredicted.y, this.predicted.y, a);
    this.me.place(meX * T, meY * T, this.moving, m.ghost, delta, this.lastDirX);
    this.cameras.main.centerOn(meX * T, meY * T - 20);

    this.drawOthers(delta);
    this.drawStations(m.snap);
    this.drawDarkness({ x: meX, y: meY });
    this.updateActions({ x: this.predicted.x, y: this.predicted.y });
  }

  private drawOthers(delta: number): void {
    const renderT = performance.now() - CONFIG.net.interpolationDelayMs;
    let a: Frame | undefined, b: Frame | undefined;
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i]!.t <= renderT) { a = this.frames[i]; b = this.frames[i + 1]; break; }
    }
    if (!a) a = this.frames[0];
    const latest = this.frames.at(-1);
    for (const [id, sprite] of this.sprites) {
      const pa = a?.others.get(id);
      const pb = b?.others.get(id);
      const nowSeen = latest?.others.has(id);
      if (!nowSeen || (!pa && !pb)) { sprite.container.setVisible(false); continue; }
      let x: number, y: number;
      const src = pa ?? pb!;
      if (pa && pb && a && b) {
        const k = Phaser.Math.Clamp((renderT - a.t) / Math.max(1, b.t - a.t), 0, 1);
        x = Phaser.Math.Linear(pa[0], pb[0], k);
        y = Phaser.Math.Linear(pa[1], pb[1], k);
      } else { x = src[0]; y = src[1]; }
      const dirX = pa && pb ? pb[0] - pa[0] : 0;
      sprite.container.setVisible(true);
      sprite.place(x * T, y * T, src[3], src[2], delta, dirX);
    }
  }

  /** Light circle with wall occlusion; ghosts see everything. */
  private drawDarkness(eye: Point): void {
    const m = bridge.match!;
    if (!this.dark) return;
    if (m.ghost || m.phase === "over") { this.dark.setVisible(false); return; }
    this.dark.setVisible(true);
    const radius = m.role === "glitch"
      ? CONFIG.vision.glitchTiles
      : m.snap?.sab?.kind === "blackout" ? CONFIG.vision.blackoutCrewTiles : m.settings.crewVision;
    const blocked = this.blockedForMe();
    const rays = bridge.lowFx ? 90 : 180;
    const pts: Phaser.Types.Math.Vector2Like[] = [];
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2;
      const cx = Math.cos(ang), cy = Math.sin(ang);
      let d = 0;
      while (d < radius) {
        const nd = d + 0.2;
        if (isWall(Math.floor(eye.x + cx * nd), Math.floor(eye.y + cy * nd), blocked)) { d = nd + 0.3; break; }
        d = nd;
      }
      d = Math.min(d, radius);
      pts.push({ x: (eye.x + cx * d) * T, y: (eye.y + cy * d) * T });
    }
    // Position the screen sized layer over the camera view and draw the light relative to it.
    const view = this.cameras.main.worldView;
    const ox = Math.floor(view.x) - T, oy = Math.floor(view.y) - T;
    this.dark.setPosition(ox, oy);
    for (const p of pts) { p.x! -= ox; p.y! -= oy; }
    this.lightShape.clear().fillStyle(0xffffff).fillPoints(pts, true);
    this.dark.clear().fill(0x03040a, 0.93).erase(this.lightShape);
  }

  // ---- What can I do right now? ---------------------------------------------------

  private updateActions(me: Point): void {
    const m = bridge.match!;
    const s = m.snap;
    const actions: Actions = { use: null, report: null, kill: null };
    if (s && m.phase === "play") {
      const alive = !m.ghost;
      let use: Interaction | null = null;
      const sab = s.sab?.kind;
      if (alive && sab === "meltdown") {
        for (const i of [0, 1] as const) if (dist(me, FIX_POINTS.meltdown[i]) <= R) use = { kind: "panel", panel: i };
      }
      if (!use && alive && (sab === "blackout" || sab === "comms") && dist(me, FIX_POINTS[sab]) <= R) use = { kind: "fix", fix: sab };
      if (!use && sab !== "comms") {
        for (const t of m.tasks) {
          if (t.done) continue;
          const st = taskById(t.id).stages[t.stage];
          if (st && dist(me, st.at) <= R) { use = { kind: "task", task: t.id, stage: t.stage }; break; }
        }
      }
      if (!use && alive && m.role === "glitch" && CONDUITS.some((c) => dist(me, c) <= R)) use = { kind: "conduit" };
      if (!use && alive && dist(me, EMERGENCY_BUTTON) <= R) use = { kind: "emergency" };
      actions.use = use;

      if (alive) {
        const body = s.bodies.find((b) => dist(me, b) <= R);
        actions.report = body?.id ?? null;
      }
      if (alive && m.role === "glitch") {
        let best: string | null = null;
        let bestD: number = CONFIG.glitch.eliminateRangeTiles;
        for (const [id, x, y, ghost] of s.others) {
          if (ghost || m.partners.has(id)) continue;
          const d = dist(me, { x, y });
          if (d <= bestD) { best = id; bestD = d; }
        }
        actions.kill = best;
      }
    }
    const key = JSON.stringify(actions);
    if (key !== this.lastActions) {
      this.lastActions = key;
      bridge.onActions(actions);
    }
  }
}
