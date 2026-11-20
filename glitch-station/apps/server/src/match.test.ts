import { describe, expect, it } from "vitest";
import {
  CONFIG, DEFAULT_SETTINGS, FIX_POINTS, taskById, type ServerMessage, type Settings,
} from "@glitch/shared";
import { Match, type MatchSeat } from "./match";

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function setup(opts: { humans?: number; bots?: number; settings?: Partial<Settings>; seed?: number } = {}) {
  const humans = opts.humans ?? 5;
  const bots = opts.bots ?? 0;
  const seats: MatchSeat[] = [];
  for (let i = 0; i < humans; i++) seats.push({ id: `h${i}`, name: `H${i}`, color: i, accessory: "none", bot: false });
  for (let i = 0; i < bots; i++) seats.push({ id: `b${i}`, name: `B${i}`, color: humans + i, accessory: "none", bot: true });
  const inbox = new Map<string, ServerMessage[]>();
  let over: string | null = null;
  let now = 1_000_000;
  const match = new Match({
    seats, now, rng: seeded(opts.seed ?? 7),
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    send: (id, msg) => { if (!inbox.has(id)) inbox.set(id, []); inbox.get(id)!.push(msg); },
    onOver: (w) => { over = `${w.team}:${w.reason}`; },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    while (now < end) { now += 50; match.step(now); }
  };
  const ids = (role: "crew" | "glitch") => [...match.players.values()].filter((p) => p.role === role).map((p) => p.id);
  return { match, inbox, advance, ids, now: () => now, over: () => over };
}

describe("hidden information", () => {
  it("never tells a crew client anyone's role", () => {
    const g = setup({ humans: 8 });
    g.advance(CONFIG.roleRevealMs + 2000);
    for (const id of g.ids("crew")) {
      const all = JSON.stringify(g.inbox.get(id));
      expect(all).not.toContain('"glitch"');
      const start = g.inbox.get(id)!.find((m) => m.t === "matchStart");
      expect(start && start.t === "matchStart" && start.partners).toEqual([]);
    }
  });

  it("tells Glitches only about each other", () => {
    const g = setup({ humans: 8 });
    const glitches = g.ids("glitch");
    expect(glitches).toHaveLength(2);
    const start = g.inbox.get(glitches[0]!)!.find((m) => m.t === "matchStart");
    expect(start && start.t === "matchStart" && start.partners).toEqual([glitches[1]]);
  });

  it("culls players outside vision from snapshots", () => {
    const g = setup({ humans: 5 });
    g.advance(CONFIG.roleRevealMs + 100);
    const [a, b] = [...g.match.players.values()];
    // Put b in the Dock, far from a in the Hub.
    b!.x = 7.5; b!.y = 44.5;
    g.inbox.clear();
    g.advance(100);
    const snaps = g.inbox.get(a!.id)!.filter((m) => m.t === "snap");
    for (const s of snaps) if (s.t === "snap") expect(s.others.map((o) => o[0])).not.toContain(b!.id);
  });
});

describe("glitch actions are validated", () => {
  it("rejects eliminations from out of range and during cooldown", () => {
    const g = setup({ humans: 5 });
    const glitch = g.match.players.get(g.ids("glitch")[0]!)!;
    const victim = g.match.players.get(g.ids("crew")[0]!)!;
    g.advance(CONFIG.roleRevealMs + 100);

    // Cooldown still running at match start.
    victim.x = glitch.x + 0.5; victim.y = glitch.y;
    g.match.handle(glitch.id, { t: "kill", target: victim.id }, g.now());
    expect(victim.alive).toBe(true);

    g.advance(DEFAULT_SETTINGS.killCooldown * 1000);
    victim.x = glitch.x + 3; victim.y = glitch.y;
    g.match.handle(glitch.id, { t: "kill", target: victim.id }, g.now());
    expect(victim.alive).toBe(true);

    victim.x = glitch.x + 1; victim.y = glitch.y;
    g.match.handle(glitch.id, { t: "kill", target: victim.id }, g.now());
    expect(victim.alive).toBe(false);
    expect(g.match.bodies).toHaveLength(1);

    // Immediately again: cooldown.
    const second = g.match.players.get(g.ids("crew")[1]!)!;
    second.x = glitch.x + 0.5; second.y = glitch.y;
    g.match.handle(glitch.id, { t: "kill", target: second.id }, g.now());
    expect(second.alive).toBe(true);
  });

  it("refuses crew trying to eliminate or sabotage", () => {
    const g = setup({ humans: 5 });
    g.advance(CONFIG.roleRevealMs + DEFAULT_SETTINGS.killCooldown * 1000 + 100);
    const [c1, c2] = g.ids("crew").map((id) => g.match.players.get(id)!);
    c2!.x = c1!.x + 0.5; c2!.y = c1!.y;
    g.match.handle(c1!.id, { t: "kill", target: c2!.id }, g.now());
    g.match.handle(c1!.id, { t: "sabotage", kind: "blackout", room: null }, g.now());
    expect(c2!.alive).toBe(true);
    expect(g.match.sabotage).toBeNull();
  });

  it("caps movement speed no matter how many inputs arrive", () => {
    const g = setup({ humans: 5 });
    g.advance(CONFIG.roleRevealMs + 100);
    const p = g.match.players.get("h0")!;
    const start = { x: p.x, y: p.y };
    for (let i = 1; i <= 200; i++) g.match.handle("h0", { t: "input", seq: p.ack + i, dx: 0, dy: 1 }, g.now());
    g.advance(1000);
    const moved = Math.hypot(p.x - start.x, p.y - start.y);
    expect(moved).toBeLessThanOrEqual(CONFIG.movement.walkTilesPerSecond * 1.0 * CONFIG.net.maxInputsPerTick + 0.01);
    expect(moved).toBeLessThanOrEqual(CONFIG.movement.walkTilesPerSecond * (CONFIG.net.maxQueuedInputs / CONFIG.net.tickRate) + 0.01);
  });
});

describe("tasks and wins", () => {
  it("rejects a task finished too fast or from far away, and the crew can win by tasks", () => {
    const g = setup({ humans: 5, settings: { commonTasks: 0, shortTasks: 1, longTasks: 0 } });
    g.advance(CONFIG.roleRevealMs + 100);
    const crew = g.ids("crew").map((id) => g.match.players.get(id)!);

    const first = crew[0]!;
    const task = first.tasks[0]!;
    const at = taskById(task.id).stages[0]!.at;
    // From far away: refused.
    g.match.handle(first.id, { t: "taskStart", task: task.id }, g.now());
    expect(first.taskOpen).toBeNull();
    first.x = at.x; first.y = at.y;
    g.match.handle(first.id, { t: "taskStart", task: task.id }, g.now());
    // Too fast: refused.
    g.match.handle(first.id, { t: "taskDone", task: task.id }, g.now() + 10);
    expect(task.done).toBe(false);

    for (const p of crew) {
      const t = p.tasks[0]!;
      const pos = taskById(t.id).stages[0]!.at;
      p.x = pos.x; p.y = pos.y;
      g.match.handle(p.id, { t: "taskStart", task: t.id }, g.now());
    }
    g.advance(CONFIG.tasks.minTaskMs + 100);
    for (const p of crew) g.match.handle(p.id, { t: "taskDone", task: p.tasks[0]!.id }, g.now());
    expect(g.over()).toBe("crew:tasks");
  });

  it("Glitches win by numbers", () => {
    const g = setup({ humans: 5 });
    g.advance(CONFIG.roleRevealMs + DEFAULT_SETTINGS.killCooldown * 1000 + 100);
    const glitch = g.match.players.get(g.ids("glitch")[0]!)!;
    const crew = g.ids("crew").map((id) => g.match.players.get(id)!);
    for (let i = 0; i < 3; i++) {
      const v = crew[i]!;
      v.x = glitch.x + 0.5; v.y = glitch.y;
      glitch.killReadyAt = 0;
      g.match.handle(glitch.id, { t: "kill", target: v.id }, g.now());
    }
    expect(g.over()).toBe("glitch:numbers");
  });

  it("Glitches win when a meltdown runs out, and two holders fix it", () => {
    const g = setup({ humans: 6, seed: 3 });
    g.advance(CONFIG.roleRevealMs + CONFIG.glitch.firstSabotageDelayS * 1000 + 100);
    const glitch = g.ids("glitch")[0]!;
    g.match.handle(glitch, { t: "sabotage", kind: "meltdown", room: null }, g.now());
    expect(g.match.sabotage?.kind).toBe("meltdown");

    const [a, b] = g.ids("crew").map((id) => g.match.players.get(id)!);
    a!.x = FIX_POINTS.meltdown[0].x; a!.y = FIX_POINTS.meltdown[0].y;
    b!.x = FIX_POINTS.meltdown[1].x; b!.y = FIX_POINTS.meltdown[1].y;
    g.match.handle(a!.id, { t: "hold", panel: 0, on: true }, g.now());
    // One holder is not enough; the same player cannot hold both.
    g.match.handle(a!.id, { t: "hold", panel: 1, on: true }, g.now());
    g.advance(100);
    expect(g.match.sabotage).not.toBeNull();
    g.match.handle(b!.id, { t: "hold", panel: 1, on: true }, g.now());
    g.advance(100);
    expect(g.match.sabotage).toBeNull();

    g.advance(CONFIG.glitch.sabotageCooldownS * 1000);
    g.match.handle(glitch, { t: "sabotage", kind: "meltdown", room: null }, g.now());
    g.advance(CONFIG.glitch.meltdownTimerS * 1000 + 200);
    expect(g.over()).toBe("glitch:meltdown");
  });
});

describe("meetings", () => {
  it("reports, votes and ejects, then the crew wins when the Glitch is out", () => {
    const g = setup({ humans: 5, settings: { discussion: 15, voting: 15 } });
    g.advance(CONFIG.roleRevealMs + DEFAULT_SETTINGS.killCooldown * 1000 + 100);
    const glitch = g.match.players.get(g.ids("glitch")[0]!)!;
    const crew = g.ids("crew").map((id) => g.match.players.get(id)!);
    const victim = crew[0]!;
    victim.x = glitch.x + 0.5; victim.y = glitch.y;
    g.match.handle(glitch.id, { t: "kill", target: victim.id }, g.now());

    const reporter = crew[1]!;
    reporter.x = victim.x + 1; reporter.y = victim.y;
    g.match.handle(reporter.id, { t: "report", body: g.match.bodies[0]!.id }, g.now());
    expect(g.match.phase).toBe("meeting");

    // Votes are locked during discussion.
    g.match.handle(reporter.id, { t: "vote", target: glitch.id }, g.now());
    expect(g.match.meeting!.votes.size).toBe(0);
    g.advance(15_000 + 100);
    expect(g.match.meeting!.phase).toBe("voting");

    // Ghosts cannot vote; everyone alive votes the Glitch.
    g.match.handle(victim.id, { t: "vote", target: glitch.id }, g.now());
    expect(g.match.meeting!.votes.has(victim.id)).toBe(false);
    for (const p of [...crew.slice(1), glitch]) g.match.handle(p.id, { t: "vote", target: p === glitch ? "skip" : glitch.id }, g.now());
    expect(g.match.meeting!.result?.ejected).toBe(glitch.id);
    expect(g.match.meeting!.result?.role).toBe("glitch");

    g.advance(CONFIG.meeting.resultS * 1000 + 100);
    expect(g.over()).toBe("crew:ejected");
  });

  it("keeps the living out of ghost chat", () => {
    const g = setup({ humans: 5 });
    g.advance(CONFIG.roleRevealMs + DEFAULT_SETTINGS.killCooldown * 1000 + 100);
    const glitch = g.match.players.get(g.ids("glitch")[0]!)!;
    const [victim, living] = g.ids("crew").map((id) => g.match.players.get(id)!);
    victim!.x = glitch.x + 0.5; victim!.y = glitch.y;
    g.match.handle(glitch.id, { t: "kill", target: victim!.id }, g.now());
    g.inbox.clear();
    g.match.handle(victim!.id, { t: "chat", text: "it was them" }, g.now());
    expect(g.inbox.get(victim!.id)?.some((m) => m.t === "chat")).toBe(true);
    expect(g.inbox.get(living!.id)?.some((m) => m.t === "chat") ?? false).toBe(false);
    // The living cannot chat outside meetings.
    g.match.handle(living!.id, { t: "chat", text: "hello" }, g.now());
    expect(g.inbox.get(victim!.id)!.filter((m) => m.t === "chat")).toHaveLength(1);
  });
});

describe("bots", () => {
  it("can play a full match on their own and someone wins", () => {
    for (const seed of [1, 2, 3]) {
      const g = setup({ humans: 0, bots: 7, seed, settings: { discussion: 15, voting: 15 } });
      for (let i = 0; i < 20 * 60 * 20 && !g.over(); i++) g.advance(50);
      expect(g.over(), `seed ${seed}`).not.toBeNull();
    }
  });
});
