import {
  CONFIG, FIX_POINTS, findPath, ROOMS, roomAt, SKIP, taskById, TASKS,
  type ClientMessage, type Point, type Rng, type RoomId, type ServerMessage,
} from "@glitch/shared";
import type { Match, MatchPlayerState } from "./match";

/**
 * Simple practice bots (pulled forward from PRD phase 9 so small groups can
 * play). A bot acts only by sending the same validated messages a real client
 * sends, so it obeys every server rule: range, cooldowns, vision.
 */

type Goal =
  | { kind: "task"; task: string; stage: number }
  | { kind: "fake"; at: Point }
  | { kind: "fix"; fix: "blackout" | "comms" }
  | { kind: "panel"; panel: 0 | 1 }
  | { kind: "body"; id: string }
  | { kind: "hunt"; target: string }
  | { kind: "wander"; at: Point };

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const R = CONFIG.map.interactRange;

export class BotBrain {
  private goal: Goal | null = null;
  private path: Point[] = [];
  private seq = 0;
  private pending: { at: number; msg: ClientMessage } | null = null;
  private suspects = new Set<string>();
  private inMeeting = false;
  private chatAt: number | null = null;
  private voteAt: number | null = null;
  private lastRepath = 0;
  private stuckCheck = { at: 0, x: 0, y: 0 };
  private holding: 0 | 1 | null = null;

  constructor(readonly id: string, private readonly rng: Rng) {}

  witnessed(killer: string): void {
    this.suspects.add(killer);
  }

  observe(_match: Match, _p: MatchPlayerState, msg: ServerMessage): void {
    if (msg.t === "meeting") {
      if (msg.meeting && !this.inMeeting) {
        this.inMeeting = true;
        this.chatAt = null;
        this.voteAt = null;
      }
      if (!msg.meeting) {
        this.inMeeting = false;
        this.reset();
      }
    }
    if (msg.t === "died") this.reset();
  }

  private reset(): void {
    this.goal = null;
    this.path = [];
    this.pending = null;
    this.holding = null;
  }

  private act(match: Match, msg: ClientMessage, now: number): void {
    match.handle(this.id, msg, now);
  }

  think(match: Match, p: MatchPlayerState, now: number): void {
    if (p.left) return;
    if (match.phase === "meeting") return this.thinkMeeting(match, p, now);
    if (match.phase !== "play") return;

    if (this.pending && now >= this.pending.at) {
      const msg = this.pending.msg;
      this.pending = null;
      this.act(match, msg, now);
      this.goal = null;
    }
    if (this.pending) return; // busy at a station

    if (p.alive) {
      if (this.reportBodies(match, p, now)) return;
      if (p.role === "glitch") {
        if (this.tryKill(match, p, now)) return;
        this.maybeSabotage(match, now);
      } else {
        this.respondToSabotage(match, p, now);
      }
    } else if (p.role === "glitch") {
      this.maybeSabotage(match, now);
    }

    if (!this.goal) this.goal = this.pickGoal(match, p);
    this.pursue(match, p, now);
  }

  // ---- Decisions ----------------------------------------------------------

  private reportBodies(match: Match, p: MatchPlayerState, now: number): boolean {
    for (const body of match.bodies) {
      if (!match.sees(p, body)) continue;
      if (dist(p, body) <= R) {
        this.act(match, { t: "report", body: body.id }, now);
        return true;
      }
      if (this.goal?.kind !== "body") this.setGoal({ kind: "body", id: body.id });
    }
    return false;
  }

  private tryKill(match: Match, p: MatchPlayerState, now: number): boolean {
    if (now < p.killReadyAt) {
      if (this.goal?.kind === "hunt") this.goal = null;
      return false;
    }
    const crew = [...match.players.values()].filter((q) => q.alive && !q.left && q.role === "crew" && match.sees(p, q));
    for (const target of crew) {
      const witnesses = [...match.players.values()].filter(
        (q) => q.alive && !q.left && q.role === "crew" && q.id !== target.id && match.sees(q, p),
      );
      if (witnesses.length > 0) continue;
      if (dist(p, target) <= CONFIG.glitch.eliminateRangeTiles) {
        this.act(match, { t: "kill", target: target.id }, now);
        this.goal = null;
        return true;
      }
      if (crew.length === 1 && this.goal?.kind !== "hunt" && this.rng() < 0.05) this.setGoal({ kind: "hunt", target: target.id });
    }
    return false;
  }

  private maybeSabotage(match: Match, now: number): void {
    if (match.sabotage || now < match.sabReadyAt) return;
    if (this.rng() > 1 / (25 * CONFIG.net.tickRate)) return;
    const roll = this.rng();
    if (roll < 0.35) this.act(match, { t: "sabotage", kind: "blackout", room: null }, now);
    else if (roll < 0.65) this.act(match, { t: "sabotage", kind: "comms", room: null }, now);
    else if (roll < 0.9) {
      const room = ROOMS[Math.floor(this.rng() * ROOMS.length)]!.id;
      this.act(match, { t: "sabotage", kind: "doors", room }, now);
    } else this.act(match, { t: "sabotage", kind: "meltdown", room: null }, now);
  }

  private respondToSabotage(match: Match, p: MatchPlayerState, now: number): void {
    const s = match.sabotage;
    if (!s) {
      if (this.goal?.kind === "fix" || this.goal?.kind === "panel") this.goal = null;
      this.holding = null;
      return;
    }
    if (s.kind === "meltdown") {
      const bots = [...match.players.values()].filter((q) => q.bot && q.alive && q.role === "crew").map((q) => q.id).sort();
      const panel = (bots.indexOf(p.id) % 2) as 0 | 1;
      if (bots.indexOf(p.id) > 1) return; // two bots are enough
      if (this.goal?.kind !== "panel") this.setGoal({ kind: "panel", panel });
      if (dist(p, FIX_POINTS.meltdown[panel]) <= R && this.holding === null) {
        this.act(match, { t: "hold", panel, on: true }, now);
        this.holding = panel;
      }
      return;
    }
    if (s.kind === "blackout" || s.kind === "comms") {
      const fix = s.kind;
      const target = FIX_POINTS[fix];
      const crewBots = [...match.players.values()].filter((q) => q.bot && q.alive && q.role === "crew");
      const nearest = crewBots.sort((a, b) => dist(a, target) - dist(b, target))[0];
      if (nearest?.id !== p.id) return;
      if (this.goal?.kind !== "fix") this.setGoal({ kind: "fix", fix });
    }
  }

  private pickGoal(match: Match, p: MatchPlayerState): Goal {
    if (p.role === "crew" && this.rng() > 0.2) {
      // Pick a random unfinished task, like a person wandering the station.
      const open = p.tasks.filter((t) => !t.done);
      const next = open[Math.floor(this.rng() * open.length)];
      if (next) return { kind: "task", task: next.id, stage: next.stage };
    }
    if (p.role === "glitch" && p.alive && this.rng() < 0.7) {
      const t = TASKS[Math.floor(this.rng() * TASKS.length)]!;
      return { kind: "fake", at: t.stages[0]!.at };
    }
    const room = ROOMS[Math.floor(this.rng() * ROOMS.length)]!;
    return { kind: "wander", at: { x: room.cx + 0.5, y: room.cy + 0.5 } };
  }

  private setGoal(goal: Goal): void {
    this.goal = goal;
    this.path = [];
    this.lastRepath = 0;
  }

  private goalPoint(match: Match): Point | null {
    const g = this.goal;
    if (!g) return null;
    switch (g.kind) {
      case "task": return taskById(g.task as Parameters<typeof taskById>[0]).stages[g.stage]?.at ?? null;
      case "fake": case "wander": return g.at;
      case "fix": return FIX_POINTS[g.fix];
      case "panel": return FIX_POINTS.meltdown[g.panel];
      case "body": return match.bodies.find((b) => b.id === g.id) ?? null;
      case "hunt": {
        const t = match.players.get(g.target);
        return t && t.alive ? t : null;
      }
    }
  }

  // ---- Movement and arrival ------------------------------------------------

  private pursue(match: Match, p: MatchPlayerState, now: number): void {
    const target = this.goalPoint(match);
    if (!target) { this.goal = null; return; }
    const arrive = this.goal?.kind === "hunt" ? CONFIG.glitch.eliminateRangeTiles * 0.8 : R * 0.6;

    if (dist(p, target) <= arrive) {
      this.arrive(match, p, now);
      return;
    }

    const moving = this.goal?.kind === "hunt";
    if (this.path.length === 0 || (moving && now - this.lastRepath > 400)) {
      this.path = findPath(p, target, p.alive ? match.blocked() : undefined) ?? [];
      this.lastRepath = now;
      if (this.path.length === 0) { this.goal = null; return; }
    }

    let next = this.path[0]!;
    while (this.path.length > 1 && dist(p, next) < 0.15) { this.path.shift(); next = this.path[0]!; }
    if (this.path.length === 1 && dist(p, next) < 0.15) { this.path = [target]; next = target; }
    const dx = next.x - p.x, dy = next.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    this.seq = Math.max(this.seq + 1, p.ack + 1);
    this.act(match, { t: "input", seq: this.seq, dx: dx / len, dy: dy / len }, now);

    if (now - this.stuckCheck.at > 1500) {
      if (dist(p, this.stuckCheck) < 0.2) { this.path = []; if (this.rng() < 0.5) this.goal = null; }
      this.stuckCheck = { at: now, x: p.x, y: p.y };
    }
  }

  private arrive(match: Match, p: MatchPlayerState, now: number): void {
    const g = this.goal!;
    this.path = [];
    switch (g.kind) {
      case "task": {
        const def = taskById(g.task as Parameters<typeof taskById>[0]);
        this.act(match, { t: "taskStart", task: def.id }, now);
        const ms = def.kind === "long" ? CONFIG.tasks.longStageMs + 200 : 3000 + this.rng() * 3500;
        this.pending = { at: now + ms, msg: { t: "taskDone", task: def.id } };
        return;
      }
      case "fake":
        this.pending = { at: now + 3000 + this.rng() * 2500, msg: { t: "ping", id: 0, sentAt: 0 } };
        return;
      case "fix":
        this.act(match, { t: "fixStart", kind: g.fix }, now);
        this.pending = { at: now + 2500, msg: { t: "fixDone", kind: g.fix } };
        return;
      case "panel":
        return; // stay and hold; respondToSabotage handles it
      case "body":
      case "hunt":
        return; // handled by reportBodies / tryKill next tick
      case "wander":
        this.goal = null;
        return;
    }
  }

  // ---- Meetings --------------------------------------------------------------

  private thinkMeeting(match: Match, p: MatchPlayerState, now: number): void {
    const m = match.meeting;
    if (!m || !p.alive) return;
    const living = [...match.players.values()].filter((q) => q.alive && !q.left && q.id !== p.id);

    if (this.chatAt === null) this.chatAt = now + 2000 + this.rng() * 8000;
    if (this.chatAt > 0 && now >= this.chatAt) {
      this.chatAt = -1;
      const suspect = living.find((q) => this.suspects.has(q.id));
      if (suspect && p.role === "crew") this.act(match, { t: "quick", tpl: "sus", args: [suspect.id] }, now);
      else {
        const here = roomAt(p.x, p.y)?.id;
        const room: RoomId = p.role === "glitch" || !here ? ROOMS[Math.floor(this.rng() * ROOMS.length)]!.id : here;
        this.act(match, { t: "quick", tpl: "was_in", args: [room] }, now);
      }
    }

    if (m.phase !== "voting" || m.votes.has(p.id)) return;
    if (this.voteAt === null) this.voteAt = now + 2000 + this.rng() * Math.min(15000, match.settings.voting * 600);
    if (now < this.voteAt) return;
    let target: string = SKIP;
    const suspect = living.find((q) => this.suspects.has(q.id));
    if (p.role === "crew" && suspect) target = suspect.id;
    else {
      const pool = p.role === "glitch" ? living.filter((q) => q.role === "crew") : living;
      if (pool.length && this.rng() < (p.role === "glitch" ? 0.4 : 0.3)) target = pool[Math.floor(this.rng() * pool.length)]!.id;
    }
    this.act(match, { t: "vote", target }, now);
  }
}
