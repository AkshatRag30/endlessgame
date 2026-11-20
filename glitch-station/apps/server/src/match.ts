import {
  assignRoles, blockedFor, canSee, checkWinner, cleanChat, CONDUITS, CONFIG, EMERGENCY_BUTTON, FIX_POINTS,
  glitchCountFor, makeTaskDraw, NO_BLOCK, normalizeDir, renderQuick, SKIP, spawnPoint, stepMovement, tallyVotes, taskById,
  type Accessory, type Blocked, type ClientMessage, type MatchPlayer, type MeetingView, type Point, type Rng, type Role,
  type RoomId, type SabotageKind, type SeenPlayer, type ServerMessage, type Settings, type TaskId, type TaskState, type Winner,
} from "@glitch/shared";
import { BotBrain } from "./bots";

/**
 * One match of Glitch Station: the authoritative simulation. It knows
 * nothing about sockets; the room feeds it messages and gives it a `send`
 * function, which keeps it easy to test.
 */

export interface MatchSeat { id: string; name: string; color: number; accessory: Accessory; bot: boolean }

export interface MatchPlayerState extends MatchSeat {
  role: Role;
  alive: boolean;
  left: boolean;
  connected: boolean;
  x: number; y: number;
  inputs: { seq: number; dx: number; dy: number }[];
  ack: number;
  moving: boolean;
  tasks: TaskState[];
  taskOpen: { task: TaskId; stage: number; at: number } | null;
  fixOpen: { kind: "blackout" | "comms"; at: number } | null;
  killReadyAt: number;
  conduitReadyAt: number;
  emergencyLeft: number;
  chatTokens: number;
  chatAt: number;
  brain: BotBrain | null;
}

export interface Body { id: string; victim: string; x: number; y: number }

interface Sabotage { kind: SabotageKind; room: RoomId | null; endsAt: number | null }

interface Meeting {
  phase: "discussion" | "voting" | "result";
  endsAt: number;
  caller: string;
  reason: "report" | "emergency";
  victim: string | null;
  votes: Map<string, string>;
  result: MeetingView["result"];
}

export type MatchPhase = "reveal" | "play" | "meeting" | "over";

export interface MatchOptions {
  seats: MatchSeat[];
  settings: Settings;
  now: number;
  send: (id: string, msg: ServerMessage) => void;
  rng?: Rng;
  /** Called once when a team wins. */
  onOver?: (winner: Winner) => void;
  log?: (event: string, data: Record<string, unknown>) => void;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export class Match {
  readonly players = new Map<string, MatchPlayerState>();
  readonly settings: Settings;
  phase: MatchPhase = "reveal";
  bodies: Body[] = [];
  sabotage: Sabotage | null = null;
  sabReadyAt: number;
  emergencyReadyAt: number;
  holds: [string | null, string | null] = [null, null];
  meeting: Meeting | null = null;
  winner: Winner | null = null;
  tick = 0;
  private revealUntil: number;
  private bodySeq = 0;
  private readonly send: MatchOptions["send"];
  private readonly rng: Rng;
  private readonly onOver: MatchOptions["onOver"];
  private readonly log: NonNullable<MatchOptions["log"]>;

  constructor(opts: MatchOptions) {
    this.settings = opts.settings;
    this.send = opts.send;
    this.rng = opts.rng ?? Math.random;
    this.onOver = opts.onOver;
    this.log = opts.log ?? (() => {});
    const now = opts.now;

    const glitches = glitchCountFor(opts.seats.length, this.settings.glitches);
    const roles = assignRoles(opts.seats.map((s) => s.id), glitches, this.rng);
    const draw = makeTaskDraw(this.settings, this.rng);
    const firstKill = now + CONFIG.roleRevealMs + this.settings.killCooldown * 1000;

    opts.seats.forEach((seat, i) => {
      const spawn = spawnPoint(i, opts.seats.length);
      const role = roles.get(seat.id)!;
      this.players.set(seat.id, {
        ...seat, role, alive: true, left: false, connected: true, x: spawn.x, y: spawn.y,
        inputs: [], ack: 0, moving: false,
        tasks: draw(),
        taskOpen: null, fixOpen: null,
        killReadyAt: firstKill, conduitReadyAt: 0,
        emergencyLeft: CONFIG.meeting.emergencyPerPlayer,
        chatTokens: CONFIG.meeting.chatBurst, chatAt: now,
        brain: seat.bot ? new BotBrain(seat.id, this.rng) : null,
      });
    });

    this.revealUntil = now + CONFIG.roleRevealMs;
    this.sabReadyAt = this.revealUntil + CONFIG.glitch.firstSabotageDelayS * 1000;
    this.emergencyReadyAt = this.revealUntil + CONFIG.meeting.emergencyCooldownS * 1000;

    for (const p of this.players.values()) this.sendMatchStart(p);
    this.log("match_started", { players: this.players.size, glitches });
  }

  // ---- Views ------------------------------------------------------------

  private publicPlayers(): MatchPlayer[] {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, accessory: p.accessory, bot: p.bot }));
  }

  /** Only Glitches learn who their partners are; crew learn nothing about anyone. */
  private sendMatchStart(p: MatchPlayerState): void {
    const partners = p.role === "glitch"
      ? [...this.players.values()].filter((q) => q.role === "glitch" && q.id !== p.id).map((q) => q.id)
      : [];
    this.sendTo(p, { t: "matchStart", players: this.publicPlayers(), role: p.role, partners, tasks: p.tasks, settings: this.settings });
  }

  /** Re-sends everything a reconnecting player needs. */
  resync(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = true;
    p.inputs = [];
    this.sendMatchStart(p);
    if (!p.alive) this.sendTo(p, { t: "died", how: "eliminated" });
    if (this.meeting) this.sendTo(p, { t: "meeting", meeting: this.meetingView(this.lastNow) });
    if (this.phase === "over" && this.winner) this.sendTo(p, this.overMessage(this.winner));
  }

  private sendTo(p: MatchPlayerState, msg: ServerMessage): void {
    if (!p.bot && p.connected) this.send(p.id, msg);
    if (p.brain) p.brain.observe(this, p, msg);
  }

  private broadcast(msg: ServerMessage, filter: (p: MatchPlayerState) => boolean = () => true): void {
    for (const p of this.players.values()) if (!p.left && filter(p)) this.sendTo(p, msg);
  }

  visionOf(p: MatchPlayerState): number {
    if (!p.alive) return Infinity;
    if (p.role === "glitch") return CONFIG.vision.glitchTiles;
    return this.sabotage?.kind === "blackout" ? CONFIG.vision.blackoutCrewTiles : this.settings.crewVision;
  }

  blocked(): Blocked {
    return this.sabotage?.kind === "doors" && this.sabotage.room ? blockedFor([this.sabotage.room]) : NO_BLOCK;
  }

  /** Can viewer see a point? Ghosts see everything; the living need range and line of sight. */
  sees(viewer: MatchPlayerState, at: Point): boolean {
    if (!viewer.alive) return true;
    return canSee(viewer.x, viewer.y, at.x, at.y, this.visionOf(viewer), this.blocked());
  }

  private snapshot(p: MatchPlayerState, now: number, blocked: Blocked): ServerMessage {
    const others: SeenPlayer[] = [];
    for (const q of this.players.values()) {
      if (q.id === p.id || q.left) continue;
      if (p.alive && !q.alive) continue; // the living never see ghosts
      if (p.alive && !canSee(p.x, p.y, q.x, q.y, this.visionOf(p), blocked)) continue;
      others.push([q.id, q.x, q.y, q.alive ? 0 : 1, q.moving ? 1 : 0]);
    }
    const bodies = this.bodies.filter((b) => !p.alive || canSee(p.x, p.y, b.x, b.y, this.visionOf(p), blocked));
    const s = this.sabotage;
    const glitch = p.role === "glitch";
    return {
      t: "snap", tick: this.tick, ack: p.ack,
      me: { x: p.x, y: p.y, ghost: !p.alive },
      others, bodies,
      bar: s?.kind === "comms" ? null : this.taskProgress().ratio,
      sab: s ? { kind: s.kind, room: s.room, endsIn: s.endsAt === null ? null : Math.max(0, s.endsAt - now) } : null,
      cd: {
        kill: glitch && p.alive ? Math.max(0, p.killReadyAt - now) : 0,
        sab: glitch ? Math.max(0, this.sabReadyAt - now) : 0,
        emer: Math.max(0, this.emergencyReadyAt - now),
        emerLeft: p.emergencyLeft,
      },
      doors: s?.kind === "doors" && s.room ? [s.room] : [],
      held: [this.holds[0] !== null, this.holds[1] !== null],
    };
  }

  taskProgress(): { done: number; total: number; ratio: number } {
    let done = 0, total = 0;
    for (const p of this.players.values()) {
      if (p.role !== "crew" || p.left) continue;
      total += p.tasks.length;
      done += p.tasks.filter((t) => t.done).length;
    }
    return { done, total, ratio: total === 0 ? 0 : Math.round((done / total) * 1000) / 1000 };
  }

  private meetingView(now: number): MeetingView | null {
    const m = this.meeting;
    if (!m) return null;
    return {
      phase: m.phase, endsIn: Math.max(0, m.endsAt - now), caller: m.caller, reason: m.reason, victim: m.victim,
      alive: [...this.players.values()].filter((p) => p.alive && !p.left).map((p) => p.id),
      voted: [...m.votes.keys()],
      result: m.result,
    };
  }

  private overMessage(w: Winner): ServerMessage {
    const roles: Record<string, Role> = {};
    for (const p of this.players.values()) roles[p.id] = p.role;
    return { t: "over", winner: w.team, reason: w.reason, roles };
  }

  // ---- Simulation -------------------------------------------------------

  private lastNow = 0;

  step(now: number): void {
    this.lastNow = now;
    if (this.phase === "over") return;
    this.tick++;

    if (this.phase === "reveal" && now >= this.revealUntil) this.phase = "play";

    for (const p of this.players.values()) p.brain?.think(this, p, now);

    if (this.phase === "play") {
      this.simulateMovement();
      this.updateSabotage(now);
    } else {
      for (const p of this.players.values()) this.drainInputs(p);
    }
    if (this.phase === "meeting") this.updateMeeting(now);
    if ((this.phase as MatchPhase) === "over") return;

    if (this.phase === "play" || this.phase === "reveal") {
      const blocked = this.blocked();
      for (const p of this.players.values()) {
        if (!p.bot && p.connected && !p.left) this.send(p.id, this.snapshot(p, now, blocked));
      }
    }
  }

  private drainInputs(p: MatchPlayerState): void {
    const last = p.inputs.at(-1);
    if (last) p.ack = last.seq;
    p.inputs = [];
    p.moving = false;
  }

  private simulateMovement(): void {
    const doors = this.blocked();
    for (const p of this.players.values()) {
      if (p.left) continue;
      const batch = p.inputs.splice(0, CONFIG.net.maxInputsPerTick);
      p.moving = false;
      for (const input of batch) {
        const next = stepMovement(p, input.dx, input.dy, p.alive ? doors : NO_BLOCK);
        if (next.x !== p.x || next.y !== p.y) p.moving = true;
        p.x = next.x;
        p.y = next.y;
        p.ack = input.seq;
      }
      if (batch.length && p.taskOpen) {
        const stage = taskById(p.taskOpen.task).stages[p.taskOpen.stage];
        if (stage && dist(p, stage.at) > CONFIG.map.interactRange) p.taskOpen = null;
      }
      for (const i of [0, 1] as const) {
        if (this.holds[i] === p.id && (!p.alive || dist(p, FIX_POINTS.meltdown[i]) > CONFIG.map.interactRange)) this.holds[i] = null;
      }
    }
  }

  private updateSabotage(now: number): void {
    const s = this.sabotage;
    if (!s) return;
    if (s.kind === "meltdown") {
      const [a, b] = this.holds;
      if (a && b && a !== b) return this.clearSabotage(now, "fixed");
      if (s.endsAt !== null && now >= s.endsAt) return this.finish({ team: "glitch", reason: "meltdown" });
    }
    if (s.kind === "doors" && s.endsAt !== null && now >= s.endsAt) this.clearSabotage(now, "expired");
  }

  private clearSabotage(now: number, why: string): void {
    if (this.sabotage) this.log("sabotage_end", { kind: this.sabotage.kind, why });
    this.sabotage = null;
    this.holds = [null, null];
    this.sabReadyAt = Math.max(this.sabReadyAt, now + CONFIG.glitch.sabotageCooldownS * 1000);
    for (const p of this.players.values()) p.fixOpen = null;
  }

  // ---- Messages ---------------------------------------------------------

  handle(id: string, msg: ClientMessage, now: number): void {
    const p = this.players.get(id);
    if (!p || p.left || this.phase === "over") return;
    const near = (pt: Point) => dist(p, pt) <= CONFIG.map.interactRange;
    const playing = this.phase === "play";

    switch (msg.t) {
      case "input": {
        if (!playing) { p.ack = Math.max(p.ack, msg.seq); return; }
        if (msg.seq <= p.ack || p.inputs.length >= CONFIG.net.maxQueuedInputs) return;
        const d = normalizeDir(msg.dx, msg.dy);
        p.inputs.push({ seq: msg.seq, dx: d.dx, dy: d.dy });
        return;
      }

      case "taskStart": {
        if (!playing || p.role !== "crew") return;
        const task = p.tasks.find((t) => t.id === msg.task && !t.done);
        const stage = task && taskById(task.id).stages[task.stage];
        if (task && stage && near(stage.at)) p.taskOpen = { task: task.id, stage: task.stage, at: now };
        return;
      }

      case "taskDone": {
        if (!playing || p.role !== "crew" || !p.taskOpen || p.taskOpen.task !== msg.task) return;
        const task = p.tasks.find((t) => t.id === msg.task && !t.done);
        const def = taskById(msg.task);
        const stage = def.stages[p.taskOpen.stage];
        const minMs = def.kind === "long" ? CONFIG.tasks.longStageMs - 300 : CONFIG.tasks.minTaskMs;
        if (!task || !stage || task.stage !== p.taskOpen.stage || now - p.taskOpen.at < minMs || !near(stage.at)) return;
        p.taskOpen = null;
        task.stage++;
        task.done = task.stage >= def.stages.length;
        this.sendTo(p, { t: "tasks", list: p.tasks });
        if (task.done && def.visual) {
          this.broadcast({ t: "fx", kind: "task", x: stage.at.x, y: stage.at.y }, (q) => q.alive && this.sees(q, stage.at));
        }
        this.checkWin();
        return;
      }

      case "kill": {
        if (!playing || p.role !== "glitch" || !p.alive || now < p.killReadyAt) return;
        const target = this.players.get(msg.target);
        if (!target || target.left || !target.alive || target.role !== "crew") return;
        if (dist(p, target) > CONFIG.glitch.eliminateRangeTiles) return;
        target.alive = false;
        target.taskOpen = null;
        target.fixOpen = null;
        target.inputs = [];
        this.bodies.push({ id: `b${++this.bodySeq}`, victim: target.id, x: target.x, y: target.y });
        p.killReadyAt = now + this.settings.killCooldown * 1000;
        for (const i of [0, 1] as const) if (this.holds[i] === target.id) this.holds[i] = null;
        for (const q of this.players.values()) {
          if (q.brain && q.alive && q.id !== p.id && this.sees(q, p)) q.brain.witnessed(p.id);
        }
        this.sendTo(target, { t: "died", how: "eliminated" });
        this.log("elimination", { by: p.id, target: target.id });
        this.checkWin();
        return;
      }

      case "report": {
        if (!playing || !p.alive) return;
        const body = this.bodies.find((b) => b.id === msg.body);
        if (body && near(body)) this.startMeeting(p, "report", body.victim, now);
        return;
      }

      case "emergency": {
        if (!playing || !p.alive || p.emergencyLeft <= 0 || now < this.emergencyReadyAt) return;
        if (this.sabotage?.kind === "meltdown" || !near(EMERGENCY_BUTTON)) return;
        p.emergencyLeft--;
        this.startMeeting(p, "emergency", null, now);
        return;
      }

      case "sabotage": {
        if (!playing || p.role !== "glitch" || this.sabotage || now < this.sabReadyAt) return;
        const endsAt =
          msg.kind === "meltdown" ? now + CONFIG.glitch.meltdownTimerS * 1000
          : msg.kind === "doors" ? now + CONFIG.glitch.lockDoorsS * 1000
          : null;
        this.sabotage = { kind: msg.kind, room: msg.room, endsAt };
        this.log("sabotage", { kind: msg.kind, room: msg.room });
        return;
      }

      case "fixStart": {
        if (!playing || !p.alive || this.sabotage?.kind !== msg.kind) return;
        if (near(FIX_POINTS[msg.kind])) p.fixOpen = { kind: msg.kind, at: now };
        return;
      }

      case "fixDone": {
        if (!playing || !p.alive || this.sabotage?.kind !== msg.kind || p.fixOpen?.kind !== msg.kind) return;
        if (now - p.fixOpen.at < CONFIG.tasks.fixMinMs || !near(FIX_POINTS[msg.kind])) return;
        this.clearSabotage(now, "fixed");
        return;
      }

      case "hold": {
        if (!playing || !p.alive || this.sabotage?.kind !== "meltdown") return;
        if (msg.on && near(FIX_POINTS.meltdown[msg.panel]) && this.holds[msg.panel] === null) this.holds[msg.panel] = p.id;
        if (!msg.on && this.holds[msg.panel] === p.id) this.holds[msg.panel] = null;
        return;
      }

      case "conduit": {
        if (!playing || p.role !== "glitch" || !p.alive || now < p.conduitReadyAt) return;
        const from = CONDUITS.find((c) => near(c));
        if (!from) return;
        const to = CONDUITS[from.pair]!;
        p.x = to.x;
        p.y = to.y;
        p.inputs = [];
        p.conduitReadyAt = now + CONFIG.glitch.conduitCooldownS * 1000;
        // The animation is visible: anyone watching either opening sees it.
        for (const at of [from, to]) {
          this.broadcast({ t: "fx", kind: "conduit", x: at.x, y: at.y }, (q) => q.id !== p.id && q.alive && this.sees(q, at));
        }
        return;
      }

      case "chat":
      case "quick": {
        if (!this.takeChatToken(p, now)) return;
        let text: string | null;
        if (msg.t === "chat") {
          if (!this.settings.freeChat) return;
          text = cleanChat(msg.text);
        } else {
          text = renderQuick(msg.tpl, msg.args, (pid) => this.players.get(pid)?.name ?? null);
        }
        if (!text) return;
        if (p.alive) {
          // The living only talk during meetings; everyone (ghosts too) can read it.
          if (this.phase !== "meeting") return;
          this.broadcast({ t: "chat", from: p.id, text, ghost: false });
        } else {
          this.broadcast({ t: "chat", from: p.id, text, ghost: true }, (q) => !q.alive);
        }
        return;
      }

      case "vote": {
        const m = this.meeting;
        if (!m || m.phase !== "voting" || !p.alive || m.votes.has(p.id)) return;
        const target = msg.target === SKIP ? SKIP : this.players.get(msg.target);
        if (target !== SKIP && (!target || !target.alive || target.left)) return;
        m.votes.set(p.id, msg.target);
        const alive = [...this.players.values()].filter((q) => q.alive && !q.left).length;
        if (m.votes.size >= alive) this.endVoting(now);
        else this.broadcast({ t: "meeting", meeting: this.meetingView(now) });
        return;
      }

      case "flag":
        this.log("player_flagged", { by: p.id, target: msg.id });
        return;

      default:
        return;
    }
  }

  private takeChatToken(p: MatchPlayerState, now: number): boolean {
    const refill = (now - p.chatAt) / CONFIG.meeting.chatEveryMs;
    p.chatTokens = Math.min(CONFIG.meeting.chatBurst, p.chatTokens + refill);
    p.chatAt = now;
    if (p.chatTokens < 1) return false;
    p.chatTokens--;
    return true;
  }

  // ---- Meetings ---------------------------------------------------------

  private startMeeting(caller: MatchPlayerState, reason: Meeting["reason"], victim: string | null, now: number): void {
    this.phase = "meeting";
    this.sabotage = null;
    this.holds = [null, null];
    for (const p of this.players.values()) {
      p.taskOpen = null;
      p.fixOpen = null;
      this.drainInputs(p);
    }
    this.meeting = {
      phase: "discussion", endsAt: now + this.settings.discussion * 1000,
      caller: caller.id, reason, victim, votes: new Map(), result: null,
    };
    this.log("meeting", { reason, caller: caller.id });
    this.broadcast({ t: "meeting", meeting: this.meetingView(now) });
  }

  private updateMeeting(now: number): void {
    const m = this.meeting;
    if (!m || now < m.endsAt) return;
    if (m.phase === "discussion") {
      m.phase = "voting";
      m.endsAt = now + this.settings.voting * 1000;
      this.broadcast({ t: "meeting", meeting: this.meetingView(now) });
    } else if (m.phase === "voting") {
      this.endVoting(now);
    } else {
      this.endMeeting(now);
    }
  }

  private endVoting(now: number): void {
    const m = this.meeting;
    if (!m) return;
    const { ejected, counts } = tallyVotes(m.votes);
    const out = ejected ? this.players.get(ejected) : undefined;
    if (out) {
      out.alive = false;
      this.sendTo(out, { t: "died", how: "ejected" });
    }
    m.phase = "result";
    m.endsAt = now + CONFIG.meeting.resultS * 1000;
    m.result = { ejected: ejected, role: out && this.settings.revealRole ? out.role : null, counts };
    this.log("vote_result", { ejected, counts });
    this.broadcast({ t: "meeting", meeting: this.meetingView(now) });
  }

  private endMeeting(now: number): void {
    this.meeting = null;
    this.bodies = [];
    if (this.checkWin()) return;
    this.phase = "play";
    const seated = [...this.players.values()].filter((p) => !p.left);
    seated.forEach((p, i) => {
      const s = spawnPoint(i, seated.length);
      p.x = s.x;
      p.y = s.y;
      p.inputs = [];
      p.killReadyAt = now + this.settings.killCooldown * 1000;
    });
    this.emergencyReadyAt = now + CONFIG.meeting.emergencyCooldownS * 1000;
    this.sabReadyAt = now + CONFIG.glitch.firstSabotageDelayS * 1000;
    this.broadcast({ t: "meeting", meeting: null });
  }

  // ---- Leaving and winning ----------------------------------------------

  /** A player whose reconnect window ran out: gone for good, their tasks no longer count. */
  leave(id: string): void {
    const p = this.players.get(id);
    if (!p || p.left) return;
    p.left = true;
    p.alive = false;
    p.connected = false;
    for (const i of [0, 1] as const) if (this.holds[i] === id) this.holds[i] = null;
    if (this.meeting?.phase === "voting") {
      this.meeting.votes.delete(id);
      const alive = [...this.players.values()].filter((q) => q.alive && !q.left).length;
      if (this.meeting.votes.size >= alive) this.endVoting(this.lastNow);
    }
    this.checkWin();
  }

  disconnected(id: string): void {
    const p = this.players.get(id);
    if (p) { p.connected = false; p.inputs = []; }
  }

  /** Returns true if the match just ended. Win checks wait while a vote result is on screen. */
  checkWin(): boolean {
    if (this.phase === "over") return true;
    if (this.meeting) return false;
    let aliveCrew = 0, aliveGlitches = 0;
    for (const p of this.players.values()) {
      if (!p.alive || p.left) continue;
      if (p.role === "crew") aliveCrew++; else aliveGlitches++;
    }
    const { done, total } = this.taskProgress();
    const w = checkWinner({ aliveCrew, aliveGlitches, tasksDone: done, tasksTotal: total, meltdownExpired: false });
    if (w) { this.finish(w); return true; }
    return false;
  }

  private finish(w: Winner): void {
    if (this.phase === "over") return;
    this.phase = "over";
    this.winner = w;
    this.meeting = null;
    this.sabotage = null;
    this.log("match_finished", { winner: w.team, reason: w.reason, ticks: this.tick });
    this.broadcast(this.overMessage(w));
    this.onOver?.(w);
  }
}
