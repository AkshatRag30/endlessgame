import { describe, expect, it } from "vitest";
import { CONFIG } from "./config";
import {
  blockedFor, canSee, CONDUITS, DOORS, EMERGENCY_BUTTON, findPath, FIX_POINTS, isWall, MAP_SIZE, roomAt, ROOMS, spawnPoint,
} from "./map";
import { encode, parseClientMessage, parseServerMessage } from "./messages";
import { normalizeDir, stepMovement } from "./movement";
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "./roomCode";
import {
  applySettings, assignRoles, checkWinner, cleanChat, cleanName, DEFAULT_SETTINGS, glitchCountFor, makeTaskDraw, renderQuick, tallyVotes,
} from "./rules";
import { TASKS } from "./tasks";

describe("room codes", () => {
  it("generates valid codes with no lookalike letters", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      expect(isValidRoomCode(code)).toBe(true);
      expect(code).not.toMatch(/[ILO0-9]/);
    }
  });
  it("normalizes user input and rejects bad codes", () => {
    expect(normalizeRoomCode("  abcd ")).toBe("ABCD");
    for (const bad of ["", "ABC", "ABCDE", "PING", "AB1D", "abcd"]) expect(isValidRoomCode(bad)).toBe(false);
  });
});

describe("map", () => {
  it("has nine rooms inside the grid", () => {
    expect(ROOMS).toHaveLength(9);
    for (const r of ROOMS) {
      expect(r.x0).toBeGreaterThan(0);
      expect(r.x1).toBeLessThan(MAP_SIZE - 1);
    }
  });
  it("puts every point of interest on floor and in the right room", () => {
    const points = [
      EMERGENCY_BUTTON, FIX_POINTS.blackout, FIX_POINTS.comms, ...FIX_POINTS.meltdown, ...CONDUITS,
      ...TASKS.flatMap((t) => t.stages.map((s) => s.at)),
    ];
    for (const p of points) expect(isWall(Math.floor(p.x), Math.floor(p.y))).toBe(false);
    for (const t of TASKS) for (const s of t.stages) expect(roomAt(s.at.x, s.at.y)?.id).toBe(s.room);
    expect(roomAt(EMERGENCY_BUTTON.x, EMERGENCY_BUTTON.y)?.id).toBe("hub");
  });
  it("connects every room to the Hub", () => {
    const hub = spawnPoint(0, 1);
    for (const r of ROOMS) expect(findPath(hub, { x: r.cx + 0.5, y: r.cy + 0.5 })).not.toBeNull();
  });
  it("makes the Dock a dead end with a single corridor", () => {
    expect(DOORS.dock).toHaveLength(3);
    const blocked = blockedFor(["dock"]);
    const dock = ROOMS.find((r) => r.id === "dock")!;
    expect(findPath(spawnPoint(0, 1), { x: dock.cx + 0.5, y: dock.cy + 0.5 }, blocked)).toBeNull();
  });
  it("blocks sight through walls but not across a room", () => {
    const hub = ROOMS.find((r) => r.id === "hub")!;
    const lab = ROOMS.find((r) => r.id === "lab")!;
    expect(canSee(hub.cx + 0.5, hub.cy + 0.5, hub.cx + 3.5, hub.cy + 0.5, 6)).toBe(true);
    // Hub top corner to Lab top corner passes through a wall.
    expect(canSee(hub.x1 + 0.5, hub.y0 + 0.5, lab.x0 + 0.5, lab.y0 + 0.5, 20)).toBe(false);
    expect(canSee(hub.cx, hub.cy, hub.cx + 7, hub.cy, 6)).toBe(false);
  });
});

describe("movement", () => {
  it("walks at the configured speed", () => {
    const start = spawnPoint(0, 1);
    const next = stepMovement(start, 1, 0);
    expect(next.x - start.x).toBeCloseTo(CONFIG.movement.walkTilesPerSecond / CONFIG.net.tickRate, 2);
  });
  it("never enters a wall", () => {
    let p = spawnPoint(0, 1);
    for (let i = 0; i < 400; i++) p = stepMovement(p, 0, -1);
    expect(isWall(Math.floor(p.x), Math.floor(p.y - CONFIG.map.playerRadius))).toBe(false);
  });
  it("clamps diagonal input", () => {
    const d = normalizeDir(1, 1);
    expect(Math.hypot(d.dx, d.dy)).toBeLessThanOrEqual(1.001);
  });
});

describe("rules", () => {
  it("clamps settings from untrusted input", () => {
    const s = applySettings(DEFAULT_SETTINGS, { killCooldown: 2, crewVision: 99, practice: true, evil: 5 });
    expect(s.killCooldown).toBe(15);
    expect(s.crewVision).toBe(9);
    expect(s.practice).toBe(true);
    expect("evil" in s).toBe(false);
  });
  it("picks a fair number of Glitches", () => {
    expect(glitchCountFor(5, 0)).toBe(1);
    expect(glitchCountFor(8, 0)).toBe(2);
    expect(glitchCountFor(3, 3)).toBe(1);
    expect(glitchCountFor(10, 3)).toBe(3);
  });
  it("assigns exactly the requested Glitches", () => {
    const roles = assignRoles(["a", "b", "c", "d", "e", "f"], 2);
    expect([...roles.values()].filter((r) => r === "glitch")).toHaveLength(2);
  });
  it("draws the same commons for everyone", () => {
    const draw = makeTaskDraw(DEFAULT_SETTINGS);
    const a = draw(), b = draw();
    expect(a).toHaveLength(6);
    expect(a.slice(0, 2).map((t) => t.id)).toEqual(b.slice(0, 2).map((t) => t.id));
  });
  it("tallies votes per the PRD", () => {
    expect(tallyVotes(new Map([["1", "x"], ["2", "x"], ["3", "y"]])).ejected).toBe("x");
    expect(tallyVotes(new Map([["1", "x"], ["2", "y"]])).ejected).toBeNull();
    expect(tallyVotes(new Map([["1", "x"], ["2", "skip"]])).ejected).toBeNull();
    expect(tallyVotes(new Map()).ejected).toBeNull();
  });
  it("checks win conditions", () => {
    const base = { aliveCrew: 4, aliveGlitches: 1, tasksDone: 0, tasksTotal: 10, meltdownExpired: false };
    expect(checkWinner(base)).toBeNull();
    expect(checkWinner({ ...base, tasksDone: 10 })?.reason).toBe("tasks");
    expect(checkWinner({ ...base, aliveGlitches: 0 })?.reason).toBe("ejected");
    expect(checkWinner({ ...base, aliveCrew: 1 })?.reason).toBe("numbers");
    expect(checkWinner({ ...base, meltdownExpired: true })?.team).toBe("glitch");
  });
  it("filters chat and names", () => {
    expect(cleanChat("  hello\u0000  shit  ")).toBe("hello ****");
    expect(cleanChat("x".repeat(200))).toHaveLength(CONFIG.meeting.chatMaxChars);
    expect(cleanName("   ")).toBe("Player");
  });
  it("renders quick chat only from valid ids", () => {
    const names = (id: string) => (id === "p1" ? "Ada" : null);
    expect(renderQuick("saw_at", ["p1", "dock"], names)).toBe("I saw Ada at Dock");
    expect(renderQuick("sus", ["nobody"], names)).toBeNull();
    expect(renderQuick("was_in", ["<script>"], names)).toBeNull();
  });
});

describe("messages", () => {
  it("accepts valid client messages and strips unknown fields", () => {
    expect(parseClientMessage(encode({ t: "ping", id: 3, sentAt: 1 }))).toEqual({ t: "ping", id: 3, sentAt: 1 });
    expect(parseClientMessage(JSON.stringify({ t: "kill", target: "p2", role: "glitch" }))).toEqual({ t: "kill", target: "p2" });
    expect(parseClientMessage(JSON.stringify({ t: "sabotage", kind: "doors", room: "dock" }))).toEqual({ t: "sabotage", kind: "doors", room: "dock" });
  });
  it("rejects junk", () => {
    const junk: unknown[] = [
      42, null, "nope", "[]",
      JSON.stringify({ t: "input", seq: 1, dx: 5, dy: 0 }),
      JSON.stringify({ t: "hello", name: "a", color: 99, accessory: "none", token: null }),
      JSON.stringify({ t: "sabotage", kind: "doors", room: "moon" }),
      JSON.stringify({ t: "taskDone", task: "hack" }),
      JSON.stringify({ t: "hold", panel: 2, on: true }),
      JSON.stringify({ t: "ping", id: 1, sentAt: 2, pad: "x".repeat(CONFIG.net.maxMessageBytes) }),
    ];
    for (const raw of junk) expect(parseClientMessage(raw)).toBeNull();
  });
  it("only accepts known server messages", () => {
    expect(parseServerMessage(JSON.stringify({ t: "kicked" }))).toEqual({ t: "kicked" });
    expect(parseServerMessage(JSON.stringify({ t: "hack" }))).toBeNull();
  });
});
